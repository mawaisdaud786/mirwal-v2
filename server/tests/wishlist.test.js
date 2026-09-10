import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * Wishlist (server/src/modules/wishlist).
 *
 * Every "save to wishlist" heart in the app used to be local component state that vanished
 * on the next navigation — nothing was ever stored. These tests cover the two properties
 * that matter now that it is real: it actually persists, and it is strictly per-account
 * (one shopper can never read or delete another's, and signing out leaves nothing readable).
 */

let server
let userA
let userB
let slugs

before(async () => {
  server = await startTestServer()
  userA = await registerTestUser(server.baseUrl, { label: 'wishlist-a' })
  userB = await registerTestUser(server.baseUrl, { label: 'wishlist-b' })
  const rows = await query("SELECT slug FROM products WHERE status = 'active' AND deleted_at IS NULL LIMIT 2")
  slugs = rows.map((row) => row.slug)
})

after(async () => {
  await server.close()
  await closePool()
})

const wishlist = (token, options = {}) => apiFetch(server.baseUrl, '/wishlist', { token, ...options })

test('an unauthenticated visitor has no wishlist to read or write', async () => {
  assert.equal((await apiFetch(server.baseUrl, '/wishlist')).status, 401)
  assert.equal((await apiFetch(server.baseUrl, '/wishlist', { method: 'POST', body: { slug: slugs[0] } })).status, 401)
})

test('saving persists, is idempotent, and removing works', async () => {
  const added = await wishlist(userA.accessToken, { method: 'POST', body: { slug: slugs[0] } })
  assert.equal(added.status, 200)
  assert.equal(added.body.data.count, 1)
  assert.equal(added.body.data.items[0].slug, slugs[0])

  // Saving the same product twice must not create a duplicate — the unique key makes this
  // a no-op, which is what a double-click or a retried request should do.
  const again = await wishlist(userA.accessToken, { method: 'POST', body: { slug: slugs[0] } })
  assert.equal(again.body.data.count, 1)

  // It survives a fresh read, i.e. it is genuinely stored and not just echoed back.
  assert.equal((await wishlist(userA.accessToken)).body.data.count, 1)

  const removed = await apiFetch(server.baseUrl, `/wishlist/${encodeURIComponent(slugs[0])}`, { method: 'DELETE', token: userA.accessToken })
  assert.equal(removed.body.data.count, 0)
})

test('a wishlist is strictly per-account and never leaks between users', async () => {
  await wishlist(userA.accessToken, { method: 'POST', body: { slug: slugs[0] } })
  await wishlist(userB.accessToken, { method: 'POST', body: { slug: slugs[1] } })

  const a = await wishlist(userA.accessToken)
  const b = await wishlist(userB.accessToken)

  assert.deepEqual(a.body.data.items.map((i) => i.slug), [slugs[0]])
  assert.deepEqual(b.body.data.items.map((i) => i.slug), [slugs[1]])

  // User B deleting the slug that only User A saved must not touch User A's row — the
  // DELETE is scoped by user_id, so it matches nothing rather than another account's entry.
  await apiFetch(server.baseUrl, `/wishlist/${encodeURIComponent(slugs[0])}`, { method: 'DELETE', token: userB.accessToken })
  assert.equal((await wishlist(userA.accessToken)).body.data.count, 1, "User B's delete removed User A's wishlist item")
})

test('a product that does not exist is rejected, not silently saved', async () => {
  const { status, body } = await wishlist(userA.accessToken, { method: 'POST', body: { slug: 'no-such-product-anywhere' } })
  assert.equal(status, 404)
  assert.equal(body.error.code, 'PRODUCT_NOT_FOUND')
})

test('an empty slug is rejected by validation', async () => {
  const { status, body } = await wishlist(userA.accessToken, { method: 'POST', body: { slug: '' } })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})
