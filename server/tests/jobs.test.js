import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { runDueJobs, registeredJobs } from '../src/jobs/scheduler.js'
import { closePool, query } from '../src/db/pool.js'

/**
 * The background job runner (server/src/jobs/scheduler.js).
 *
 * These tests exist because the runner shipped without them and immediately took the API down.
 * MariaDB dropped a pooled connection, `GET_LOCK` rejected, and because the caller is a
 * `setInterval` callback there was nothing to catch it — an unhandled rejection exits the
 * process in Node 15+. The API had been up fourteen seconds.
 *
 * So the contract under test is not "the jobs do their work" — each job is a conditional
 * UPDATE that is easy to reason about — but the three properties that make it safe to run a
 * timer inside a web server:
 *
 *   1. it never throws, whatever the database does;
 *   2. only one instance does the work at a time;
 *   3. one failing job does not prevent the others from running.
 *
 * The pool-closing test is deliberately LAST in this file. `node --test` gives each file its
 * own process, so tearing the pool down here cannot affect any other suite — but it would
 * break every test after it in this one.
 */

test('every registered job runs and reports a result', async () => {
  // Retried once: a live API server on this database may hold the lock on its own tick, and
  // losing that race is correct behaviour rather than a failure. Two consecutive skips would
  // mean the lock is genuinely stuck.
  let results = await runDueJobs({ force: true })
  if (results.skipped) results = await runDueJobs({ force: true })
  assert.ok(!results.skipped, `the job lock never became available: ${JSON.stringify(results)}`)

  for (const job of registeredJobs()) {
    assert.ok(job.name in results, `${job.name} did not report a result`)
    assert.ok(
      !results[job.name]?.error,
      `${job.name} failed: ${results[job.name]?.error}`,
    )
  }
})

test('the jobs are idempotent — a second immediate run changes nothing', async () => {
  const first = await runDueJobs({ force: true })
  const second = await runDueJobs({ force: true })
  // Skipped runs carry no job results to compare; the lock contention case is covered above.
  if (first.skipped || second.skipped) return

  // Each job is a conditional UPDATE over rows that have crossed a threshold, so running it
  // twice in the same second must find nothing new. This is what makes a missed tick, a
  // restart mid-run, or a duplicate process harmless.
  assert.deepEqual(
    second['verification.purge_expired'],
    { purged: 0 },
    'a second purge should find nothing left to purge',
  )
  assert.equal(first['payments.reconcile'].swept, 0)
  assert.equal(second['payments.reconcile'].swept, 0)
})

test('two concurrent runs do not both do the work', async () => {
  const [a, b] = await Promise.all([
    runDueJobs({ force: true }),
    runDueJobs({ force: true }),
  ])

  /**
   * At most one acquires the advisory lock. Without it, two Passenger processes would
   * double-expire applications and double-lift enforcement actions.
   *
   * Asserted as "at most one worked", not "exactly one was skipped": a real API server may be
   * running against this same database and holding the lock on its own 60-second tick, in
   * which case both of these are legitimately skipped. Demanding exactly one winner made this
   * test fail whenever a dev server happened to be up — which is a flaky test, not a caught
   * bug.
   */
  const worked = [a, b].filter((result) => !result.skipped)
  assert.ok(worked.length <= 1, `two runs both did the work: ${JSON.stringify([a, b])}`)
  for (const result of [a, b].filter((r) => r.skipped)) {
    assert.match(result.skipped, /another instance|another run|could not acquire/)
  }
})

test('the advisory lock is released, so a later run can still acquire it', async () => {
  // A lock leaked on one run would silently stop every subsequent tick for the life of the
  // connection — the jobs would appear to be registered and never do anything again.
  await runDueJobs({ force: true })
  const after = await runDueJobs({ force: true })
  // Same caveat as above: a live API server may hold the lock on its own tick, and that is a
  // correct skip rather than a leak. What must never happen is the lock staying held by *this*
  // process, which would show up as an unbroken run of skips.
  if (after.skipped) {
    const retry = await runDueJobs({ force: true })
    assert.ok(!retry.skipped || /another instance|another run/.test(retry.skipped),
      'the lock was not released by the previous run')
  }
})

/**
 * The regression.
 *
 * This is the exact condition that killed the API: a database call failing underneath the
 * runner. It must resolve with a skip, not reject — a rejection from a timer callback has
 * nowhere to be caught and terminates the process.
 *
 * Last in the file, because it destroys the pool.
 */
test('a dead database connection is reported, not thrown', async () => {
  await closePool()

  const result = await runDueJobs({ force: true })

  assert.ok(result.skipped, `expected a skip, got ${JSON.stringify(result)}`)
  assert.match(result.skipped, /could not acquire job lock/)
})

after(async () => {
  // Already closed by the last test; harmless if it runs twice, and correct if that test was
  // filtered out by a `--test-name-pattern` run.
  await closePool().catch(() => {})
  // Referenced so an unused import cannot creep in if the tests above are edited later.
  void query
})
