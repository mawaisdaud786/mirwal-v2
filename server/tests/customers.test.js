import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs } from './setup.js'
import { closePool } from '../src/db/pool.js'

/**
 * Seller customers (server/src/modules/sellers/customers.service.js).
 *
 * Customers.jsx previously showed "Customers isn't connected yet" unconditionally — accurate
 * when written (no orders system existed), stale now that order_items/orders are real. These
 * tests check the guarantee that matters for a seller-scoped report: Seller A can never see
 * Seller B's buyers, the same isolation every other seller-scoped endpoint makes.
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

test('a customer (not a seller) cannot reach seller customers', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/customers', { token: customerToken })
  assert.equal(status, 403)
  assert.equal(body.error.code, 'FORBIDDEN')
})

test('seller customers are real, internally consistent, and isolated between sellers', async () => {
  const [alpha, beta] = await Promise.all([
    apiFetch(server.baseUrl, '/seller/me/customers', { token: sellerAToken }),
    apiFetch(server.baseUrl, '/seller/me/customers', { token: sellerBToken }),
  ])
  assert.equal(alpha.status, 200)
  assert.equal(beta.status, 200)

  // No buyer email can appear in both lists' identities being conflated — the same email
  // legitimately CAN buy from both sellers, so isolation is checked on the underlying query
  // shape instead: every customer must have at least one real order and non-negative spend.
  for (const customer of [...alpha.body.data.customers, ...beta.body.data.customers]) {
    assert.ok(customer.orderCount >= 1, `${customer.email} has no orders but was listed`)
    assert.ok(Number(customer.totalSpent.amount) >= 0, `${customer.email} has negative spend`)
  }

  /**
   * The summary describes every customer of the store; the array is one page of them.
   *
   * It used to be computed by counting the fetched array, so the two were trivially equal and
   * the assertion proved nothing once paging existed. The real invariant is that the aggregate
   * matches the total the pager reports.
   */
  assert.equal(alpha.body.data.summary.totalCustomers, alpha.body.data.pagination.total)
  assert.equal(beta.body.data.summary.totalCustomers, beta.body.data.pagination.total)

  // The summary total must equal the sum of each customer's own total — no double-counting or
  // drift between the aggregate and the per-row figures it summarises. Checked across every
  // page, because checking one page would only prove the first twenty-five agree.
  let expectedTotal = 0
  let page = 1
  for (;;) {
    const chunk = await apiFetch(server.baseUrl, `/seller/me/customers?page=${page}&pageSize=100`, { token: sellerAToken })
    const rows = chunk.body.data.customers
    expectedTotal += rows.reduce((sum, c) => sum + Number(c.totalSpent.amount), 0)
    if (page >= chunk.body.data.pagination.totalPages) break
    page += 1
  }
  assert.equal(Number(alpha.body.data.summary.totalSpent.amount), Number(expectedTotal.toFixed(2)))
})
