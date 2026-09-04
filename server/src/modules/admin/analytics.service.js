import { query, queryOne } from '../../db/pool.js'
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

async function ordersSummary(start, end) {
  const w = windowClause('created_at', start, end)
  const row = await queryOne(
    `SELECT COALESCE(SUM(total), 0) AS gmv, COUNT(*) AS orderCount
       FROM orders WHERE status != 'cancelled' ${w.sql}`,
    w.params,
  )
  return { gmv: Number(row.gmv), orderCount: Number(row.orderCount) }
}

async function refundsSummary(start, end) {
  const w = windowClause('created_at', start, end)
  const row = await queryOne(
    `SELECT COALESCE(SUM(amount), 0) AS refunded
       FROM refunds WHERE status = 'succeeded' ${w.sql}`,
    w.params,
  )
  return Number(row.refunded)
}

/** A snapshot total (all sellers/products/customers that currently qualify) plus how many
 * of those were newly created within the window — the only honest "change" a point-in-time
 * count can report, since Mirwal does not store historical daily snapshots to diff against. */
async function snapshotWithGrowth(totalSql, newSql, dateColumn, start, end, prevStart, prevEnd) {
  const total = Number((await queryOne(totalSql)).count)
  const w = windowClause(dateColumn, start, end)
  const wPrev = windowClause(dateColumn, prevStart, prevEnd)
  const [{ count: newCount }, { count: prevNewCount }] = await Promise.all([
    queryOne(`${newSql} ${w.sql}`, w.params),
    prevStart ? queryOne(`${newSql} ${wPrev.sql}`, wPrev.params) : { count: null },
  ])
  return { total, newCount: Number(newCount), prevNewCount: prevNewCount == null ? null : Number(prevNewCount) }
}

async function revenueTrend(start, end) {
  const w = windowClause('DATE(created_at)', start ? new Date(start) : null, end)
  const rows = await query(
    `SELECT DATE(created_at) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM orders
      WHERE status != 'cancelled' ${w.sql}
      GROUP BY DATE(created_at)
      ORDER BY day`,
    w.params,
  )
  const shaped = rows.map((row) => ({ day: row.day, revenue: Number(row.revenue), orders: Number(row.orders) }))
  return zeroFillDaily(shaped, start, end, { revenue: 0, orders: 0 })
}

async function revenueByCategory(start, end) {
  const w = windowClause('o.created_at', start, end)
  const rows = await query(
    `SELECT c.slug, c.name, COALESCE(SUM(oi.line_total), 0) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
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

async function topProducts(start, end, limit = 8) {
  const w = windowClause('o.created_at', start, end)
  const rows = await query(
    `SELECT p.slug, p.name, c.name AS category, SUM(oi.quantity) AS unitsSold, COALESCE(SUM(oi.line_total), 0) AS revenue
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
async function revenueHeatmap() {
  // Exactly 7 calendar days ending today (today counts as one of the 7), matching the UI's
  // fixed 7-column grid. The SQL bound uses a half-day of headroom so today's early-UTC
  // orders are never excluded by a boundary a few hours too tight.
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 6 * DAY_MS)
  const rows = await query(
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

  const [current, previous, refunded, refundedPrev, sellers, products, customers, trend, byCategory, top, heatmap] = await Promise.all([
    ordersSummary(start, end),
    prevStart ? ordersSummary(prevStart, prevEnd) : null,
    refundsSummary(start, end),
    prevStart ? refundsSummary(prevStart, prevEnd) : null,
    snapshotWithGrowth(
      "SELECT COUNT(*) AS count FROM sellers WHERE status = 'approved'",
      "SELECT COUNT(*) AS count FROM sellers WHERE status = 'approved'",
      'created_at', start, end, prevStart, prevEnd,
    ),
    snapshotWithGrowth(
      "SELECT COUNT(*) AS count FROM products WHERE status = 'active'",
      "SELECT COUNT(*) AS count FROM products WHERE status = 'active'",
      'created_at', start, end, prevStart, prevEnd,
    ),
    snapshotWithGrowth(
      `SELECT COUNT(*) AS count FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.slug = 'customer' AND u.status = 'active'`,
      `SELECT COUNT(*) AS count FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.slug = 'customer' AND u.status = 'active'`,
      'u.created_at', start, end, prevStart, prevEnd,
    ),
    revenueTrend(start, end),
    revenueByCategory(start, end),
    topProducts(start, end),
    revenueHeatmap(),
  ])

  return {
    range: { start: start?.toISOString() ?? null, end: end.toISOString() },
    kpis: {
      gmv: { value: formatMoney(current.gmv), changePercent: previous ? changePercent(current.gmv, previous.gmv) : null },
      orders: { value: current.orderCount, changePercent: previous ? changePercent(current.orderCount, previous.orderCount) : null },
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
