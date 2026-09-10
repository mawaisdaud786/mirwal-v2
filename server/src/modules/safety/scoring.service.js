import { query, queryOne } from '../../db/pool.js'
import { parseJsonColumn } from '../../lib/json.js'
import { notFound } from '../../lib/errors.js'

/**
 * Seller trust and risk.
 *
 * `seller_scores` and `seller_score_history` were created by migration 023 and nothing has ever
 * written to them. Until now Mirwal recorded that a seller sold a counterfeit and had no way to
 * let that fact affect anything afterwards.
 *
 * **Two scores, deliberately.** They answer different questions, for different audiences:
 *
 *   trust (0-100, shown to the seller) — earned standing. Drives badges, search placement,
 *   payout speed and auto-approval eligibility. A seller should be able to see it, understand
 *   it, and improve it; that is the whole point of it existing.
 *
 *   risk (0-100, internal only) — probability of harm. Drives payout holds, manual review and
 *   investigation priority. It is never returned on a seller-facing endpoint, because a seller
 *   who can watch their risk score move can find the thresholds and sit just under them.
 *
 * **What the scores may and may not do.** They may automatically hold a payout, route to manual
 * review, remove auto-approval, or hide a badge — all reversible, all cheap to get wrong. They
 * may never automatically suspend, ban, delist a catalogue or seize funds: those need a human
 * and an audit entry, because the cost of being wrong is a seller's livelihood.
 *
 * **Every factor is stored with its underlying count.** A score with no explanation is unusable
 * in an appeal, and appeals will happen. `factors` holds what was counted, not just the result.
 */

const TRUST_TIERS = [[80, 'platinum'], [60, 'gold'], [40, 'silver'], [20, 'bronze'], [0, 'new']]
const RISK_BANDS = [[70, 'severe'], [45, 'high'], [20, 'medium'], [0, 'low']]

const band = (table, value) => table.find(([floor]) => value >= floor)[1]
const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)))
const rate = (part, whole) => (whole > 0 ? part / whole : 0)

/**
 * Gather the raw counts for one seller.
 *
 * Deliberately one query per concern rather than one wide join: these count different things
 * over different tables, and a single query would produce the classic multiplied-rows problem
 * where a seller with three returns appears to have thirty orders.
 */
async function signals(sellerId) {
  const [fulfilment] = await query(
    `SELECT COUNT(*)                                                    AS items,
            SUM(oi.status = 'delivered')                                AS delivered,
            -- Only the seller's own cancellations count against them. A buyer changing their
            -- mind is not a seller failure, and scoring it as one was the flaw cancelled_by
            -- was added to fix.
            SUM(oi.status = 'cancelled' AND oi.cancelled_by = 'seller')  AS seller_cancelled,
            SUM(oi.status = 'failed_delivery')                           AS failed_delivery,
            SUM(oi.shipped_at IS NOT NULL AND oi.dispatch_due_at IS NOT NULL
                AND oi.shipped_at <= oi.dispatch_due_at)                 AS on_time,
            SUM(oi.shipped_at IS NOT NULL)                               AS shipped
       FROM order_items oi WHERE oi.seller_id = ?`,
    [sellerId],
  )

  const [returns] = await query(
    `SELECT COUNT(*) AS total,
            SUM(status IN ('refunded','replaced')) AS upheld
       FROM return_requests WHERE seller_id = ?`,
    [sellerId],
  )

  const [cases] = await query(
    `SELECT COUNT(*) AS total,
            SUM(resolution_code IN ('upheld','partially_upheld')) AS upheld,
            SUM(case_type = 'counterfeit' AND resolution_code IN ('upheld','partially_upheld')) AS counterfeit_upheld
       FROM cases WHERE against_seller_id = ?`,
    [sellerId],
  )

  const [enforcement] = await query(
    `SELECT COUNT(*) AS total,
            SUM(severity IN ('high','critical')) AS severe,
            -- Recency matters more than history: a warning from two years ago says less about
            -- today than one from last month.
            SUM(created_at >= DATE_SUB(NOW(3), INTERVAL 90 DAY)) AS recent
       FROM seller_enforcement_actions
      WHERE seller_id = ? AND action_type <> 'reinstated'`,
    [sellerId],
  )

  const [listings] = await query(
    `SELECT COUNT(*) AS total,
            SUM(moderation_risk >= 40) AS flagged,
            SUM(status = 'delisted')   AS delisted
       FROM products WHERE seller_id = ? AND deleted_at IS NULL`,
    [sellerId],
  )

  const seller = await queryOne(
    `SELECT created_at, verification_level, rating_average, rating_count, payout_hold,
            (SELECT COUNT(*) FROM seller_bank_accounts b
              WHERE b.seller_id = sellers.id
                AND b.created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
                AND b.replaced_id IS NOT NULL) AS recent_bank_changes
       FROM sellers WHERE id = ?`,
    [sellerId],
  )

  return { fulfilment, returns, cases, enforcement, listings, seller }
}

