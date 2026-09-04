import { query } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'

/**
 * Platform-wide, read-only view of return requests and the refunds they caused.
 *
 * AdminOrderPages.jsx's "Disputes" view has claimed since it was written that "there is
 * still no disputes, refunds or returns system" — true when written, stale now that
 * `return_requests` (migration 005) and `refunds` (migration 008) are real tables with real
 * seller-scoped and buyer-scoped views already built on top of them. This is the same data,
 * read across every seller instead of filtered to one — an admin oversight page, not a new
 * moderation workflow: there is no admin action here (approve/reject already belongs to the
 * seller the request was filed against), only visibility.
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
      pending: disputes.filter((d) => d.status === 'requested').length,
      approved: disputes.filter((d) => d.status === 'approved').length,
      rejected: disputes.filter((d) => d.status === 'rejected').length,
      // A refund a seller still owes the buyer out-of-band (COD/wallet) — the one figure an
      // admin genuinely needs to keep an eye on, since Mirwal cannot force it to happen.
      refundsOwed: disputes.filter((d) => d.refund?.status === 'manual_required').length,
    },
  }
}
