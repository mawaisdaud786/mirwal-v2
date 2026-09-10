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
export async function getCustomers(sellerId, { page = 1, pageSize = 25, search = '' } = {}) {
  const where = ['oi.seller_id = ?']
  const params = [sellerId]
  if (search) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)')
    const like = `%${search}%`
    params.push(like, like)
  }
  const whereSql = where.join(' AND ')

  const rows = await query(
    `SELECT u.public_id, u.full_name, u.email,
            COUNT(DISTINCT oi.order_id) AS order_count,
            COALESCE(SUM(CASE WHEN oi.status = 'delivered' THEN oi.line_total ELSE 0 END), 0) AS total_spent,
            MAX(o.created_at) AS last_order_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = o.buyer_id
      WHERE ${whereSql}
      GROUP BY u.id
      ORDER BY last_order_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )

  // Distinct buyers, not joined rows: the item join multiplies a buyer by everything they
  // ever bought from this store.
  const [{ total }] = await query(
    `SELECT COUNT(DISTINCT o.buyer_id) AS total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = o.buyer_id
      WHERE ${whereSql}`,
    params,
  )

  /**
   * The summary describes every customer of the store, not the page.
   *
   * It used to be computed by counting the fetched array, so it silently became a description
   * of the first page the moment paging existed.
   */
  const [summary] = await query(
    `SELECT COUNT(*) AS total_customers,
            SUM(order_count > 1) AS repeat_customers,
            COALESCE(SUM(spent), 0) AS total_spent
       FROM (
         SELECT o.buyer_id,
                COUNT(DISTINCT oi.order_id) AS order_count,
                COALESCE(SUM(CASE WHEN oi.status = 'delivered' THEN oi.line_total ELSE 0 END), 0) AS spent
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.seller_id = ?
          GROUP BY o.buyer_id
       ) AS per_buyer`,
    [sellerId],
  )

  return {
    customers: rows.map((row) => ({
      id: row.public_id,
      name: row.full_name,
      email: row.email,
      orderCount: Number(row.order_count),
      totalSpent: formatMoney(row.total_spent),
      lastOrderAt: row.last_order_at,
    })),
    total: Number(total),
    summary: {
      totalCustomers: Number(summary.total_customers),
      repeatCustomers: Number(summary.repeat_customers ?? 0),
      totalSpent: formatMoney(summary.total_spent),
    },
  }
}