/**
 * Compute both scores.
 *
 * Trust starts at zero and is earned; risk starts at zero and is incurred. Neither is a
 * transformation of the other — a brand-new seller has low trust and low risk, which is the
 * honest description of "we do not know yet" and would be impossible on a single axis.
 */
export function computeScores(raw) {
  const { fulfilment, returns, cases, enforcement, listings, seller } = raw

  const items = Number(fulfilment.items ?? 0)
  const delivered = Number(fulfilment.delivered ?? 0)
  const shipped = Number(fulfilment.shipped ?? 0)
  const ageDays = seller?.created_at
    ? (Date.now() - new Date(`${seller.created_at}Z`).getTime()) / 86_400_000
    : 0

  // --- trust ---------------------------------------------------------------
  const factors = {}
  let trust = 0

  // Verification is the floor: an unverified seller cannot climb past bronze however well
  // they trade, because standing without identity is standing Mirwal cannot stand behind.
  const verification = { none: 0, basic: 8, identity_verified: 22, business_verified: 28 }
  trust += verification[seller?.verification_level] ?? 0
  factors.verificationLevel = seller?.verification_level ?? 'none'

  // Volume, log-scaled: three perfect orders is not three hundred, and a linear scale would
  // make a large seller unassailable regardless of how they behave.
  const volume = Math.min(20, Math.log10(1 + delivered) * 10)
  trust += volume
  factors.deliveredItems = delivered

  // Rating, weighted by how many reviews back it — the same confidence weighting the AI
  // ranking already uses, so 4.9-from-3 does not outrank 4.6-from-500.
  const ratingCount = Number(seller?.rating_count ?? 0)
  if (ratingCount > 0) {
    const confidence = Math.min(1, Math.log10(1 + ratingCount) / 2)
    trust += ((Number(seller.rating_average) - 3) / 2) * 20 * confidence
  }
  factors.rating = { average: Number(seller?.rating_average ?? 0), count: ratingCount }

  const onTimeRate = rate(Number(fulfilment.on_time ?? 0), shipped)
  if (shipped >= 5) trust += onTimeRate * 15
  factors.onTimeDispatchRate = shipped ? Math.round(onTimeRate * 100) : null

  trust += Math.min(10, ageDays / 36)
  factors.accountAgeDays = Math.round(ageDays)

  const cancelRate = rate(Number(fulfilment.seller_cancelled ?? 0), items)
  trust -= cancelRate * 25
  factors.sellerCancellationRate = items ? Math.round(cancelRate * 100) : null

  const returnRate = rate(Number(returns.upheld ?? 0), items)
  trust -= returnRate * 15
  factors.upheldReturnRate = items ? Math.round(returnRate * 100) : null

  trust -= Math.min(20, Number(enforcement.recent ?? 0) * 7)
  factors.recentEnforcementActions = Number(enforcement.recent ?? 0)

  // --- risk ----------------------------------------------------------------
  let risk = 0

  // An upheld counterfeit finding is the heaviest single signal there is: it is the one thing
  // that says a seller knowingly misrepresented what they sell.
  const counterfeit = Number(cases.counterfeit_upheld ?? 0)
  risk += Math.min(45, counterfeit * 25)
  factors.upheldCounterfeitCases = counterfeit

  const upheldCases = Number(cases.upheld ?? 0)
  risk += Math.min(20, upheldCases * 6)
  factors.upheldCases = upheldCases

  risk += Math.min(15, Number(enforcement.severe ?? 0) * 8)
  factors.severeEnforcement = Number(enforcement.severe ?? 0)

  const flaggedRate = rate(Number(listings.flagged ?? 0), Number(listings.total ?? 0))
  risk += flaggedRate * 15
  factors.flaggedListingRate = Number(listings.total) ? Math.round(flaggedRate * 100) : null

  risk += Math.min(10, Number(listings.delisted ?? 0) * 5)
  factors.delistedListings = Number(listings.delisted ?? 0)

  // Changing where the money goes is the cash-out step of an account takeover. On its own it
  // is not proof of anything, which is why it nudges rather than decides.
  risk += Math.min(10, Number(seller?.recent_bank_changes ?? 0) * 10)
  factors.recentPayoutDestinationChanges = Number(seller?.recent_bank_changes ?? 0)

  const failRate = rate(Number(fulfilment.failed_delivery ?? 0), shipped)
  risk += failRate * 10
  factors.failedDeliveryRate = shipped ? Math.round(failRate * 100) : null

  // A seller with no history is unknown, not safe. A small floor stops a brand-new account
  // from being treated as proven simply because it has done nothing yet.
  if (delivered < 5) {
    risk += 8
    factors.newSeller = true
  }

  return {
    trust: clamp(trust),
    risk: clamp(risk),
    trustTier: band(TRUST_TIERS, clamp(trust)),
    riskBand: band(RISK_BANDS, clamp(risk)),
    factors,
  }
}

