import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs } from './setup.js'
import { queryOne, closePool } from '../src/db/pool.js'

/**
 * Checkout re-prices and re-validates stock from the database inside a transaction — nothing
 * the client sends about price or availability is trusted. These tests exercise that against
 * real seed catalogue rows rather than mocking the database, the same way the rest of this
 * suite does.
 *
 * Product choice matters: this file uses Dev Store Alpha's "Car phone holder" (DEV-A-009,
 * seeded with 45 units) specifically because no other test file or manual browser-testing
 * session touches it, so tests here can't race another file's inventory assertions.
 */

let server
let buyer
let sellerAToken
let sellerBToken

const CAR_HOLDER_QUERY = "SELECT public_id FROM products WHERE name = 'Car phone holder' LIMIT 1"
const CAR_HOLDER_STOCK_QUERY = "SELECT i.quantity FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = 'DEV-A-009'"
// Seeded with 0 units.
const OUT_OF_STOCK_QUERY = "SELECT public_id FROM products WHERE name = 'Fast-charging USB-C charger (20-33W)' LIMIT 1"
// Seeded with only 3 units — used once, specifically to request more than are in stock while
// staying under createOrderSchema's quantity cap of 20 (the car holder's 45 in stock means no
// quantity under that cap could ever exceed it).
const LOW_STOCK_QUERY = "SELECT public_id FROM products WHERE name = '65W GaN charger' LIMIT 1"

before(async () => {
  server = await startTestServer()
  buyer = await registerTestUser(server.baseUrl, { label: 'orders-buyer' })
  sellerAToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
  sellerBToken = await loginAs(server.baseUrl, 'seller.b@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  try {
    // Placing an order leaves a real, permanent order row referencing this buyer
    // (fk_orders_buyer is ON DELETE RESTRICT, correctly — Mirwal has no order-deletion
    // feature and a test shouldn't reach around the schema to force one). The throwaway
    // test buyer is left in place rather than deleted; it's clearly labelled
    // test-orders-buyer-<timestamp>@mirwal.test and harmless to leave, the same way a real
    // user with order history could never be deleted either.
  } finally {
    await server.close()
    await closePool()
  }
})

async function placeCarHolderOrder(quantity) {
  const product = await queryOne(CAR_HOLDER_QUERY)
  return apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyer.accessToken,
    body: {
      items: [{ productId: product.public_id, quantity }],
      shippingAddress: { fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1', city: 'Lahore' },
    },
  })
}

test('checkout rejects a genuinely out-of-stock product', async () => {
  const product = await queryOne(OUT_OF_STOCK_QUERY)
  const { status, body } = await apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyer.accessToken,
    body: {
      items: [{ productId: product.public_id, quantity: 1 }],
      shippingAddress: { fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1', city: 'Lahore' },
    },
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'INSUFFICIENT_STOCK')
})

test('checkout requesting more units than are in stock is rejected, not silently clamped', async () => {
  const product = await queryOne(LOW_STOCK_QUERY)
  const { status, body } = await apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyer.accessToken,
    body: {
      items: [{ productId: product.public_id, quantity: 4 }], // only 3 in stock
      shippingAddress: { fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1', city: 'Lahore' },
    },
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'INSUFFICIENT_STOCK')
})

test('checkout creates a real order, prices it server-side, decrements inventory, and the fulfillment/ownership rules around it hold', async () => {
  const stockBefore = await queryOne(CAR_HOLDER_STOCK_QUERY)

  const created = await placeCarHolderOrder(2)
  assert.equal(created.status, 201)
  assert.equal(created.body.data.items.length, 1)
  assert.equal(created.body.data.items[0].quantity, 2)
  assert.equal(created.body.data.status, 'pending')
  assert.ok(created.body.data.orderNumber.startsWith('MW-'))

  const stockAfter = await queryOne(CAR_HOLDER_STOCK_QUERY)
  assert.equal(stockAfter.quantity, stockBefore.quantity - 2)

  const orderItemId = created.body.data.items[0].id

  // The buyer can read their own order back.
  const fetched = await apiFetch(server.baseUrl, `/orders/${created.body.data.id}`, { token: buyer.accessToken })
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.data.orderNumber, created.body.data.orderNumber)

  // The owning seller can move the item forward through the fulfillment state machine.
  const confirmed = await apiFetch(server.baseUrl, `/seller/me/orders/${orderItemId}/status`, {
    method: 'PATCH', token: sellerAToken, body: { status: 'confirmed' },
  })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.data.status, 'confirmed')

  // An invalid forward jump (skipping processing/shipped) is rejected.
  const invalidJump = await apiFetch(server.baseUrl, `/seller/me/orders/${orderItemId}/status`, {
    method: 'PATCH', token: sellerAToken, body: { status: 'delivered' },
  })
  assert.equal(invalidJump.status, 409)
  assert.equal(invalidJump.body.error.code, 'INVALID_STATUS_TRANSITION')

  // A different seller cannot see or modify this order item.
  const otherSellersList = await apiFetch(server.baseUrl, '/seller/me/orders', { token: sellerBToken })
  assert.ok(!otherSellersList.body.data.items.some((item) => item.id === orderItemId))
  const otherSellersPatch = await apiFetch(server.baseUrl, `/seller/me/orders/${orderItemId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'processing' },
  })
  assert.equal(otherSellersPatch.status, 403)

  // Cleanup: cancel restocks the inventory this test decremented, so the shared dev seed
  // catalogue is left exactly as this test found it regardless of pass or fail.
  const cancelled = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, { method: 'PATCH', token: buyer.accessToken })
  assert.equal(cancelled.status, 200)
  const stockRestored = await queryOne(CAR_HOLDER_STOCK_QUERY)
  assert.equal(stockRestored.quantity, stockBefore.quantity)
})

test('a customer token cannot reach the seller-scoped orders endpoint at all', async () => {
  const { status } = await apiFetch(server.baseUrl, '/seller/me/orders', { token: buyer.accessToken })
  assert.equal(status, 403)
})
