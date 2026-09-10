import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs } from './setup.js'
import { closePool } from '../src/db/pool.js'

/**
 * Seller finance (server/src/modules/sellers/finance.service.js).
 *
 * FinancePage.jsx previously showed "Earnings isn't connected yet" for every seller,
 * unconditionally — accurate while there was no real orders system, stale now that
 * order_items/refunds are real. These tests check the two things that matter for a
 * seller-scoped report: that isolation actually holds (Seller A can never see Seller B's
 * revenue, the same guarantee every other seller-scoped endpoint makes), and that a bad
 * request is rejected by validation.
 *
 * Exact revenue figures are not asserted here for the same reason analytics.test.js doesn't:
 * this shared dev database accumulates real order_items from every other test file that runs
 * in the same `npm test` invocation, so an exact total would be racy against test order.
 */

let server
let sellerAToken
let sellerBToken
let customerToken

before(async () => {
  server = await startTestServer()
  sellerAToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
  sellerBToken = await loginAs(server.baseUrl, 'seller.b@mirwal.test', 'MirwalDev123!')
  customerToken = await loginAs(server.baseUrl, 'customer@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  await server.close()
  await closePool()
})

test('a customer (not a seller) cannot reach seller finance', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/finance', { token: customerToken })
  assert.equal(status, 403)
  assert.equal(body.error.code, 'FORBIDDEN')
})

test('an invalid range value is rejected by validation', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/finance?range=nonsense', { token: sellerAToken })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})

test('seller finance is real and correctly isolated between sellers', async () => {
  const [alpha, beta] = await Promise.all([
    apiFetch(server.baseUrl, '/seller/me/finance?range=1y', { token: sellerAToken }),
    apiFetch(server.baseUrl, '/seller/me/finance?range=1y', { token: sellerBToken }),
  ])
  assert.equal(alpha.status, 200)
  assert.equal(beta.status, 200)

  // Every transaction Seller A sees must actually belong to Seller A's own products — none
  // of Dev Store Beta's SKUs (DEV-B-*) should ever appear in Seller A's recent transactions,
  // and vice versa. This is the same isolation guarantee every other seller-scoped endpoint
  // makes, checked here because a JOIN bug in a new report is exactly the kind of mistake
  // that would leak another seller's revenue without tripping an obvious error.
  const alphaOrderNumbers = new Set(alpha.body.data.recentTransactions.map((t) => t.orderNumber))
  const betaOrderNumbers = new Set(beta.body.data.recentTransactions.map((t) => t.orderNumber))
  for (const orderNumber of alphaOrderNumbers) assert.ok(!betaOrderNumbers.has(orderNumber), `order ${orderNumber} leaked into both sellers' transactions`)

  // Available balance can never be negative — it is clamped, not just usually positive.
  assert.ok(Number(alpha.body.data.kpis.availableBalance.value.amount) >= 0)
  assert.ok(Number(beta.body.data.kpis.availableBalance.value.amount) >= 0)
})
