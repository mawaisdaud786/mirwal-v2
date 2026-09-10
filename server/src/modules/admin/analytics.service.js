import { withSnapshot } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'
import { toSqlDateTime } from '../../lib/tokens.js'
import { resolveWindow, windowClause, changePercent, zeroFillDaily } from '../../lib/dateRange.js'

/**
 * Real platform analytics, replacing AdminAnalytics.jsx's previous hard-coded numbers
 * (a fixed "Rs. 12,84,50,000" GMV, "85,421" orders, a fabricated top-products table) with
 * aggregates actually computed from `orders`/`order_items`/`refunds`/`sellers`/`products`.
 *
 * Deliberately NOT included: traffic sources, page views, device breakdown, "new vs
 * returning visitors". Those need a web-analytics/session-tracking pipeline (pageview
 * events, device fingerprinting) that does not exist anywhere in this schema — inventing
 * numbers for them would be exactly the fabrication this file exists to remove. They stay
 * off the dashboard until a real events pipeline is built, rather than being faked.
 */

const DAY_MS = 86_400_000

/**
 * GMV is merchandise value only.
 *
 * `subtotal - discount_total`: what the buyer paid for goods, after any promotion. Delivery
 * and tax are deliberately excluded and reported as their own figures below.
 *
 * This used to be `SUM(total)`, which folded shipping and tax into the headline number. Three
 * problems with that:
 *
 *   * it is not comparable — the same basket shipped to Karachi and to Gilgit produced
 *     different "GMV";
 *   * tax is not revenue at all, it is money collected on behalf of the state;
 *   * it disagreed with revenue-by-category and top-products, which sum line items and
 *     therefore never saw shipping or tax. That divergence was masked only because delivery
 *     was hard-coded free, and would have appeared the day Mirwal charged for it.
 *
 * Every revenue figure on this page now means the same thing.
 */
/** `queryOne` over a snapshot reader: the same convenience, on the caller's connection. */
async function readOne(read, sql, params = []) {
  const rows = await read(sql, params)
  return rows[0] ?? null
}

async function ordersSummary(read, start, end) {
  const w = windowClause('created_at', start, end)
  const row = await readOne(read,
    `SELECT COALESCE(SUM(subtotal - discount_total), 0) AS gmv,
            COALESCE(SUM(shipping_fee), 0) AS shipping,
            COALESCE(SUM(tax_total), 0) AS tax,
            COUNT(*) AS orderCount
       FROM orders WHERE status != 'cancelled' ${w.sql}`,
    w.params,
  )
  return {
    gmv: Number(row.gmv),
    shipping: Number(row.shipping),
    tax: Number(row.tax),
    orderCount: Number(row.orderCount),
  }
}

async function refundsSummary(read, start, end) {
  const w = windowClause('created_at', start, end)
  const row = await readOne(read,
    `SELECT COALESCE(SUM(amount), 0) AS refunded
       FROM refunds WHERE status = 'succeeded' ${w.sql}`,
    w.params,
  )
  return Number(row.refunded)
}

/** A snapshot total (all sellers/products/customers that currently qualify) plus how many
 * of those were newly created within the window — the only honest "change" a point-in-time
 * count can report, since Mirwal does not store historical daily snapshots to diff against. */
async function snapshotWithGrowth(read, totalSql, newSql, dateColumn, start, end, prevStart, prevEnd) {
  const total = Number((await readOne(read, totalSql)).count)
  const w = windowClause(dateColumn, start, end)
  const wPrev = windowClause(dateColumn, prevStart, prevEnd)
  // Serial rather than parallel: they share one connection inside the snapshot, and issuing
  // two statements at once on a single connection is not something mysql2 can honour.
  const { count: newCount } = await readOne(read, `${newSql} ${w.sql}`, w.params)
  const { count: prevNewCount } = prevStart
    ? await readOne(read, `${newSql} ${wPrev.sql}`, wPrev.params)
    : { count: null }
  return { total, newCount: Number(newCount), prevNewCount: prevNewCount == null ? null : Number(prevNewCount) }
}

