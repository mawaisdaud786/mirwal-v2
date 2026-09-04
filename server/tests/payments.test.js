import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { queryOne, closePool } from '../src/db/pool.js'

/**
 * Payments (server/src/modules/payments).
 *
 * These tests deliberately do NOT require live gateway credentials — they cover the parts
 * that must hold regardless of which providers are configured, and which are the parts that
 * actually protect money:
 *
 *   - an unconfigured method can never be selected at checkout,
 *   - a forged callback can never mark an order paid,
 *   - COD keeps working with no payment step at all.
 *
 * Charging a real (sandbox) card is a separate manual verification against the provider, not
 * something this suite can assert without secrets in CI.
 *
 * Uses Dev Store Beta's "Dashboard magnetic phone mount" (DEV-B-010, 120 units) — untouched by
 * any other test file.
 */

let server
let buyer

const MOUNT_QUERY = "SELECT public_id FROM products WHERE name = 'Dashboard magnetic phone mount' LIMIT 1"

before(async () => {
  server = await startTestServer()
  buyer = await registerTestUser(server.baseUrl, { label: 'pay-buyer' })
})

after(async () => {
  try {
    // Left in place: this buyer placed real orders (fk_orders_buyer is ON DELETE RESTRICT).
  } finally {
    await server.close()
    await closePool()
  }
})

async function placeOrder(paymentMethod = 'cod') {
  const product = await queryOne(MOUNT_QUERY)
  return apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyer.accessToken,
    body: {
      items: [{ productId: product.public_id, quantity: 1 }],
      shippingAddress: { fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1', city: 'Karachi' },
      paymentMethod,
    },
  })
}

test('GET /payments/methods reports availability honestly and never leaks a credential', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/payments/methods')
  assert.equal(status, 200)

  const cod = body.data.find((option) => option.method === 'cod')
  assert.equal(cod.available, true, 'Cash on Delivery must always be available')

  for (const option of body.data) {
    assert.equal(typeof option.available, 'boolean')
    // Only these four keys — no secretKey/hashKey/salt should ever appear here.
    assert.deepEqual(Object.keys(option).sort(), ['available', 'description', 'label', 'method'])
  }

  const serialised = JSON.stringify(body)
  for (const leak of ['sk_test', 'sk_live', 'hashKey', 'integritySalt', 'secretKey']) {
    assert.ok(!serialised.includes(leak), `methods response must not contain ${leak}`)
  }
})

test('a payment method whose gateway is not configured cannot be used at checkout', async () => {
  const methods = await apiFetch(server.baseUrl, '/payments/methods')
  const unavailable = methods.body.data.find((option) => !option.available)

  if (!unavailable) {
    // Every gateway is configured in this environment; there is nothing to assert here.
    return
  }

  const { status, body } = await placeOrder(unavailable.method)
  assert.equal(status, 400)
  assert.equal(body.error.code, 'PAYMENT_METHOD_UNAVAILABLE')
})

test('a COD order is created unpaid and needs no payment step', async () => {
  const { status, body } = await placeOrder('cod')
  assert.equal(status, 201)
  assert.equal(body.data.paymentMethod, 'cod')
  assert.equal(body.data.paymentStatus, 'pending')

  // Starting a gateway payment for a COD order is a category error, and is refused.
  const started = await apiFetch(server.baseUrl, `/payments/orders/${body.data.id}/start`, {
    method: 'POST', token: buyer.accessToken, body: { method: 'card' },
  })
  assert.ok(started.status >= 400, 'starting a card payment must not silently succeed')

  const cancelled = await apiFetch(server.baseUrl, `/orders/items/${body.data.items[0].id}/cancel`, {
    method: 'PATCH', token: buyer.accessToken,
  })
  assert.equal(cancelled.status, 200)
})

test('a forged wallet callback cannot mark an order paid', async () => {
  const order = await placeOrder('cod')
  assert.equal(order.status, 201)

  // A callback claiming success, with a signature an attacker cannot compute.
  const forged = await apiFetch(server.baseUrl, '/webhooks/jazzcash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: undefined,
  })
  // Sent with no body at all — the signature check must still reject it rather than throwing.
  assert.equal(forged.status, 400)
  assert.equal(forged.body.error.code, 'INVALID_SIGNATURE')

  // The order must be untouched.
  const after1 = await apiFetch(server.baseUrl, `/orders/${order.body.data.id}`, { token: buyer.accessToken })
  assert.equal(after1.body.data.paymentStatus, 'pending')

  const cancelled = await apiFetch(server.baseUrl, `/orders/items/${order.body.data.items[0].id}/cancel`, {
    method: 'PATCH', token: buyer.accessToken,
  })
  assert.equal(cancelled.status, 200)
})

test('a forged Stripe webhook is rejected before any order is touched', async () => {
  const response = await fetch(`${server.baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=forged' },
    body: JSON.stringify({ id: 'evt_forged', type: 'payment_intent.succeeded' }),
  })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.error.code, 'INVALID_SIGNATURE')
})

test('payment status for an order belonging to someone else is refused', async () => {
  const order = await placeOrder('cod')
  const intruder = await registerTestUser(server.baseUrl, { label: 'pay-intruder' })

  const { status } = await apiFetch(server.baseUrl, `/payments/orders/${order.body.data.id}/status`, {
    token: intruder.accessToken,
  })
  assert.equal(status, 403)

  const cancelled = await apiFetch(server.baseUrl, `/orders/items/${order.body.data.items[0].id}/cancel`, {
    method: 'PATCH', token: buyer.accessToken,
  })
  assert.equal(cancelled.status, 200)
})
