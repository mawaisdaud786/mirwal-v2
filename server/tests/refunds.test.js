import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs, shipItem } from './setup.js'
import { queryOne, closePool } from '../src/db/pool.js'

/**
 * Refunds (server/src/modules/payments/refunds.service.js).
 *
 * Card refunds are automated through Stripe; wallet and cash-on-delivery refunds land in
 * 'manual_required' for a human to action, because there is either no verified gateway
 * contract or (for COD) no gateway at all. These tests cover the path that works without any
 * gateway credentials — which is also the one most likely to be wrong, since it depends on
 * COD being marked paid at delivery.
 *
 * Uses Dev Store Beta's "USB microphone" (DEV-B-020, 120 units), untouched by any other
 * test file.
 */

let server
let buyer
let sellerBToken
let sellerAToken

const MIC_QUERY = "SELECT public_id FROM products WHERE name = 'USB microphone' LIMIT 1"

before(async () => {
  server = await startTestServer()
  buyer = await registerTestUser(server.baseUrl, { label: 'refund-buyer' })
  sellerBToken = await loginAs(server.baseUrl, 'seller.b@mirwal.test', 'MirwalDev123!')
  sellerAToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  try {
    // Left in place: this buyer placed real orders (fk_orders_buyer is ON DELETE RESTRICT).
  } finally {
    await server.close()
    await closePool()
  }
})

/** Place a COD order and walk it all the way to delivered. */
async function deliveredOrder() {
  const product = await queryOne(MIC_QUERY)
  const created = await apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyer.accessToken,
    body: {
      items: [{ productId: product.public_id, quantity: 1 }],
      shippingAddress: { fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1', city: 'Karachi' },
      paymentMethod: 'cod',
    },
  })
  assert.equal(created.status, 201)
  const orderItemId = created.body.data.items[0].id

  for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
    // See setup.js: 'shipped' is what a shipment means, so it is created rather than asserted.
    if (status === 'shipped') { await shipItem(server.baseUrl, sellerBToken, orderItemId, apiFetch); continue }
    const result = await apiFetch(server.baseUrl, `/seller/me/orders/${orderItemId}/status`, {
      method: 'PATCH', token: sellerBToken, body: { status },
    })
    assert.equal(result.status, 200, `advancing to ${status} failed`)
  }
  return { order: created.body.data, orderItemId }
}

test('a delivered COD order is marked paid — delivery is the payment event for cash on delivery', async () => {
  const { order } = await deliveredOrder()
  const fetched = await apiFetch(server.baseUrl, `/orders/${order.id}`, { token: buyer.accessToken })
  assert.equal(fetched.body.data.paymentMethod, 'cod')
  assert.equal(fetched.body.data.paymentStatus, 'paid', 'COD must be paid once delivered, or a return would owe nothing')
})

test('approving a return on a paid COD order creates a manual refund the seller must action', async () => {
  const { order, orderItemId } = await deliveredOrder()

  const requested = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'damaged', description: 'Item damaged or defective.' },
  })
  assert.equal(requested.status, 201)
  const returnRequestId = requested.body.data.id

  // Approval no longer creates the refund. It used to, which meant an approved return whose
  // parcel never arrived had already restocked the item and already owed the money. The refund
  // is now owed when the return is actually settled.
  const approved = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'approved' },
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))

  const settledReturn = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'refunded' },
  })
  assert.equal(settledReturn.status, 200, JSON.stringify(settledReturn.body))

  const queue = await apiFetch(server.baseUrl, '/seller/me/refunds', { token: sellerBToken })
  const refund = queue.body.data.find((entry) => entry.orderNumber === order.orderNumber)
  assert.ok(refund, 'a settled return on a paid order must owe a refund')
  assert.equal(refund.status, 'manual_required')
  assert.equal(refund.provider, 'cod')
  // The instruction must actually tell a human what to do, not just name a state.
  assert.ok(refund.manualInstruction && refund.manualInstruction.length > 20)

  // Another seller can neither see it nor settle it.
  const otherQueue = await apiFetch(server.baseUrl, '/seller/me/refunds', { token: sellerAToken })
  assert.ok(!otherQueue.body.data.some((entry) => entry.id === refund.id))
  const intrusion = await apiFetch(server.baseUrl, `/seller/me/refunds/${refund.id}/settle`, {
    method: 'PATCH', token: sellerAToken,
  })
  assert.equal(intrusion.status, 403)

  // The owning seller settles it, and cannot settle it twice.
  const settled = await apiFetch(server.baseUrl, `/seller/me/refunds/${refund.id}/settle`, {
    method: 'PATCH', token: sellerBToken,
  })
  assert.equal(settled.status, 200)
  assert.equal(settled.body.data.status, 'succeeded')

  const again = await apiFetch(server.baseUrl, `/seller/me/refunds/${refund.id}/settle`, {
    method: 'PATCH', token: sellerBToken,
  })
  assert.equal(again.status, 409)

  // A fully-refunded order reads as refunded, not still paid.
  const finalOrder = await apiFetch(server.baseUrl, `/orders/${order.id}`, { token: buyer.accessToken })
  assert.equal(finalOrder.body.data.paymentStatus, 'refunded')
})

test('a buyer sees their own refunds and nobody else\'s', async () => {
  const mine = await apiFetch(server.baseUrl, '/payments/refunds', { token: buyer.accessToken })
  assert.equal(mine.status, 200)
  assert.ok(Array.isArray(mine.body.data))

  const stranger = await registerTestUser(server.baseUrl, { label: 'refund-stranger' })
  const theirs = await apiFetch(server.baseUrl, '/payments/refunds', { token: stranger.accessToken })
  assert.equal(theirs.status, 200)
  assert.equal(theirs.body.data.length, 0, 'a new account must not see anyone else\'s refunds')
})
