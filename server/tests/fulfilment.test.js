import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs, registerTestUser } from './setup.js'
import { query, queryOne, closePool } from '../src/db/pool.js'

/**
 * Partial cancellation, tax invoices, and the buyer-seller conversation.
 *
 * Three gaps that shared a premise: that an order is a single indivisible thing.
 *
 *   - cancelling was all-or-nothing per line, and only a buyer could do it — `cancelled_by`
 *     existed and only ever held 'buyer', so every cancellation-rate figure scored sellers for
 *     their customers' decisions;
 *   - sales tax was computed on every order and no document ever stated it;
 *   - a buyer's question could reach Mirwal or nobody, never the store holding the parcel.
 *
 * What is worth pinning down here is the money and the boundaries. A partial cancellation must
 * refund what the buyer actually paid — the discounted unit price, not the list price — and the
 * order total must follow the lines. A conversation must be per store, or a basket split across
 * three sellers leaks each buyer's other purchases to competitors.
 */

let server
let buyerToken
let buyerId
let sellerToken
let adminToken
let orderId
let orderItemId
let sellerPublicId

/**
 * A basket with several of one thing, so there is something to partly cancel.
 *
 * Picks a product from Dev Store Alpha with enough stock, so the seller-side cancellation tests
 * have a line they actually own.
 */
async function placeOrder({ quantity = 3 } = {}) {
  const product = await queryOne(
    `SELECT p.public_id FROM products p
       JOIN sellers s ON s.id = p.seller_id
       JOIN product_variants v ON v.product_id = p.id
       JOIN inventory i ON i.variant_id = v.id
      WHERE p.status = 'active' AND p.deleted_at IS NULL
        AND s.slug = 'dev-store-alpha' AND i.quantity >= ?
      ORDER BY i.quantity DESC LIMIT 1`,
    [quantity + 5],
  )
  assert.ok(product, 'the seeder should leave one well-stocked Dev Store Alpha product')

  const created = await apiFetch(server.baseUrl, '/orders', {
    method: 'POST',
    token: buyerToken,
    body: {
      items: [{ productId: product.public_id, quantity }],
      shippingAddress: { fullName: 'Fulfilment Test', phone: '03001234567', line1: '1 Test Road', city: 'Lahore' },
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  return created.body.data
}

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
  sellerToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')

  const buyer = await registerTestUser(server.baseUrl, { label: 'fulfilment' })
  buyerToken = buyer.accessToken
  const [row] = await query('SELECT id FROM users WHERE email = ?', [buyer.email])
  buyerId = row.id

  const order = await placeOrder({ quantity: 3 })
  orderId = order.id

  const [item] = await query(
    `SELECT oi.id, s.public_id AS seller_public_id
       FROM order_items oi JOIN sellers s ON s.id = oi.seller_id
       JOIN orders o ON o.id = oi.order_id
      WHERE o.public_id = ? LIMIT 1`,
    [orderId],
  )
  orderItemId = item.id
  sellerPublicId = item.seller_public_id
})

after(async () => {
  if (buyerId) {
    await query('DELETE FROM order_messages WHERE author_user_id = ?', [buyerId])
  }
  await server?.close()
  await closePool()
})

// --- partial cancellation ----------------------------------------------------

test('a buyer can cancel part of a line, and the money follows', async () => {
  const [before] = await query('SELECT quantity, line_total FROM order_items WHERE id = ?', [orderItemId])
  const unit = Number(before.line_total) / Number(before.quantity)

  const response = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, {
    method: 'PATCH', token: buyerToken, body: { quantity: 1, reason: 'Ordered one too many' },
  })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal(response.body.data.cancelledQuantity, 1)
  assert.equal(response.body.data.remainingQuantity, Number(before.quantity) - 1)

  const [after] = await query(
    'SELECT quantity, line_total, cancelled_quantity, cancelled_amount, status, cancelled_by FROM order_items WHERE id = ?',
    [orderItemId],
  )
  assert.equal(Number(after.quantity), Number(before.quantity) - 1)
  assert.equal(Number(after.cancelled_quantity), 1)
  // Refunded at what the buyer actually paid — the discounted unit price, not the list price.
  assert.equal(Number(after.cancelled_amount).toFixed(2), unit.toFixed(2))
  assert.equal(Number(after.line_total).toFixed(2), (Number(before.line_total) - unit).toFixed(2))
  // The line is still live; only its size changed.
  assert.notEqual(after.status, 'cancelled')
  assert.equal(after.cancelled_by, 'buyer')
})

