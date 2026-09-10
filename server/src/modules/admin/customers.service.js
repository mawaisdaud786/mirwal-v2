import { query, queryOne } from '../../db/pool.js'
import { notFound } from '../../lib/errors.js'
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

/**
 * One customer, for staff.
 *
 * There was no detail endpoint at all, so `/admin/customers/*` was a route that bounced
 * straight back to the list — a name in a table was the end of the road. Answering "why is
 * this buyer complaining" meant searching Orders for their name and hoping the spelling
 * matched.
 *
 * Deliberately narrow. This is a support and risk view: what they bought, what went wrong, and
 * what they are owed. It is not a profile editor — an operator has no business rewriting
 * somebody's name or address, and there is no endpoint here that would let them.
 */
export async function getCustomer(publicId) {
  const customer = await queryOne(
    `SELECT u.id, u.public_id, u.full_name, u.email, u.phone, u.city, u.country,
            u.status, u.created_at, u.email_verified_at, u.phone_verified_at, u.last_login_at
       FROM users u WHERE u.public_id = ?`,
    [publicId],
  )
  if (!customer) throw notFound('Customer not found.')

  const [totals] = await query(
    `SELECT COUNT(DISTINCT o.id) AS order_count,
            COALESCE(SUM(CASE WHEN oi.status = 'delivered' THEN oi.line_total ELSE 0 END), 0) AS delivered_value,
            COALESCE(SUM(CASE WHEN oi.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_items,
            COALESCE(SUM(CASE WHEN oi.status = 'returned' THEN 1 ELSE 0 END), 0) AS returned_items,
            COUNT(oi.id) AS item_count,
            MIN(o.created_at) AS first_order_at,
            MAX(o.created_at) AS last_order_at
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.buyer_id = ?`,
    [customer.id],
  )

  const orders = await query(
    `SELECT o.public_id, o.order_number, o.total, o.currency_code, o.status, o.payment_status,
            o.created_at, COUNT(oi.id) AS item_count
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.buyer_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 25`,
    [customer.id],
  )

  const returns = await query(
    `SELECT r.public_id, r.reason, r.status, r.created_at, oi.product_name
       FROM return_requests r JOIN order_items oi ON oi.id = r.order_item_id
      WHERE r.buyer_id = ?
      ORDER BY r.created_at DESC
      LIMIT 10`,
    [customer.id],
  )

  const itemCount = Number(totals.item_count ?? 0)
  const returnedItems = Number(totals.returned_items ?? 0)

  return {
    id: customer.public_id,
    name: customer.full_name,
    email: customer.email,
    phone: customer.phone,
    city: customer.city,
    country: customer.country,
    status: customer.status,
    joinedAt: customer.created_at,
    lastLoginAt: customer.last_login_at,
    // Whether Mirwal can actually reach them, which is the first thing support needs to know.
    emailVerified: Boolean(customer.email_verified_at),
    phoneVerified: Boolean(customer.phone_verified_at),
    totals: {
      orders: Number(totals.order_count ?? 0),
      items: itemCount,
      // Delivered only, matching the seller-side figure, so "spent" never counts a cancelled
      // basket as revenue.
      spent: formatMoney(totals.delivered_value ?? 0),
      cancelledItems: Number(totals.cancelled_items ?? 0),
      returnedItems,
      /**
       * The buyer-side risk signal, stated as a rate rather than a count.
       *
       * Ten returns out of a thousand items is an ordinary shopper; ten out of twelve is a
       * pattern. A raw count invites the wrong conclusion about the marketplace's best
       * customers, who by definition return the most things.
       */
      returnRate: itemCount > 0 ? Math.round((returnedItems / itemCount) * 100) : 0,
      firstOrderAt: totals.first_order_at,
      lastOrderAt: totals.last_order_at,
    },
    orders: orders.map((row) => ({
      id: row.public_id,
      orderNumber: row.order_number,
      itemCount: Number(row.item_count),
      total: formatMoney(row.total, row.currency_code),
      status: row.status,
      paymentStatus: row.payment_status,
      placedAt: row.created_at,
    })),
    returns: returns.map((row) => ({
      id: row.public_id,
      product: row.product_name,
      reason: row.reason,
      status: row.status,
      at: row.created_at,
    })),
  }
}
