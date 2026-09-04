import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs } from './setup.js'
import { closePool, queryOne } from '../src/db/pool.js'

/**
 * Admin analytics (server/src/modules/admin/analytics.service.js).
 *
 * AdminAnalytics.jsx previously rendered entirely hard-coded numbers (a fixed GMV, a fake
 * top-products table) with no endpoint behind them at all. These tests check the two things
 * that actually matter for a real analytics endpoint: that it is genuinely gated (not just
 * "logged in", but the specific `analytics.read` permission), and that a bad request is
 * rejected by validation rather than silently defaulting.
 *
 * Whether the numbers it returns are *correct* is exercised indirectly: this suite's own
 * dev-seed order/refund fixtures (from orders.test.js, refunds.test.js, etc.) are real rows,
 * and a manual cross-check against them during development confirmed GMV/order counts/top
 * products matched exactly. Asserting exact figures here would make this file racy against
 * every other test file that places an order in the same shared dev database.
 */

let server
let adminToken
let customerToken

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
  customerToken = await loginAs(server.baseUrl, 'customer@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  await server.close()
  await closePool()
})

test('a customer cannot reach admin analytics', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/analytics', { token: customerToken })
  assert.equal(status, 403)
  assert.equal(body.error.code, 'FORBIDDEN')
})

test('an unauthenticated request is rejected', async () => {
  const { status } = await apiFetch(server.baseUrl, '/admin/analytics')
  assert.equal(status, 401)
})

test('an invalid range value is rejected by validation, not silently defaulted', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/analytics?range=nonsense', { token: adminToken })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})

test('admin analytics returns real, internally-consistent aggregates', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/analytics?range=1y', { token: adminToken })
  assert.equal(status, 200)
  const { kpis, revenueTrend, revenueByCategory, topProducts } = body.data

  // GMV must equal the sum of the trend line's own daily revenue — the two are computed by
  // separate queries, so this catches them silently disagreeing.
  const trendTotal = revenueTrend.reduce((sum, day) => sum + day.revenue, 0)
  assert.equal(Number(kpis.gmv.value.amount), trendTotal)

  // Revenue by category must sum to the same GMV, and every percent must be real, not a
  // placeholder — no category can hold more than 100% of it.
  const categoryTotal = revenueByCategory.reduce((sum, cat) => sum + Number(cat.revenue.amount), 0)
  assert.equal(Math.round(categoryTotal), Math.round(trendTotal))
  for (const cat of revenueByCategory) assert.ok(cat.percent >= 0 && cat.percent <= 100)

  /**
   * Snapshot counts are real database totals rather than a fixed fake number.
   *
   * Compared against the database rather than against a hard-coded 190. Test files run in
   * parallel, and several of them create products and sellers — an exact literal here made
   * this assertion fail depending on which suite happened to be mid-flight, which says
   * nothing about the endpoint. Reading the same tables the KPI reads still catches the
   * thing that matters: a placeholder constant instead of a genuine COUNT.
   */
  const counts = await queryOne(
    `SELECT (SELECT COUNT(*) FROM products WHERE status = 'active')   AS products,
            (SELECT COUNT(*) FROM sellers  WHERE status = 'approved') AS sellers`,
  )
  assert.equal(kpis.products.value, Number(counts.products))
  assert.equal(kpis.sellers.value, Number(counts.sellers))
  assert.ok(kpis.products.value > 0, 'the dev seed has products, so a zero here means the count is not real')

  // Top products cannot claim more revenue than the platform actually made.
  for (const product of topProducts) assert.ok(Number(product.revenue.amount) <= trendTotal + 0.01)
})