test('the order total follows the lines', async () => {
  const [order] = await query(
    `SELECT o.total, o.subtotal, o.shipping_fee, o.tax_total, o.status,
            (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = o.id) AS line_sum
       FROM orders o WHERE o.public_id = ?`,
    [orderId],
  )
  assert.equal(Number(order.subtotal).toFixed(2), Number(order.line_sum).toFixed(2))
  assert.equal(
    Number(order.total).toFixed(2),
    (Number(order.subtotal) + Number(order.tax_total) + Number(order.shipping_fee)).toFixed(2),
  )
  // Something was pulled but something survives.
  assert.equal(order.status, 'partially_cancelled')
})

test('a buyer cannot cancel more than is left on the order', async () => {
  const [row] = await query('SELECT quantity FROM order_items WHERE id = ?', [orderItemId])
  const response = await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, {
    method: 'PATCH', token: buyerToken, body: { quantity: Number(row.quantity) + 5 },
  })
  assert.equal(response.status, 400)
  assert.equal(response.body.error.code, 'INVALID_QUANTITY')
})

test('stock goes back when a cancellation happens', async () => {
  const [item] = await query('SELECT variant_id, quantity FROM order_items WHERE id = ?', [orderItemId])
  const [stockBefore] = await query('SELECT quantity FROM inventory WHERE variant_id = ?', [item.variant_id])

  await apiFetch(server.baseUrl, `/orders/items/${orderItemId}/cancel`, {
    method: 'PATCH', token: buyerToken, body: { quantity: 1 },
  })

  const [stockAfter] = await query('SELECT quantity FROM inventory WHERE variant_id = ?', [item.variant_id])
  assert.equal(Number(stockAfter.quantity), Number(stockBefore.quantity) + 1)
})

test('a seller cancelling must say why, and it lands on their record not the buyer\'s', async () => {
  const order = await placeOrder({ quantity: 2 })
  const [item] = await query(
    `SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.public_id = ? AND oi.seller_id = (SELECT id FROM sellers WHERE slug = 'dev-store-alpha')
      LIMIT 1`,
    [order.id],
  )
  if (!item) return // The basket landed entirely with another store; nothing to assert here.

  const bare = await apiFetch(server.baseUrl, `/seller/me/orders/${item.id}/cancel`, {
    method: 'PATCH', token: sellerToken, body: { quantity: 1 },
  })
  assert.equal(bare.status, 400, 'a reason is required')

  const done = await apiFetch(server.baseUrl, `/seller/me/orders/${item.id}/cancel`, {
    method: 'PATCH', token: sellerToken, body: { quantity: 1, reason: 'Out of stock at the warehouse' },
  })
  assert.equal(done.status, 200, JSON.stringify(done.body))

  const [after] = await query('SELECT cancelled_by, cancelled_reason FROM order_items WHERE id = ?', [item.id])
  // The distinction the cancellation-rate figure depends on.
  assert.equal(after.cancelled_by, 'seller')
  assert.equal(after.cancelled_reason, 'Out of stock at the warehouse')
})

test('a seller cannot cancel another store\'s item', async () => {
  const [other] = await query(
    `SELECT oi.id FROM order_items oi
      WHERE oi.seller_id <> (SELECT id FROM sellers WHERE slug = 'dev-store-alpha')
        AND oi.status IN ('pending','confirmed','processing') LIMIT 1`,
  )
  if (!other) return

  const response = await apiFetch(server.baseUrl, `/seller/me/orders/${other.id}/cancel`, {
    method: 'PATCH', token: sellerToken, body: { quantity: 1, reason: 'Not mine to cancel' },
  })
  assert.equal(response.status, 403)
})

// --- invoices ----------------------------------------------------------------

test('an unpaid order has no invoice, because an invoice is not a quotation', async () => {
  const response = await apiFetch(server.baseUrl, `/orders/${orderId}/invoice`, { token: buyerToken })
  assert.equal(response.status, 409)
  assert.equal(response.body.error.code, 'ORDER_NOT_PAID')
})