async function revenueTrend(read, start, end) {
  const w = windowClause('DATE(created_at)', start ? new Date(start) : null, end)
  const rows = await read(
    // Same definition as GMV above — merchandise only. The daily line must sum to the
    // headline figure, and it can only do that if both measure the same thing.
    `SELECT DATE(created_at) AS day,
            COALESCE(SUM(subtotal - discount_total), 0) AS revenue,
            COUNT(*) AS orders
       FROM orders
      WHERE status != 'cancelled' ${w.sql}
      GROUP BY DATE(created_at)
      ORDER BY day`,
    w.params,
  )
  const shaped = rows.map((row) => ({ day: row.day, revenue: Number(row.revenue), orders: Number(row.orders) }))
  return zeroFillDaily(shaped, start, end, { revenue: 0, orders: 0 })
}

async function revenueByCategory(read, start, end) {
  const w = windowClause('o.created_at', start, end)
  const rows = await read(
    `SELECT c.slug, c.name,
            -- Net of the discount apportioned onto this line at checkout. line_total is the
            -- gross figure, so summing it disagreed with GMV — which uses orders.total — by
            -- exactly the value of every coupon ever redeemed.
            COALESCE(SUM(oi.line_total - oi.discount_amount), 0) AS revenue,
            COUNT(DISTINCT oi.order_id) AS orders
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE o.status != 'cancelled' ${w.sql}
      GROUP BY c.id, c.slug, c.name
      ORDER BY revenue DESC`,
    w.params,
  )
  const total = rows.reduce((sum, row) => sum + Number(row.revenue), 0)
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    revenue: formatMoney(row.revenue),
    orders: Number(row.orders),
    percent: total > 0 ? Math.round((Number(row.revenue) / total) * 1000) / 10 : 0,
  }))
}

async function topProducts(read, start, end, limit = 8) {
  const w = windowClause('o.created_at', start, end)
  const rows = await read(
    `SELECT p.slug, p.name, c.name AS category, SUM(oi.quantity) AS unitsSold,
            -- Same rule as revenue-by-category: what the buyer actually paid for these goods.
            COALESCE(SUM(oi.line_total - oi.discount_amount), 0) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE o.status != 'cancelled' ${w.sql}
      GROUP BY p.id, p.slug, p.name, c.name
      ORDER BY revenue DESC
      LIMIT ?`,
    [...w.params, limit],
  )
  const total = rows.reduce((sum, row) => sum + Number(row.revenue), 0)
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    category: row.category,
    unitsSold: Number(row.unitsSold),
    revenue: formatMoney(row.revenue),
    percentOfRevenue: total > 0 ? Math.round((Number(row.revenue) / total) * 1000) / 10 : 0,
  }))
}

/** Orders-by-time-of-day for the last real 7 days, independent of the selected range —
 * the panel is fixed to "Last 7 Days" the same way the original (fake) UI labelled it. */
async function revenueHeatmap(read) {
  // Exactly 7 calendar days ending today (today counts as one of the 7), matching the UI's
  // fixed 7-column grid. The SQL bound uses a half-day of headroom so today's early-UTC
  // orders are never excluded by a boundary a few hours too tight.
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 6 * DAY_MS)
  const rows = await read(
    `SELECT DATE(created_at) AS day, FLOOR(HOUR(created_at) / 4) AS bucket, COUNT(*) AS orderCount
       FROM orders
      WHERE status != 'cancelled' AND created_at >= ?
      GROUP BY DATE(created_at), bucket`,
    [toSqlDateTime(start)],
  )
  const byKey = new Map(rows.map((row) => [`${String(row.day).slice(0, 10)}:${row.bucket}`, Number(row.orderCount)]))

  const days = []
  const cursor = new Date(start)
  for (let i = 0; i < 7; i += 1) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  const maxCount = Math.max(1, ...rows.map((row) => Number(row.orderCount)))
  return {
    days,
    // 6 four-hour buckets: 12-4am, 4-8am, 8am-12pm, 12-4pm, 4-8pm, 8pm-12am.
    buckets: [0, 1, 2, 3, 4, 5].map((bucket) => ({
      bucket,
      cells: days.map((day) => {
        const count = byKey.get(`${day}:${bucket}`) ?? 0
        return { day, count, intensity: count / maxCount }
      }),
    })),
  }
}

