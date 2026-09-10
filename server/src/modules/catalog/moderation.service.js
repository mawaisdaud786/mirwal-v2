import { query } from '../../db/pool.js'
import { badRequest } from '../../lib/errors.js'
import { parseJsonColumn } from '../../lib/json.js'

/**
 * Automated checks on a listing before a human sees it.
 *
 * `moderation_rules` was created by migration 023 with ten seeded rules — including the
 * Pakistani counterfeit vocabulary that a rule set written for another market would miss:
 * "master copy", "first copy", "super copy", "replica" — and nothing has ever read it. Every
 * listing went to a reviewer with no signal at all, so a queue of two hundred products offered
 * no way to tell which one was worth opening first.
 *
 * The division of labour this implements, and the reason for it:
 *
 *   **block** — refuses the listing outright. Reserved for goods that cannot lawfully be sold
 *   at all: weapons, ammunition, prescription medicines, wildlife products. A false positive
 *   here costs one appeal; a false negative costs considerably more.
 *
 *   **flag** — publishes nothing, decides nothing, and raises the listing's risk score so a
 *   human opens it sooner. Everything about authenticity lands here. "Replica" has legitimate
 *   uses — a licensed replica shirt is a real product — and an automated refusal that is wrong
 *   is invisible to everyone except the seller it silently stopped.
 *
 * So this never approves anything and never rejects anything a human could reasonably disagree
 * with. It sorts the queue and records why, which is the part that scales.
 */

/** Cached briefly: this runs on every submission and the rule set changes rarely. */
let cache = { rules: null, at: 0 }
const CACHE_MS = 60_000

async function activeRules() {
  if (cache.rules && Date.now() - cache.at < CACHE_MS) return cache.rules
  const rules = await query(
    `SELECT id, effect, match_type, pattern, applies_to, category, reason_code, message, risk_weight
       FROM moderation_rules WHERE is_active = 1`,
  )
  cache = { rules, at: Date.now() }
  return rules
}

function matchesRegex(pattern, target) {
  try { return new RegExp(pattern, 'i').test(target) } catch { return false }
}

/** Let an admin edit take effect without waiting out the cache. */
export function invalidateRuleCache() {
  cache = { rules: null, at: 0 }
}

/**
 * Run the rules over one submission.
 *
 * Returns the flags and a 0-100 risk score. Throws only for a `block` rule, because that is
 * the one outcome the seller must be told about immediately rather than discovering when the
 * listing never appears.
 */
export async function screenProduct({ name, description, subtitle }) {
  const rules = await activeRules()
  const haystack = {
    name: String(name ?? '').toLowerCase(),
    description: String(description ?? '').toLowerCase(),
    subtitle: String(subtitle ?? '').toLowerCase(),
  }

  const flags = []
  let risk = 0

  for (const rule of rules) {
    const fields = rule.applies_to.split(',').map((field) => field.trim()).filter(Boolean)
    const target = fields.map((field) => haystack[field] ?? '').join(' ')
    if (!target) continue

    // Admin-authored patterns, so a broken regex is a configuration error rather than an
    // attack — but it must not take a seller's submission down with it.
    const matched = rule.match_type === 'regex'
      ? matchesRegex(rule.pattern, target)
      : target.includes(String(rule.pattern).toLowerCase())
    if (!matched) continue

    if (rule.effect === 'block') {
      throw badRequest(rule.message || 'This listing cannot be published on Mirwal.', 'LISTING_BLOCKED', [
        { field: 'name', message: rule.message || 'Prohibited item.' },
      ])
    }

    flags.push({ code: rule.reason_code, category: rule.category, matched: rule.pattern, weight: rule.risk_weight })
    risk += Number(rule.risk_weight)
  }

  return { flags, risk: Math.min(risk, 100) }
}

/**
 * Screen a submission and record the outcome against the product.
 *
 * Called after the row exists, so the event has something to reference. Failure here is
 * swallowed: a listing that could not be scored should still reach a human, and refusing the
 * submission because the scoring failed would punish the seller for our problem.
 */
export async function recordScreening(productId, screening, { actorSide = 'seller', actorUserId = null } = {}) {
  try {
    await query(
      'UPDATE products SET moderation_flags = ?, moderation_risk = ? WHERE id = ?',
      [screening.flags.length ? JSON.stringify(screening.flags) : null, screening.risk, productId],
    )
    await query(
      `INSERT INTO product_moderation_events
         (product_id, event_type, to_status, actor_side, actor_user_id, reason_code, note, flags)
       VALUES (?, 'submitted', 'pending_review', ?, ?, ?, ?, ?)`,
      [
        productId,
        actorSide,
        actorUserId,
        screening.flags[0]?.code ?? null,
        screening.flags.length
          ? `Automated screening raised ${screening.flags.length} flag${screening.flags.length > 1 ? 's' : ''}.`
          : 'Automated screening found nothing.',
        screening.flags.length ? JSON.stringify(screening.flags) : null,
      ],
    )
  } catch {
    // See above: scoring is an aid to review, never a gate on submission.
  }
}

/** Record a human decision alongside the automated one, so the two are comparable later. */
export async function recordDecision(productId, { fromStatus, toStatus, actorUserId, reasonCode, note }) {
  try {
    await query(
      `INSERT INTO product_moderation_events
         (product_id, event_type, from_status, to_status, actor_side, actor_user_id, reason_code, note)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, ?)`,
      [
        productId,
        toStatus === 'active' ? 'approved' : toStatus === 'rejected' ? 'rejected' : 'status_changed',
        fromStatus, toStatus, actorUserId, reasonCode ?? null, note ?? null,
      ],
    )
  } catch {
    // A missing history row must not undo a decision an admin already saw succeed.
  }
}

/** The moderation history for one product, newest first. */
export async function history(productId) {
  const rows = await query(
    `SELECT e.event_type, e.from_status, e.to_status, e.actor_side, e.reason_code, e.note,
            e.flags, e.created_at, u.full_name AS actor_name
       FROM product_moderation_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.product_id = ?
      ORDER BY e.created_at DESC, e.id DESC`,
    [productId],
  )
  return rows.map((row) => ({
    type: row.event_type,
    from: row.from_status,
    to: row.to_status,
    side: row.actor_side,
    actor: row.actor_name ?? null,
    reasonCode: row.reason_code,
    note: row.note,
    // mysql2 hands JSON columns back already parsed on some paths and as a string on others,
    // depending on the column type it inferred. `parseJsonColumn` is the codebase's answer to
    // exactly that ambiguity — JSON.parse on an already-parsed object throws.
    flags: parseJsonColumn(row.flags, []),
    at: row.created_at,
  }))
}
