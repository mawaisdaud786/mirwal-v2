import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs } from './setup.js'
import { query, queryOne, closePool } from '../src/db/pool.js'

/**
 * Product reviews (server/src/modules/reviews).
 *
 * The property under test is the one the whole feature exists for: a rating shown to a
 * shopper must be backed by a real purchase. Before this module, `products.rating_average`
 * and `rating_count` were written straight from the mock catalogue and rendered everywhere
 * as though buyers had left them. These tests check that a review cannot be created without
 * a delivered order item the reviewer actually owns, cannot be submitted twice, and that the
 * cached aggregate on `products` always equals the reviews behind it.
 */

let server
let buyerToken
let strangerToken

before(async () => {
  server = await startTestServer()
  buyerToken = await loginAs(server.baseUrl, 'customer@mirwal.test', 'MirwalDev123!')
  strangerToken = (await registerTestUser(server.baseUrl, { label: 'review-stranger' })).accessToken
})

after(async () => {
  await server.close()
  await closePool()
})

test('a product page can read its reviews without signing in', async () => {
  const row = await queryOne('SELECT p.slug FROM products p WHERE p.rating_count > 0 LIMIT 1')
  const { status, body } = await apiFetch(server.baseUrl, `/reviews/product/${row.slug}`)
  assert.equal(status, 200)
  assert.ok(body.data.reviews.length > 0)
  // Every review in this table is purchase-backed, so this must never be false.
  assert.ok(body.data.reviews.every((review) => review.verifiedPurchase))
})

test('writing a review requires a session', async () => {
  const { status } = await apiFetch(server.baseUrl, '/reviews', {
    method: 'POST',
    body: { orderItemId: 1, rating: 5, body: 'An unauthenticated attempt to leave a review.' },
  })
  assert.equal(status, 401)
})

test('a shopper cannot review an order item that belongs to someone else', async () => {
  // A real, delivered item — but it belongs to the seed customer, not this stranger.
  const item = await queryOne("SELECT id FROM order_items WHERE status = 'delivered' LIMIT 1")
  const { status, body } = await apiFetch(server.baseUrl, '/reviews', {
    method: 'POST',
    token: strangerToken,
    body: { orderItemId: item.id, rating: 5, body: 'Reviewing a product I never actually bought.' },
  })
  assert.equal(status, 404, 'someone else’s order item must not be reviewable')
  assert.equal(body.error.code, 'ORDER_ITEM_NOT_FOUND')
})

test('the same purchase cannot be reviewed twice — ratings cannot be inflated', async () => {
  const item = await queryOne(
    'SELECT oi.id FROM order_items oi JOIN product_reviews r ON r.order_item_id = oi.id LIMIT 1',
  )
  const { status, body } = await apiFetch(server.baseUrl, '/reviews', {
    method: 'POST',
    token: buyerToken,
    body: { orderItemId: item.id, rating: 5, body: 'Submitting a second review for the same item.' },
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'ALREADY_REVIEWED')
})

test('an undelivered item cannot be reviewed', async () => {
  const item = await queryOne(
    "SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.status <> 'delivered' AND o.buyer_id = (SELECT id FROM users WHERE email = 'customer@mirwal.test') LIMIT 1",
  )
  if (!item) return // no undelivered seed item in this database run
  const { status, body } = await apiFetch(server.baseUrl, '/reviews', {
    method: 'POST',
    token: buyerToken,
    body: { orderItemId: item.id, rating: 5, body: 'Reviewing something that has not arrived yet.' },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'NOT_DELIVERED')
})

test('every displayed product rating equals the real reviews behind it', async () => {
  // The guarantee that replaces the fabricated seed ratings: no product anywhere may show a
  // rating_count or average that its product_reviews rows do not justify.
  const drift = await query(
    `SELECT p.id FROM products p
      WHERE p.rating_count <> (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id)
         OR ROUND(p.rating_average, 2) <> ROUND(COALESCE((SELECT AVG(r.rating) FROM product_reviews r WHERE r.product_id = p.id), 0), 2)`,
  )
  assert.equal(drift.length, 0, `${drift.length} products show a rating not backed by their reviews`)
})

test('a rating below 1 or above 5 is rejected', async () => {
  for (const rating of [0, 6]) {
    const { status } = await apiFetch(server.baseUrl, '/reviews', {
      method: 'POST',
      token: buyerToken,
      body: { orderItemId: 1, rating, body: 'An out-of-range rating value should not be stored.' },
    })
    assert.equal(status, 400, `rating ${rating} should fail validation`)
  }
})
