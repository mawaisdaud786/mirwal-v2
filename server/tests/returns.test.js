import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs } from './setup.js'
import { query, queryOne, closePool } from '../src/db/pool.js'

/**
 * Cancellation is the buyer's own right before anything ships; a return needs the seller's
 * review and is only possible after delivery — see migration 005 and
 * server/src/modules/orders/orders.service.js.
 *
 * Uses Dev Store Beta's "Lightning braided cable" (DEV-B-004, seeded with 45 units) — a
 * product no other test file or manual browser-testing session touches, so this file can't
 * race orders.test.js (which uses Dev Store Alpha's car phone holder) or the demo orders left
 * in the database from earlier manual verification.
 */

let server
let buyer
let sellerBToken
let sellerAToken

const CABLE_QUERY = "SELECT public_id FROM products WHERE name = 'Lightning braided cable' LIMIT 1"
const CABLE_STOCK_QUERY = "SELECT i.quantity FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = 'DEV-B-004'"

before(async () => {
  server = await startTestServer()
  buyer = await registerTestUser(server.baseUrl, { label: 'returns-buyer' })
  sellerBToken = await loginAs(server.baseUrl, 'seller.b@mirwal.test', 'MirwalDev123!')
  sellerAToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  try {
    // Left in place, not deleted: this buyer placed real orders, which fk_orders_buyer
    // (ON DELETE RESTRICT) correctly refuses to orphan — see orders.test.js's after() for
    // the same reasoning. Clearly labelled test-returns-buyer-<timestamp>@mirwal.test.
  } finally {
    await server.close()
    await closePool()
  }
})

async function placeCableOrder(quantity) {
  const product = await queryOne(CABLE_QUERY)
  const result = await apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyer.accessToken,
    body: {
      items: [{ productId: product.public_id, quantity }],
      shippingAddress: { fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1', city: 'Karachi' },
    },
  })
  assert.equal(result.status, 201)
  return result.body.data.items[0].id
}

async function advanceStatus(orderItemId, ...statuses) {
  for (const status of statuses) {
    const result = await apiFetch(server.baseUrl, `/seller/me/orders/${orderItemId}/status`, {
      method: 'PATCH', token: sellerBToken, body: { status },
    })
    assert.equal(result.status, 200, `advancing to ${status} failed: ${JSON.stringify(result.body)}`)
  }
}

test('cancelling an item after it has shipped is rejected', async () => {
  const orderItemId = await placeCableOrder(1)
  await advanceStatus(orderItemId, 'confirmed', 'processing', 'shipped')

  const cancelResult = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, { method: 'PATCH', token: buyer.accessToken })
  assert.equal(cancelResult.status, 409)
  assert.equal(cancelResult.body.error.code, 'CANNOT_CANCEL')

  // Deliver it so a later test in this file can exercise the return path on the same item,
  // and restock manually in `after` isn't needed for this one — the return-approval test
  // below restocks it via the real approve action.
  await advanceStatus(orderItemId, 'delivered')

  const returnAttempt = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'Changed my mind' },
  })
  assert.equal(returnAttempt.status, 201)
  assert.equal(returnAttempt.body.data.returnRequest.status, 'requested')

  const duplicateAttempt = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'Trying again' },
  })
  assert.equal(duplicateAttempt.status, 409)
  assert.equal(duplicateAttempt.body.error.code, 'RETURN_ALREADY_REQUESTED')

  const returnRequestId = returnAttempt.body.data.returnRequest.id

  const wrongSeller = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerAToken, body: { status: 'approved' },
  })
  assert.equal(wrongSeller.status, 403)

  const stockBefore = await queryOne(CABLE_STOCK_QUERY)
  const approved = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'approved', resolutionNote: 'Refunded in cash.' },
  })
  assert.equal(approved.status, 200)
  assert.equal(approved.body.data.status, 'approved')

  const stockAfter = await queryOne(CABLE_STOCK_QUERY)
  assert.equal(stockAfter.quantity, stockBefore.quantity + 1, 'approving a return should restock the returned quantity')

  const reResolve = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'rejected' },
  })
  assert.equal(reResolve.status, 409)
  assert.equal(reResolve.body.error.code, 'RETURN_ALREADY_RESOLVED')
})

test('a return cannot be requested before the item is delivered', async () => {
  const orderItemId = await placeCableOrder(1)
  await advanceStatus(orderItemId, 'confirmed', 'processing')

  const tooEarly = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'Wrong item' },
  })
  assert.equal(tooEarly.status, 409)
  assert.equal(tooEarly.body.error.code, 'ITEM_NOT_DELIVERED')

  // Cleanup: this item never shipped, so cancelling it (still a legal transition from
  // 'processing') restocks the inventory this test decremented.
  const cancelled = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, { method: 'PATCH', token: buyer.accessToken })
  assert.equal(cancelled.status, 200)
})

test('cancelling an item a buyer does not own is rejected', async () => {
  const otherBuyer = await registerTestUser(server.baseUrl, { label: 'returns-intruder' })
  const orderItemId = await placeCableOrder(1)

  const intrusion = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, { method: 'PATCH', token: otherBuyer.accessToken })
  assert.equal(intrusion.status, 403)

  const cancelled = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, { method: 'PATCH', token: buyer.accessToken })
  assert.equal(cancelled.status, 200)
  await query('DELETE FROM users WHERE email = ?', [otherBuyer.email])
})
