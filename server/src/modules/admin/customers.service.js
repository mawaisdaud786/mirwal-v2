import { query } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'

/**
 * The platform-wide customer list — every buyer who has ever placed an order, aggregated
 * from real order_items/orders/users. Same shape and same rule as
 * sellers/customers.service.js (delivered items only count toward "total spent"), just
 * without the `seller_id` filter, since an admin legitimately sees across the whole
 * marketplace rather than one store.
 *
 * This replaces AdminCustomerPages.jsx's "there is no customer-management system" state —
 * that was accurate before order_items existed, stale now.
 */
export async function getCustomers() {
  const rows = await query(
    `SELECT u.public_id, u.full_name, u.email, u.created_at AS joined_at,
            COUNT(DISTINCT o.id) AS order_count,
            COALESCE(SUM(CASE WHEN oi.status = 'delivered' THEN oi.line_total ELSE 0 END), 0) AS total_spent,
            MAX(o.created_at) AS last_order_at
       FROM users u
       JOIN orders o ON o.buyer_id = u.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY u.id
      ORDER BY last_order_at DESC`,
  )

  const customers = rows.map((row) => ({
    id: row.public_id,
    name: row.full_name,
    email: row.email,
    joinedAt: row.joined_at,
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
