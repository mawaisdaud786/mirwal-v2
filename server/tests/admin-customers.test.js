import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs } from './setup.js'
import { closePool } from '../src/db/pool.js'

/**
 * Admin customers and admin reviews (server/src/modules/admin/customers.service.js,
 * reviews.service.js's listForAdmin). AdminCustomerPages.jsx claimed "there is no
 * customer-management system" and admin's reviews view claimed no review text was exposed
 * anywhere — both stale now that order_items and product_reviews are real.
 */

let server
let adminToken
let sellerToken
let customerToken

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
  sellerToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
  customerToken = await loginAs(server.baseUrl, 'customer@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  await server.close()
  await closePool()
})

test('only an admin can reach the platform customer/review lists', async () => {
  for (const path of ['/admin/customers', '/admin/reviews']) {
    assert.equal((await apiFetch(server.baseUrl, path, { token: customerToken })).status, 403, `${path} should refuse a customer`)
    assert.equal((await apiFetch(server.baseUrl, path, { token: sellerToken })).status, 403, `${path} should refuse a seller`)
    assert.equal((await apiFetch(server.baseUrl, path)).status, 401, `${path} should refuse no token`)
  }
})

test('admin customers is real and internally consistent', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/customers', { token: adminToken })
  assert.equal(status, 200)
  assert.ok(body.data.customers.length > 0, 'seed orders should produce at least one customer')
  for (const customer of body.data.customers) {
    assert.ok(customer.orderCount >= 1)
    assert.ok(Number(customer.totalSpent.amount) >= 0)
  }
  assert.equal(body.data.summary.totalCustomers, body.data.customers.length)
  const expectedTotal = body.data.customers.reduce((sum, c) => sum + Number(c.totalSpent.amount), 0)
  assert.equal(Number(body.data.summary.totalSpent.amount), expectedTotal)
})

test('admin reviews spans every seller, not just one', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/reviews', { token: adminToken })
  assert.equal(status, 200)
  assert.ok(body.data.reviews.length > 0)
  const sellers = new Set(body.data.reviews.map((review) => review.sellerName))
  assert.ok(sellers.size >= 2, 'the seed data has reviews across multiple sellers')
  assert.ok(body.data.reviews.every((review) => review.verifiedPurchase))
  assert.equal(body.data.summary.count >= body.data.reviews.length, true)
})
