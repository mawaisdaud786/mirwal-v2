import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * AI shopping assistant (server/src/modules/ai).
 *
 * These tests exist for one reason: to prove the assistant cannot invent a product, price,
 * rating or stock level. That is the guarantee the whole module is built around (docs/AI.md),
 * and it is exactly the kind of property that silently regresses the moment someone adds a
 * "helpful" fallback. Every product the endpoint returns is checked against the real
 * `products` table in the same database.
 */

let server
let realSlugs

before(async () => {
  server = await startTestServer()
  const rows = await query("SELECT slug FROM products WHERE status = 'active' AND deleted_at IS NULL")
  realSlugs = new Set(rows.map((row) => row.slug))
})

after(async () => {
  await server.close()
  await closePool()
})

const ask = (message) => apiFetch(server.baseUrl, '/ai/ask', { method: 'POST', body: { message } })

test('every product the assistant returns is a real catalogue product', async () => {
  for (const message of ['power bank', 'something for my kitchen', 'cheapest phone mount', 'best rated gift under 2000']) {
    const { status, body } = await ask(message)
    assert.equal(status, 200, `"${message}" should succeed`)
    for (const product of body.data.products) {
      assert.ok(realSlugs.has(product.slug), `"${message}" returned a product not in the catalogue: ${product.slug}`)
    }
  }
})

test('prices, ratings and stock in the reply match the database exactly', async () => {
  const { body } = await ask('power bank')
  assert.ok(body.data.products.length > 0, 'expected at least one real match for "power bank"')

  for (const product of body.data.products) {
    const row = await query(
      `SELECT p.price, p.rating_average, p.rating_count,
              COALESCE(SUM(GREATEST(i.quantity - i.reserved, 0)), 0) AS sellable
         FROM products p
         LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
         LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE p.slug = ? GROUP BY p.id`,
      [product.slug],
    )
    const [actual] = row
    assert.equal(Number(product.price.amount), Number(actual.price), `${product.slug} price does not match the database`)
    assert.equal(product.rating.average, Number(actual.rating_average), `${product.slug} rating does not match`)
    assert.equal(product.rating.count, actual.rating_count, `${product.slug} review count does not match`)
    assert.equal(product.availability.inStock, Number(actual.sellable) > 0, `${product.slug} stock state does not match`)
  }
})

test('a product that does not exist yields no products and an honest reply', async () => {
  const { status, body } = await ask('flying carpet with a warp drive')
  assert.equal(status, 200)
  assert.equal(body.data.products.length, 0, 'must not backfill with unrelated products')
  assert.match(body.data.reply, /could not find/i)
  assert.ok(body.data.question, 'an unanswerable request should ask a clarifying question')
})

test('an unmeetable budget is stated honestly, not silently ignored', async () => {
  // Every real product costs more than Rs. 5 — so this can only be answered honestly by
  // saying nothing matched, never by presenting over-budget items as if they fit.
  const { body } = await ask('power bank under 5')
  assert.ok(body.data.relaxed.includes('budget'), 'should report that the budget had to be relaxed')
  assert.match(body.data.reply, /Nothing matched under Rs\. 5\b/)
  for (const product of body.data.products) {
    assert.ok(product.reasons.some((reason) => /over your budget/.test(reason)), `${product.slug} should be labelled as over budget`)
  }
})

test('the extracted budget is actually applied to the results', async () => {
  const { body } = await ask('something under 1000')
  assert.equal(body.data.understood.maxPrice, 1000)
  if (!body.data.relaxed.includes('budget')) {
    for (const product of body.data.products) {
      assert.ok(Number(product.price.amount) <= 1000, `${product.slug} exceeds the stated budget`)
    }
  }
})

test('a too-short message is rejected by validation', async () => {
  const { status, body } = await ask('x')
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})
