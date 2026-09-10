import { query } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'

/** Still someone's problem. Mirrors `uq_return_requests_open` in migration 021. */
const OPEN = new Set(['requested', 'more_info_required', 'approved', 'in_transit', 'received', 'escalated'])

/**
 * Platform-wide, read-only view of return requests and the refunds they caused.
 *
 * AdminOrderPages.jsx's "Disputes" view has claimed since it was written that "there is
 * still no disputes, refunds or returns system" — true when written, stale now that
 * `return_requests` (migration 005) and `refunds` (migration 008) are real tables with real
 * seller-scoped and buyer-scoped views already built on top of them. This is the same data,
 * read across every seller instead of filtered to one.
 *
 * It stays read-only. Deciding a return the buyer has escalated is a different thing with its
 * own permission and its own queue — see `returns.service.js` and `/admin/returns/disputes` —
 * because it moves money against a seller's stated decision, which is not the same authority
 * as being able to look at one.
 */
export async function listDisputes() {
  const rows = await query(
    `SELECT r.public_id, r.reason, r.description, r.status, r.resolution_note, r.created_at, r.resolved_at,
            o.order_number, oi.product_name, oi.quantity, oi.line_total, o.currency_code,
            buyer.full_name AS buyer_name, s.store_name AS seller_name,
            f.status AS refund_status, f.amount AS refund_amount, f.provider AS refund_provider
       FROM return_requests r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN orders o ON o.id = oi.order_id
       JOIN users buyer ON buyer.id = r.buyer_id
       JOIN sellers s ON s.id = r.seller_id
       LEFT JOIN refunds f ON f.return_request_id = r.id
      ORDER BY r.created_at DESC
      LIMIT 200`,
  )

  const disputes = rows.map((row) => ({
    id: row.public_id,
    orderNumber: row.order_number,
    productName: row.product_name,
    quantity: row.quantity,
    amount: formatMoney(row.line_total, row.currency_code),
    buyerName: row.buyer_name,
    sellerName: row.seller_name,
    reason: row.reason,
    description: row.description,
    status: row.status,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    refund: row.refund_status ? { status: row.refund_status, amount: formatMoney(row.refund_amount, row.currency_code), provider: row.refund_provider } : null,
  }))

  return {
    disputes,
    summary: {
      total: disputes.length,
      // Buckets over the whole lifecycle, not the three states this originally knew about.
      // While it counted only requested/approved/rejected, every return that was awaiting a
      // photograph, in transit, received, replaced, withdrawn or escalated fell through all
      // three counters and the summary silently disagreed with the list beside it.
      open: disputes.filter((d) => OPEN.has(d.status)).length,
      awaitingSeller: disputes.filter((d) => d.status === 'requested').length,
      awaitingBuyer: disputes.filter((d) => d.status === 'more_info_required').length,
      inTransit: disputes.filter((d) => d.status === 'in_transit' || d.status === 'received').length,
      escalated: disputes.filter((d) => d.status === 'escalated').length,
      settled: disputes.filter((d) => d.status === 'refunded' || d.status === 'replaced').length,
      rejected: disputes.filter((d) => d.status === 'rejected').length,
      cancelled: disputes.filter((d) => d.status === 'cancelled').length,
      // A refund a seller still owes the buyer out-of-band (COD/wallet) — the one figure an
      // admin genuinely needs to keep an eye on, since Mirwal cannot force it to happen.
      refundsOwed: disputes.filter((d) => d.refund?.status === 'manual_required').length,
    },
  }
}