test('a paid order gets a numbered invoice that states the tax', async () => {
  await query("UPDATE orders SET payment_status = 'paid', paid_at = NOW(3) WHERE public_id = ?", [orderId])

  const response = await apiFetch(server.baseUrl, `/orders/${orderId}/invoice`, { token: buyerToken })
  assert.equal(response.status, 200, JSON.stringify(response.body))

  const invoice = response.body.data
  assert.match(invoice.number, /^[A-Z]+-\d{4}-\d{6}$/)
  assert.ok(invoice.issuer.name)
  assert.ok(invoice.billTo.name)
  assert.ok(Array.isArray(invoice.lines) && invoice.lines.length > 0)
  // Each line says which store supplied it: a multi-seller order is several supplies.
  assert.ok(invoice.lines.every((line) => line.soldBy))
  assert.ok(invoice.totals.tax)
  assert.equal(typeof invoice.taxInclusive, 'boolean')
})

test('an invoice is issued once and does not change underneath the buyer', async () => {
  const first = await apiFetch(server.baseUrl, `/orders/${orderId}/invoice`, { token: buyerToken })
  const second = await apiFetch(server.baseUrl, `/orders/${orderId}/invoice`, { token: buyerToken })
  assert.equal(first.body.data.number, second.body.data.number)

  const [{ n }] = await query(
    'SELECT COUNT(*) AS n FROM order_invoices WHERE order_id = (SELECT id FROM orders WHERE public_id = ?)',
    [orderId],
  )
  assert.equal(Number(n), 1)
})

test('invoice numbers are gapless within the year', async () => {
  const rows = await query(
    "SELECT invoice_number FROM order_invoices WHERE invoice_number LIKE CONCAT('%-', YEAR(NOW()), '-%') ORDER BY id",
  )
  const sequence = rows.map((row) => Number(row.invoice_number.split('-').pop()))
  for (let i = 1; i < sequence.length; i += 1) {
    assert.equal(sequence[i], sequence[i - 1] + 1, 'a gap reads as a deleted invoice')
  }
})

test('an invoice belongs to its buyer alone', async () => {
  const stranger = await registerTestUser(server.baseUrl, { label: 'fulfilment-stranger' })
  const response = await apiFetch(server.baseUrl, `/orders/${orderId}/invoice`, { token: stranger.accessToken })
  assert.equal(response.status, 403)
})

// --- the conversation --------------------------------------------------------

test('a buyer can see which stores are on the order and talk to one', async () => {
  const threads = await apiFetch(server.baseUrl, `/orders/${orderId}/messages`, { token: buyerToken })
  assert.equal(threads.status, 200)
  assert.ok(threads.body.data.length > 0)
  assert.ok(threads.body.data.every((thread) => thread.seller.id && thread.seller.storeName))

  const sent = await apiFetch(server.baseUrl, `/orders/${orderId}/messages/${sellerPublicId}`, {
    method: 'POST', token: buyerToken, body: { body: 'When will this be dispatched?' },
  })
  assert.equal(sent.status, 201, JSON.stringify(sent.body))

  const thread = await apiFetch(server.baseUrl, `/orders/${orderId}/messages/${sellerPublicId}`, { token: buyerToken })
  assert.equal(thread.body.data.messages.at(-1).body, 'When will this be dispatched?')
  assert.equal(thread.body.data.messages.at(-1).side, 'buyer')
})

test('the seller sees it, answers, and the buyer reads the answer', async () => {
  const waiting = await apiFetch(server.baseUrl, '/seller/me/order-messages', { token: sellerToken })
  assert.equal(waiting.status, 200)
  const mine = waiting.body.data.find((thread) => thread.order.id === orderId)
  assert.ok(mine, 'the thread should reach the store it was addressed to')
  assert.ok(mine.unread > 0)

  const replied = await apiFetch(server.baseUrl, `/seller/me/orders/${orderId}/messages`, {
    method: 'POST', token: sellerToken, body: { body: 'It goes out tomorrow morning.' },
  })
  assert.equal(replied.status, 201)

  // Reading marks it read for that side only.
  await apiFetch(server.baseUrl, `/seller/me/orders/${orderId}/messages`, { token: sellerToken })
  const after = await apiFetch(server.baseUrl, '/seller/me/order-messages', { token: sellerToken })
  assert.equal(after.body.data.find((thread) => thread.order.id === orderId).unread, 0)

  const buyerSide = await apiFetch(server.baseUrl, `/orders/${orderId}/messages/${sellerPublicId}`, { token: buyerToken })
  assert.equal(buyerSide.body.data.messages.at(-1).body, 'It goes out tomorrow morning.')
})

