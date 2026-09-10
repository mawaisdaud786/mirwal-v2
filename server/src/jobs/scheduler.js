import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { expireStaleApplications } from '../modules/sellers/applications.service.js'
import { expireActions } from '../modules/safety/enforcement.service.js'
import { recomputeAll } from '../modules/safety/scoring.service.js'
import { expireAuthorisations } from '../modules/catalog/brandAuth.service.js'

/**
 * The background job runner.
 *
 * Several pieces of this system were written with no scheduler behind them, which made each of
 * them a slow leak rather than a feature:
 *
 *   * `expireStaleApplications` — without it, an application sitting in `more_info_required`
 *     stays "live" forever, blocks the applicant from starting again because of the
 *     one-live-application rule, and inflates every backlog figure an operator looks at.
 *   * `expireActions` — a seven-day listing restriction that nothing lifts is a permanent ban
 *     nobody decided to impose. This is the difference between a temporary penalty and an
 *     accidental one.
 *   * payout holds — earnings become withdrawable only once the return window closes, and
 *     nothing was moving them across that line.
 *   * stuck payments — an attempt left `pending` because a webhook never arrived is real money
 *     in limbo, and it is invisible until someone complains.
 *
 * **Why in-process rather than cron.** Mirwal deploys to cPanel/Passenger, where there is no
 * reliable cron and no separate worker dyno. An in-process timer is the only thing guaranteed
 * to exist. That is a real constraint, not a preference, and it has two consequences this file
 * has to handle:
 *
 *   1. **More than one instance may run.** Passenger can spawn several processes, and two
 *      copies of a job racing each other would double-expire or double-post. Each run takes a
 *      MariaDB advisory lock (`GET_LOCK`) so exactly one process does the work and the others
 *      return immediately. This is the same guarantee a proper queue would give, without
 *      needing one.
 *
 *   2. **A job must never take the API down.** Every run is wrapped: a throwing job is logged
 *      to `system_logs` and the next tick proceeds. A background task that can crash the web
 *      server is worse than no background task.
 *
 * Jobs are also deliberately idempotent — each one is a conditional UPDATE over rows that have
 * crossed a threshold, so running it twice changes nothing the second time. That is what makes
 * a missed tick, a restart mid-run, or a duplicate process harmless.
 */

/** How often the ticker fires. Every job declares its own interval on top of this. */
const TICK_MS = 60_000

/** Advisory lock name. Scoped to the database so two environments never block each other. */
const LOCK = `mirwal_jobs_${env.db.database}`

let timer = null
let running = false

/**
 * The registry.
 *
 * `everyMinutes` is a floor, not a promise: a tick that lands while the previous run is still
 * going is skipped rather than queued, because the work is idempotent and catching up serves
 * nobody.
 */
const JOBS = [
  {
    name: 'applications.expire',
    everyMinutes: 60,
    run: expireStaleApplications,
  },
  {
    name: 'enforcement.expire',
    everyMinutes: 15,
    run: expireActions,
  },
  {
    name: 'payouts.release_holds',
    everyMinutes: 30,
    run: releaseMaturedHolds,
  },
  {
    name: 'payments.reconcile',
    everyMinutes: 10,
    run: reconcileStalePayments,
  },
  {
    // Hourly is often enough: these scores move on delivered orders and upheld cases, neither
    // of which changes minute to minute, and recomputing every seller is not free.
    name: 'sellers.score',
    everyMinutes: 60,
    run: recomputeAll,
  },
  {
    // An expired distribution agreement that keeps granting access is the same failure as
    // never having checked one. Twice a day is ample for a date-boundary sweep.
    name: 'brands.expire_authorisations',
    everyMinutes: 720,
    run: expireAuthorisations,
  },
  {
    name: 'verification.purge_expired',
    everyMinutes: 360,
    run: purgeExpiredTokens,
  },
]

const lastRun = new Map()

/**
 * Earnings that have finished their hold.
 *
 * The ledger records a `sale` entry with `available_at` set to delivery plus the hold window;
 * a balance only counts matured rows. Nothing here moves money — it exists so the *count* of
 * newly-available entries is observable, which is what lets an operator answer "why did my
 * balance jump" without reading the ledger by hand.
 */
async function releaseMaturedHolds() {
  const [row] = await query(
    `SELECT COUNT(*) AS matured
       FROM seller_ledger_entries
      WHERE entry_type = 'sale'
        AND available_at <= NOW(3)
        AND available_at > DATE_SUB(NOW(3), INTERVAL 35 MINUTE)`,
  )
  return { matured: Number(row.matured) }
}

/**
 * Payment attempts that were created and never resolved.
 *
 * A provider callback that never arrives leaves an attempt `pending` and an order unpaid while
 * the shopper may well have been charged. Marking it is not the fix — only the provider knows
 * the truth — but it moves the attempt out of a state that looks live and into one an operator
 * can see and chase.
 *
 * The window is deliberately generous. Every provider Mirwal uses retries for far less than an
 * hour, so anything older than that is genuinely stuck rather than merely slow, and a shorter
 * window would abandon attempts that were about to succeed.
 */
