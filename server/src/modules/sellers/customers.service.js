import { query } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'

/**
 * A seller's real customer list, replacing Customers.jsx's "Customers isn't connected yet"
 * state — accurate when it was written (no orders system existed), stale now that
 * order_items/orders are real and already scoped to `seller_id` for finance and fulfillment.
 *
 * A "customer" here is any buyer with at least one order_item belonging to this seller, ever.
 * "Total spent" only counts delivered items — the same real-revenue definition finance.service
 * uses — so a customer's spend never includes an order that was cancelled or never fulfilled.
 */
export async function getCustomers(sellerId) {
  const rows = await query(
    `SELECT u.public_id, u.full_name, u.email,
            COUNT(DISTINCT oi.order_id) AS order_count,
            COALESCE(SUM(CASE WHEN oi.status = 'delivered' THEN oi.line_total ELSE 0 END), 0) AS total_spent,
            MAX(o.created_at) AS last_order_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = o.buyer_id
      WHERE oi.seller_id = ?
      GROUP BY u.id
      ORDER BY last_order_at DESC`,
    [sellerId],
  )

  const customers = rows.map((row) => ({
    id: row.public_id,
    name: row.full_name,
    email: row.email,
    orderCount: Number(row.order_count),
    totalSpent: formatMoney(row.total_spent),
    lastOrderAt: row.last_order_at,
  }))

  return {
    customers,
    summary: {
      totalCustomers: customers.length,
      repeatCustomers: customers.filter((c) => c.orderCount > 1).length,
      totalSpent: formatMoney(customers.reduce((sum, c) => sum + Number(c.totalSpent.amount), 0)),
    },
  }
}