/** Recompute and store one seller's scores, keeping the previous value as history. */
export async function recomputeSeller(sellerId) {
  const raw = await signals(sellerId)
  if (!raw.seller) return null
  const scores = computeScores(raw)

  await query(
    `INSERT INTO seller_scores (seller_id, trust_score, risk_score, trust_tier, risk_band, factors, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE
       trust_score = VALUES(trust_score), risk_score = VALUES(risk_score),
       trust_tier = VALUES(trust_tier), risk_band = VALUES(risk_band),
       factors = VALUES(factors), computed_at = NOW(3)`,
    [sellerId, scores.trust, scores.risk, scores.trustTier, scores.riskBand, JSON.stringify(scores.factors)],
  )

  // History is what makes a trend visible — and being shown that their standing is improving
  // is the only thing that makes a score motivating rather than merely punitive.
  await query(
    `INSERT INTO seller_score_history (seller_id, trust_score, risk_score, factors)
     VALUES (?, ?, ?, ?)`,
    [sellerId, scores.trust, scores.risk, JSON.stringify(scores.factors)],
  )

  return scores
}

/** Recompute every trading seller. Called by the background job. */
export async function recomputeAll() {
  const sellers = await query(
    "SELECT id FROM sellers WHERE deleted_at IS NULL AND status IN ('approved','restricted','suspended')",
  )
  let scored = 0
  for (const seller of sellers) {
    // One failure must not stop the sweep: a seller whose score cannot be computed is a
    // missing score, not a reason to leave every later seller unscored too.
    try { await recomputeSeller(seller.id); scored += 1 } catch { /* next seller */ }
  }
  return { scored }
}

/**
 * A seller's own view. Trust only.
 *
 * `risk` is deliberately absent rather than zeroed: returning the field with a fake value
 * would invite a future edit to "fix" it by filling it in.
 */
export async function trustForSeller(sellerId) {
  const row = await queryOne('SELECT * FROM seller_scores WHERE seller_id = ?', [sellerId])
  if (!row) return { score: null, tier: 'new', factors: {}, computedAt: null }

  const factors = parseJsonColumn(row.factors, {})
  return {
    score: Number(row.trust_score),
    tier: row.trust_tier,
    // The counts behind the score, so "why is mine 62" has an answer the seller can act on.
    factors: {
      verificationLevel: factors.verificationLevel,
      deliveredItems: factors.deliveredItems,
      rating: factors.rating,
      onTimeDispatchRate: factors.onTimeDispatchRate,
      accountAgeDays: factors.accountAgeDays,
      sellerCancellationRate: factors.sellerCancellationRate,
      upheldReturnRate: factors.upheldReturnRate,
      recentEnforcementActions: factors.recentEnforcementActions,
    },
    computedAt: row.computed_at,
  }
}

/**
 * The staff view: both scores, every factor, and the trend.
 *
 * Takes the seller's public id and resolves it here, matching `enforcement.history` — an
 * internal auto-increment id is not something a caller should be handling.
 */
export async function scoresForAdmin(sellerPublicId) {
  const seller = await queryOne('SELECT id FROM sellers WHERE public_id = ?', [sellerPublicId])
  if (!seller) throw notFound('Seller not found.')
  const sellerId = seller.id

  const row = await queryOne('SELECT * FROM seller_scores WHERE seller_id = ?', [sellerId])
  const history = await query(
    `SELECT trust_score, risk_score, computed_at FROM seller_score_history
      WHERE seller_id = ? ORDER BY computed_at DESC LIMIT 30`,
    [sellerId],
  )
  if (!row) return { trust: null, risk: null, factors: {}, history: [] }

  return {
    trust: { score: Number(row.trust_score), tier: row.trust_tier },
    risk: { score: Number(row.risk_score), band: row.risk_band },
    factors: parseJsonColumn(row.factors, {}),
    history: history.map((entry) => ({
      trust: Number(entry.trust_score),
      risk: Number(entry.risk_score),
      at: entry.computed_at,
    })).reverse(),
    computedAt: row.computed_at,
  }
}

/** Sellers worth looking at, worst first. The queue a risk manager actually opens. */
export async function riskiestSellers({ limit = 25 } = {}) {
  const rows = await query(
    `SELECT sc.trust_score, sc.risk_score, sc.trust_tier, sc.risk_band, sc.factors, sc.computed_at,
            s.public_id, s.store_name, s.status
       FROM seller_scores sc JOIN sellers s ON s.id = sc.seller_id
      WHERE s.deleted_at IS NULL
      ORDER BY sc.risk_score DESC, sc.trust_score ASC
      LIMIT ?`,
    [limit],
  )
  return rows.map((row) => ({
    seller: { id: row.public_id, storeName: row.store_name, status: row.status },
    trust: { score: Number(row.trust_score), tier: row.trust_tier },
    risk: { score: Number(row.risk_score), band: row.risk_band },
    factors: parseJsonColumn(row.factors, {}),
    computedAt: row.computed_at,
  }))
}