async function reconcileStalePayments() {
  const stale = await query(
    `SELECT id, public_id, provider, provider_ref, order_id
       FROM payment_attempts
      WHERE status IN ('created', 'pending')
        AND created_at < DATE_SUB(NOW(3), INTERVAL 2 HOUR)`,
  )
  if (!stale.length) return { swept: 0 }

  await query(
    `UPDATE payment_attempts
        SET status = 'failed',
            failure_reason = 'No provider callback within two hours — swept by reconciliation.',
            updated_at = NOW(3)
      WHERE status IN ('created', 'pending')
        AND created_at < DATE_SUB(NOW(3), INTERVAL 2 HOUR)`,
  )

  // Logged individually: each of these is potentially a shopper who paid and whose order does
  // not say so, and that is worth a line an operator can search for rather than a count.
  for (const attempt of stale) {
    await log('warn', 'PAYMENT_STALE', `Payment attempt ${attempt.public_id} had no callback and was swept.`, {
      provider: attempt.provider,
      providerRef: attempt.provider_ref,
      orderId: attempt.order_id,
    })
  }
  return { swept: stale.length }
}

/**
 * Spent and expired verification tokens.
 *
 * These carry a destination — an email address or a phone number — so keeping them forever is
 * holding personal data with no purpose. A used token has nothing left to prove.
 */
async function purgeExpiredTokens() {
  const result = await query(
    `DELETE FROM verification_tokens
      WHERE (used_at IS NOT NULL AND used_at < DATE_SUB(NOW(3), INTERVAL 7 DAY))
         OR (expires_at < DATE_SUB(NOW(3), INTERVAL 7 DAY))`,
  )
  return { purged: result.affectedRows ?? 0 }
}

/** Write to `system_logs`, the table the admin Error Logs page reads. Never throws. */
async function log(level, code, message, context) {
  try {
    await query(
      `INSERT INTO system_logs (level, code, message, context, created_at)
       VALUES (?, ?, ?, ?, NOW(3))`,
      [level, code, String(message).slice(0, 1000), context ? JSON.stringify(context) : null],
    )
  } catch {
    // A logging failure must not escalate into a job failure.
  }
}

/**
 * One pass over the registry.
 *
 * Exported so a test — or an operator through an admin endpoint — can force a run without
 * waiting for the timer, which is also what makes these jobs testable at all.
 */
export async function runDueJobs({ force = false } = {}) {
  /**
   * In-process guard, in addition to the database lock below.
   *
   * `GET_LOCK` is reentrant on the same connection: two concurrent calls in one process that
   * happen to be served by the same pooled connection would both acquire it and both do the
   * work. The advisory lock exists for the cross-process case — several Passenger workers —
   * and is right for that; this closes the same-process case, which the timer already avoided
   * but a direct call did not.
   */
  if (inFlight) return { skipped: 'another run is already in progress' }
  inFlight = true
  try {
    return await runDueJobsInner({ force })
  } finally {
    inFlight = false
  }
}

let inFlight = false

async function runDueJobsInner({ force = false } = {}) {
  /**
   * Acquiring the lock is itself a database call, and therefore itself able to fail.
   *
   * This was outside the try/catch and it took the API down: MariaDB dropped an idle pooled
   * connection, `GET_LOCK` rejected with ECONNRESET, and because the caller is a `setInterval`
   * callback there was nothing to catch the rejection — an unhandled promise rejection exits
   * the process in Node 15+. A background task that can kill the web server is worse than no
   * background task, so every path in here now returns rather than throws.
   *
   * A 0-second timeout means "if someone else holds it, do not wait" — the other process is
   * already doing this work.
   */
  let lock
  try {
    [lock] = await query('SELECT GET_LOCK(?, 0) AS acquired', [LOCK])
  } catch (error) {
    // A database blip is not worth a log row of its own; the next tick will try again.
    return { skipped: `could not acquire job lock: ${error.message}` }
  }
  if (!lock?.acquired) return { skipped: 'another instance is running jobs' }

  const results = {}
  try {
    const now = Date.now()
    for (const job of JOBS) {
      const due = force || !lastRun.has(job.name)
        || now - lastRun.get(job.name) >= job.everyMinutes * 60_000
      if (!due) continue

      try {
        results[job.name] = await job.run()
        lastRun.set(job.name, Date.now())
      } catch (error) {
        // One failing job must not stop the others, and must not stop the API.
        results[job.name] = { error: error.message }
        await log('error', 'JOB_FAILED', `Background job ${job.name} failed: ${error.message}`, { job: job.name })
      }
    }
  } catch (error) {
    // Anything the per-job handlers did not already contain.
    results.error = error.message
  } finally {
    await query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {})
  }
  return results
}

/**
 * Start the ticker.
 *
 * `unref()` keeps the timer from holding the process open on shutdown — without it a SIGTERM
 * would wait up to a full tick before the process could exit.
 */
export function startJobs() {
  if (timer) return
  timer = setInterval(async () => {
    if (running) return
    running = true
    // `runDueJobs` is written not to throw, and this catch is the second line of defence:
    // an unhandled rejection from a timer callback terminates the process, so the guarantee
    // is worth stating twice rather than depending on one function staying well-behaved.
    try { await runDueJobs() } catch { /* never take the API down */ } finally { running = false }
  }, TICK_MS)
  timer.unref()
  console.log(`  background jobs started (${JOBS.length} registered, ${TICK_MS / 1000}s tick)`)
}

export function stopJobs() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

export const registeredJobs = () => JOBS.map(({ name, everyMinutes }) => ({
  name,
  everyMinutes,
  lastRunAt: lastRun.get(name) ? new Date(lastRun.get(name)).toISOString() : null,
}))
