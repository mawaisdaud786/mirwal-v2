import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs, shipItem } from './setup.js'
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
let adminToken

const CABLE_QUERY = "SELECT public_id FROM products WHERE name = 'Lightning braided cable' LIMIT 1"
const CABLE_STOCK_QUERY = "SELECT i.quantity FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = 'DEV-B-004'"

before(async () => {
  server = await startTestServer()
  buyer = await registerTestUser(server.baseUrl, { label: 'returns-buyer' })
  sellerBToken = await loginAs(server.baseUrl, 'seller.b@mirwal.test', 'MirwalDev123!')
  sellerAToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
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
    // 'shipped' is reached by creating a shipment, not by asserting the status.
    if (status === 'shipped') { await shipItem(server.baseUrl, sellerBToken, orderItemId, apiFetch); continue }
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
    method: 'POST', token: buyer.accessToken, body: { reason: 'changed_mind' },
  })
  assert.equal(returnAttempt.status, 201)
  assert.equal(returnAttempt.body.data.status, 'requested')

  const duplicateAttempt = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'changed_mind', description: 'Trying again.' },
  })
  assert.equal(duplicateAttempt.status, 409)
  assert.equal(duplicateAttempt.body.error.code, 'RETURN_ALREADY_REQUESTED')

  const returnRequestId = returnAttempt.body.data.id

  const wrongSeller = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerAToken, body: { status: 'approved' },
  })
  assert.equal(wrongSeller.status, 403)

  // A rejection has to say why. The buyer is shown it, and it is what Mirwal reads if they
  // escalate — so a bare rejection is refused rather than passed on as nothing.
  const bareRejection = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'rejected' },
  })
  assert.equal(bareRejection.status, 400)

  // Approval does not restock and does not owe money. That used to happen here, which meant an
  // approved return whose parcel never arrived had already put the item back on sale and
  // already owed the refund.
  const stockBefore = await queryOne(CABLE_STOCK_QUERY)
  const approved = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'approved' },
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  assert.equal(approved.body.data.status, 'approved')
  assert.equal((await queryOne(CABLE_STOCK_QUERY)).quantity, stockBefore.quantity, 'approval alone must not restock')

  // The buyer posts it back; the seller acknowledges it arrived.
  const posted = await apiFetch(server.baseUrl, `/orders/returns/${returnRequestId}/posted`, {
    method: 'POST', token: buyer.accessToken, body: { tracking: 'TCS123456789' },
  })
  assert.equal(posted.status, 200, JSON.stringify(posted.body))
  assert.equal(posted.body.data.status, 'in_transit')

  const received = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'received' },
  })
  assert.equal(received.status, 200, JSON.stringify(received.body))

  // A refund cannot exceed what was paid for the line — the one guard that keeps a partial
  // refund from becoming an arbitrary payout.
  const tooMuch = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'refunded', refundAmount: '9999999' },
  })
  assert.equal(tooMuch.status, 400)
  assert.equal(tooMuch.body.error.code, 'AMOUNT_TOO_HIGH')

  const refunded = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'refunded', note: 'Refunded in cash.' },
  })
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body))

  const stockAfter = await queryOne(CABLE_STOCK_QUERY)
  assert.equal(stockAfter.quantity, stockBefore.quantity + 1, 'settling a return restocks the returned quantity')

  // A settled return is finished. The transition table refuses anything from here.
  const reResolve = await apiFetch(server.baseUrl, `/seller/me/returns/${returnRequestId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'rejected', note: 'Changed my mind.' },
  })
  assert.equal(reResolve.status, 409)
  assert.equal(reResolve.body.error.code, 'INVALID_RETURN_TRANSITION')
})

test('a return cannot be requested before the item is delivered', async () => {
  const orderItemId = await placeCableOrder(1)
  await advanceStatus(orderItemId, 'confirmed', 'processing')

  const tooEarly = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'wrong_item' },
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

/**
 * Escalation and adjudication.
 *
 * This is the part that did not exist at all: the seller decided a return filed against their
 * own store and that was the end of it. "Disputes" in the admin panel was a read-only SELECT
 * over `return_requests` with no action on it, and migration 021's `escalated_at` /
 * `admin_decision` columns were never written.
 */
test('a buyer can bring Mirwal in on a rejection, and Mirwal can overrule the seller', async () => {
  const orderItemId = await placeCableOrder(1)
  await advanceStatus(orderItemId, 'confirmed', 'processing', 'shipped', 'delivered')

  const filed = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'not_as_described', description: 'The braid is plastic.' },
  })
  assert.equal(filed.status, 201, JSON.stringify(filed.body))
  const returnId = filed.body.data.id

  // Nothing to dispute while the seller still has it in front of them.
  const tooEarly = await apiFetch(server.baseUrl, `/orders/returns/${returnId}/escalate`, {
    method: 'POST', token: buyer.accessToken, body: { note: 'I want Mirwal to look at this right now please.' },
  })
  assert.equal(tooEarly.status, 409)
  assert.equal(tooEarly.body.error.code, 'NOT_ESCALATABLE')

  const rejected = await apiFetch(server.baseUrl, `/seller/me/returns/${returnId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'rejected', note: 'Listing says nylon-braided and it is.' },
  })
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body))

  const escalated = await apiFetch(server.baseUrl, `/orders/returns/${returnId}/escalate`, {
    method: 'POST', token: buyer.accessToken, body: { note: 'The photographs show a braided cable and mine is smooth plastic.' },
  })
  assert.equal(escalated.status, 200, JSON.stringify(escalated.body))
  assert.equal(escalated.body.data.status, 'escalated')

  // Once Mirwal has it, the seller cannot settle the dispute they are a party to.
  const grab = await apiFetch(server.baseUrl, `/seller/me/returns/${returnId}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'approved' },
  })
  assert.equal(grab.status, 409)
  assert.equal(grab.body.error.code, 'RETURN_ESCALATED')

  const queue = await apiFetch(server.baseUrl, '/admin/returns/disputes', { token: adminToken })
  assert.equal(queue.status, 200, JSON.stringify(queue.body))
  assert.ok(queue.body.data.items.some((item) => item.id === returnId), 'the dispute should be in the queue')

  const stockBefore = await queryOne(CABLE_STOCK_QUERY)
  const decided = await apiFetch(server.baseUrl, `/admin/returns/disputes/${returnId}/decide`, {
    method: 'POST', token: adminToken,
    body: { outcome: 'partial', refundAmount: '100.00', note: 'Photographs support the buyer on finish, not on function.' },
  })
  assert.equal(decided.status, 200, JSON.stringify(decided.body))
  assert.equal(decided.body.data.status, 'refunded')
  assert.equal(decided.body.data.adminDecision.outcome, 'partial')
  assert.equal((await queryOne(CABLE_STOCK_QUERY)).quantity, stockBefore.quantity + 1)

  // A decision is made once. Revisiting it would be a second refund on a unique key.
  const again = await apiFetch(server.baseUrl, `/admin/returns/disputes/${returnId}/decide`, {
    method: 'POST', token: adminToken, body: { outcome: 'upheld_seller', note: 'Changed my mind.' },
  })
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'ALREADY_DECIDED')

  // Both sides are told, and the seller is told why — an adjudication a seller cannot learn
  // from is one they will lose again next week.
  const sellerNotifs = await apiFetch(server.baseUrl, '/notifications', { token: sellerBToken })
  assert.ok(sellerNotifs.body.data.some((n) => n.type === 'return_adjudicated'))
  const buyerNotifs = await apiFetch(server.baseUrl, '/notifications', { token: buyer.accessToken })
  const told = buyerNotifs.body.data.find((n) => n.type === 'return_adjudicated')
  assert.ok(told)
  // `formatMoney` returns { amount, currency, display }, so interpolating it whole renders
  // "[object Object]" — which is exactly what the buyer saw before this assertion existed.
  assert.doesNotMatch(told.body, /\[object Object\]/)
  assert.match(told.body, /Rs\./, 'the amount must be readable, not a shape')
})

test('a rejected return can be filed again — a rejection is not a permanent bar', async () => {
  const orderItemId = await placeCableOrder(1)
  await advanceStatus(orderItemId, 'confirmed', 'processing', 'shipped', 'delivered')

  const first = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'missing_parts' },
  })
  assert.equal(first.status, 201)
  await apiFetch(server.baseUrl, `/seller/me/returns/${first.body.data.id}/status`, {
    method: 'PATCH', token: sellerBToken, body: { status: 'rejected', note: 'Everything listed was in the box.' },
  })

  // The old code refused this: it looked for *any* row on the item, so one rejection consumed
  // the buyer's only attempt for good. Migration 021 replaced the index with "one open request
  // per item" precisely so this would work.
  const second = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/return-request`, {
    method: 'POST', token: buyer.accessToken, body: { reason: 'missing_parts', description: 'The clip is genuinely absent.' },
  })
  assert.equal(second.status, 201, JSON.stringify(second.body))

  // Cleanup: settle it so this test leaves the seeded stock as it found it.
  const id = second.body.data.id
  await apiFetch(server.baseUrl, `/seller/me/returns/${id}/status`, { method: 'PATCH', token: sellerBToken, body: { status: 'approved' } })
  const settled = await apiFetch(server.baseUrl, `/seller/me/returns/${id}/status`, { method: 'PATCH', token: sellerBToken, body: { status: 'refunded' } })
  assert.equal(settled.status, 200, JSON.stringify(settled.body))
})