export async function getOverview({ range, from, to }) {
  const { start, end, prevStart, prevEnd } = resolveWindow({ range, from, to })

  /**
   * One consistent snapshot, not eleven independent moments.
   *
   * These figures are presented as parts of the same whole — GMV is the total of the trend
   * line, and revenue-by-category sums to both — so they have to be read from the same view
   * of the database. Run in parallel they take eleven pooled connections and eleven slightly
   * different instants, and under any real write traffic the headline disagrees with the
   * chart beside it, with nothing on the page to say which is right.
   *
   * The cost is the parallelism: one connection means the reads are serial. For an admin
   * dashboard whose entire job is that its numbers add up, that is the right trade.
   */
  const SELLER_COUNT = "SELECT COUNT(*) AS count FROM sellers WHERE status = 'approved'"
  const PRODUCT_COUNT = "SELECT COUNT(*) AS count FROM products WHERE status = 'active'"
  const CUSTOMER_COUNT = `SELECT COUNT(*) AS count FROM users u
     JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE r.slug = 'customer' AND u.status = 'active'`

  const {
    current, previous, refunded, refundedPrev, sellers, products, customers, trend, byCategory, top, heatmap,
  } = await withSnapshot(async (read) => ({
    current: await ordersSummary(read, start, end),
    previous: prevStart ? await ordersSummary(read, prevStart, prevEnd) : null,
    refunded: await refundsSummary(read, start, end),
    refundedPrev: prevStart ? await refundsSummary(read, prevStart, prevEnd) : null,
    sellers: await snapshotWithGrowth(read, SELLER_COUNT, SELLER_COUNT, 'created_at', start, end, prevStart, prevEnd),
    products: await snapshotWithGrowth(read, PRODUCT_COUNT, PRODUCT_COUNT, 'created_at', start, end, prevStart, prevEnd),
    customers: await snapshotWithGrowth(read, CUSTOMER_COUNT, CUSTOMER_COUNT, 'u.created_at', start, end, prevStart, prevEnd),
    trend: await revenueTrend(read, start, end),
    byCategory: await revenueByCategory(read, start, end),
    top: await topProducts(read, start, end),
    heatmap: await revenueHeatmap(read),
  }))

  return {
    range: { start: start?.toISOString() ?? null, end: end.toISOString() },
    kpis: {
      // Merchandise value: goods after discount, before delivery and tax.
      gmv: { value: formatMoney(current.gmv), changePercent: previous ? changePercent(current.gmv, previous.gmv) : null },
      orders: { value: current.orderCount, changePercent: previous ? changePercent(current.orderCount, previous.orderCount) : null },
      // Tracked separately rather than buried in GMV. Delivery is a cost recovered from the
      // buyer, and tax is collected on behalf of the state — neither is merchandise Mirwal sold.
      shipping: { value: formatMoney(current.shipping), changePercent: previous ? changePercent(current.shipping, previous.shipping) : null },
      tax: { value: formatMoney(current.tax), changePercent: previous ? changePercent(current.tax, previous.tax) : null },
      refunded: { value: formatMoney(refunded), changePercent: refundedPrev != null ? changePercent(refunded, refundedPrev) : null },
      sellers: { value: sellers.total, newInPeriod: sellers.newCount, changePercent: changePercent(sellers.newCount, sellers.prevNewCount) },
      products: { value: products.total, newInPeriod: products.newCount, changePercent: changePercent(products.newCount, products.prevNewCount) },
      customers: { value: customers.total, newInPeriod: customers.newCount, changePercent: changePercent(customers.newCount, customers.prevNewCount) },
    },
    revenueTrend: trend,
    revenueByCategory: byCategory,
    topProducts: top,
    revenueHeatmap: heatmap,
  }
}