test('a thread is per store, and no one else can read it', async () => {
  const stranger = await registerTestUser(server.baseUrl, { label: 'fulfilment-nosy' })
  const denied = await apiFetch(server.baseUrl, `/orders/${orderId}/messages/${sellerPublicId}`, {
    token: stranger.accessToken,
  })
  assert.equal(denied.status, 403)

  // A store with nothing on the order cannot be addressed through it either.
  const [outsider] = await query(
    `SELECT public_id FROM sellers
      WHERE id NOT IN (SELECT seller_id FROM order_items WHERE order_id = (SELECT id FROM orders WHERE public_id = ?))
      LIMIT 1`,
    [orderId],
  )
  if (outsider) {
    const wrongStore = await apiFetch(server.baseUrl, `/orders/${orderId}/messages/${outsider.public_id}`, {
      method: 'POST', token: buyerToken, body: { body: 'Hello?' },
    })
    assert.equal(wrongStore.status, 403)
  }
})

test('an internal staff note is invisible to both parties', async () => {
  const note = await apiFetch(server.baseUrl, `/admin/orders/${orderId}/messages/${sellerPublicId}`, {
    method: 'POST', token: adminToken, body: { body: 'Watching this one — second late dispatch.', isInternal: true },
  })
  assert.equal(note.status, 201, JSON.stringify(note.body))

  const staffView = await apiFetch(server.baseUrl, `/admin/orders/${orderId}/messages/${sellerPublicId}`, { token: adminToken })
  assert.ok(staffView.body.data.messages.some((message) => message.isInternal))

  const buyerView = await apiFetch(server.baseUrl, `/orders/${orderId}/messages/${sellerPublicId}`, { token: buyerToken })
  assert.ok(buyerView.body.data.messages.every((message) => message.body !== 'Watching this one — second late dispatch.'))

  const sellerView = await apiFetch(server.baseUrl, `/seller/me/orders/${orderId}/messages`, { token: sellerToken })
  assert.ok(sellerView.body.data.messages.every((message) => message.body !== 'Watching this one — second late dispatch.'))
})

// --- discretionary refund ----------------------------------------------------

test('Mirwal can refund without a return, and cannot refund more than the order', async () => {
  const [order] = await query('SELECT total FROM orders WHERE public_id = ?', [orderId])

  const tooMuch = await apiFetch(server.baseUrl, `/admin/orders/${orderId}/refund`, {
    method: 'POST',
    token: adminToken,
    body: { amount: String(Number(order.total) * 10), reason: 'Testing the ceiling', kind: 'goodwill' },
  })
  assert.equal(tooMuch.status, 409)
  assert.equal(tooMuch.body.error.code, 'REFUND_EXCEEDS_ORDER')

  const goodwill = await apiFetch(server.baseUrl, `/admin/orders/${orderId}/refund`, {
    method: 'POST',
    token: adminToken,
    body: { amount: '10.00', reason: 'Late delivery, apology', kind: 'goodwill' },
  })
  assert.equal(goodwill.status, 200, JSON.stringify(goodwill.body))

  const [refund] = await query(
    `SELECT kind, reason, return_request_id FROM refunds
      WHERE order_id = (SELECT id FROM orders WHERE public_id = ?) ORDER BY id DESC LIMIT 1`,
    [orderId],
  )
  assert.equal(refund.kind, 'goodwill')
  assert.equal(refund.reason, 'Late delivery, apology')
  // No invented return: that would corrupt the return statistics sellers are scored on.
  assert.equal(refund.return_request_id, null)
})

test('a refund needs a reason, and an ordinary admin permission is not enough on its own', async () => {
  const bare = await apiFetch(server.baseUrl, `/admin/orders/${orderId}/refund`, {
    method: 'POST', token: adminToken, body: { amount: '5.00' },
  })
  assert.equal(bare.status, 400)

  const seller = await apiFetch(server.baseUrl, `/admin/orders/${orderId}/refund`, {
    method: 'POST', token: sellerToken, body: { amount: '5.00', reason: 'Not mine to give' },
  })
  assert.equal(seller.status, 403)
})
