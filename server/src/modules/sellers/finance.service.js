import { query, queryOne } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'
import { resolveWindow, windowClause, changePercent, zeroFillDaily } from '../../lib/dateRange.js'

/**
 * Real seller earnings, replacing FinancePage.jsx's "Earnings isn't connected yet" state —
 * accurate while there was no real orders system, stale now that order_items/refunds are
 * real and scoped to `seller_id`. Everything here is filtered to the one seller calling it;
 * there is no endpoint anywhere that accepts a seller id, so "read another seller's earnings"
 * is not a request that can even be made (see seller.routes.js's own header comment).
 *
 * "Available balance" is a real, honestly-computed number (delivered revenue minus
 * successful refunds) — but there is still no payout/withdrawal table anywhere in this
 * schema, so it is shown as information only. The withdrawal *action* stays disabled in the
 * frontend until a real payout mechanism exists; showing a real balance is not the same
 * claim as being able to move it anywhere yet.
 */

async function revenueSummary(sellerId, statuses, start, end) {
  const w = windowClause('o.created_at', start, end)
  const placeholders = statuses.map(() => '?').join(',')
  const row = await queryOne(
    `SELECT COALESCE(SUM(oi.line_total), 0) AS revenue, COUNT(DISTINCT oi.order_id) AS orderCount
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.seller_id = ? AND oi.status IN (${placeholders}) ${w.sql}`,
    [sellerId, ...statuses, ...w.params],
  )
  return { revenue: Number(row.revenue), orderCount: Number(row.orderCount) }
}

async function refundsSummary(sellerId, start, end) {
  const w = windowClause('rf.created_at', start, end)
  const row = await queryOne(
    `SELECT COALESCE(SUM(rf.amount), 0) AS refunded
       FROM refunds rf
       JOIN return_requests rr ON rr.id = rf.return_request_id
      WHERE rr.seller_id = ? AND rf.status = 'succeeded' ${w.sql}`,
    [sellerId, ...w.params],
  )
  return Number(row.refunded)
}

async function orderStatusBreakdown(sellerId, start, end) {
  const w = windowClause('o.created_at', start, end)
  const rows = await query(
    `SELECT oi.status, COUNT(*) AS count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.seller_id = ? ${w.sql}
      GROUP BY oi.status`,
    [sellerId, ...w.params],
  )
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]))
}

async function revenueTrend(sellerId, start, end) {
  const w = windowClause('DATE(o.created_at)', start ? new Date(start) : null, end)
  const rows = await query(
    `SELECT DATE(o.created_at) AS day, COALESCE(SUM(oi.line_total), 0) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.seller_id = ? AND oi.status = 'delivered' ${w.sql}
      GROUP BY DATE(o.created_at)
      ORDER BY day`,
    [sellerId, ...w.params],
  )
  const shaped = rows.map((row) => ({ day: row.day, revenue: Number(row.revenue) }))
  return zeroFillDaily(shaped, start, end, { revenue: 0 })
}

async function recentTransactions(sellerId, limit = 10) {
  const rows = await query(
    `SELECT oi.id, oi.product_name, oi.quantity, oi.line_total, oi.status, oi.created_at,
            o.order_number, o.currency_code
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.seller_id = ?
      ORDER BY oi.created_at DESC
      LIMIT ?`,
    [sellerId, limit],
  )
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    productName: row.product_name,
    quantity: row.quantity,
    amount: formatMoney(row.line_total, row.currency_code),
    status: row.status,
    createdAt: row.created_at,
  }))
}

const IN_FLIGHT_STATUSES = ['pending', 'confirmed', 'processing', 'shipped']

export async function getOverview(sellerId, { range, from, to }) {
  const { start, end, prevStart, prevEnd } = resolveWindow({ range, from, to })

  const [delivered, deliveredPrev, inFlight, refunded, refundedPrev, breakdown, trend, transactions] = await Promise.all([
    revenueSummary(sellerId, ['delivered'], start, end),
    prevStart ? revenueSummary(sellerId, ['delivered'], prevStart, prevEnd) : null,
    revenueSummary(sellerId, IN_FLIGHT_STATUSES, start, end),
    refundsSummary(sellerId, start, end),
    prevStart ? refundsSummary(sellerId, prevStart, prevEnd) : null,
    orderStatusBreakdown(sellerId, start, end),
    revenueTrend(sellerId, start, end),
    recentTransactions(sellerId),
  ])

  const availableBalance = delivered.revenue - refunded

  return {
    range: { start: start?.toISOString() ?? null, end: end.toISOString() },
    kpis: {
      revenue: { value: formatMoney(delivered.revenue), changePercent: deliveredPrev ? changePercent(delivered.revenue, deliveredPrev.revenue) : null },
      orders: { value: delivered.orderCount, changePercent: deliveredPrev ? changePercent(delivered.orderCount, deliveredPrev.orderCount) : null },
      pending: { value: formatMoney(inFlight.revenue), orderCount: inFlight.orderCount },
      refunded: { value: formatMoney(refunded), changePercent: refundedPrev != null ? changePercent(refunded, refundedPrev) : null },
      availableBalance: { value: formatMoney(Math.max(0, availableBalance)) },
    },
    orderStatusBreakdown: breakdown,
    revenueTrend: trend,
    recentTransactions: transactions,
  }
}
