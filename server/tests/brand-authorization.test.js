import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * Brand authorisation.
 *
 * Any seller could attach any brand to any listing, which is the primary counterfeit route on a
 * Pakistani marketplace — it is how unauthorised "Apple" and "Nike" listings reach search.
 * Migration 023 created `brand_authorizations` and nothing ever read it, so the control existed
 * as a table and not as a rule.
 *
 * What matters here is not that a request can be filed but that the gate actually holds:
 *
 *   - an ungated brand costs a seller nothing, because gating every brand would stall the
 *     catalogue for no safety gain;
 *   - a pending request does not grant access, which is the state most likely to be got wrong;
 *   - a refusal must carry a reason, because the seller is shown it;
 *   - an expired authorisation stops working without waiting for the sweep to notice.
 */

let server
let adminToken
let sellerToken
let brandSlug
let categorySlug

const listing = (overrides = {}) => ({
  name: `Gate probe ${Math.random().toString(36).slice(2, 8)}`,
  description: 'A perfectly ordinary product used to exercise the brand gate.',
  categorySlug,
  brandSlug,
  price: '1999',
  quantity: 3,
  condition: 'new',
  ...overrides,
})

const gate = (gated, note = null) => apiFetch(server.baseUrl, `/admin/brands/${brandSlug}/gate`, {
  method: 'PATCH', token: adminToken, body: { gated, note },
})

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
  sellerToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')

  // The seeder creates no brands, so this file makes its own and removes it again.
  const created = await apiFetch(server.baseUrl, '/admin/brands', {
    method: 'POST', token: adminToken, body: { name: `Gate Probe ${Date.now()}` },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))

  const brands = await apiFetch(server.baseUrl, '/admin/brands', { token: adminToken })
  brandSlug = brands.body.data.find((row) => row.name.startsWith('Gate Probe')).slug

  const options = await apiFetch(server.baseUrl, '/seller/me/products/options', { token: sellerToken })
  categorySlug = options.body.data.categories[0].slug
})

after(async () => {
  if (brandSlug) {
    await query('DELETE FROM products WHERE name LIKE ?', ['Gate probe %'])
    await query('DELETE FROM brands WHERE slug = ?', [brandSlug])
  }
  await server?.close()
  await closePool()
})

test('an ungated brand is open to any seller', async () => {
  const response = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST', token: sellerToken, body: listing(),
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
})

test('gating a brand refuses listings from sellers without an authorisation', async () => {
  const gated = await gate(true, 'Send your distributor agreement.')
  assert.equal(gated.status, 200)

  const response = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST', token: sellerToken, body: listing(),
  })
  assert.equal(response.status, 403)
  assert.equal(response.body.error.code, 'BRAND_NOT_AUTHORISED')
  // The seller is told what to do about it, not merely that they cannot.
  assert.match(response.body.error.message, /distributor agreement/i)
})

test('the seller sees the gated brand and can ask for access', async () => {
  const before = await apiFetch(server.baseUrl, '/seller/me/brand-authorizations', { token: sellerToken })
  const row = before.body.data.find((entry) => entry.brand.slug === brandSlug)
  assert.ok(row, 'the gated brand should be listed')
  assert.equal(row.authorization, null)

  const asked = await apiFetch(server.baseUrl, '/seller/me/brand-authorizations', {
    method: 'POST', token: sellerToken, body: { brandSlug },
  })
  assert.equal(asked.status, 201)

  const again = await apiFetch(server.baseUrl, '/seller/me/brand-authorizations', {
    method: 'POST', token: sellerToken, body: { brandSlug },
  })
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'ALREADY_REQUESTED')
})

test('a pending request does not grant access', async () => {
  const response = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST', token: sellerToken, body: listing(),
  })
  assert.equal(response.status, 403)
  assert.equal(response.body.error.code, 'BRAND_AUTHORISATION_PENDING')
})

test('a refusal must carry a reason, because the seller is shown it', async () => {
  const queue = await apiFetch(server.baseUrl, '/admin/brand-authorizations?status=pending', { token: adminToken })
  const request = queue.body.data.items.find((item) => item.brand.slug === brandSlug)
  assert.ok(request, 'the request should be in the pending queue')

  const bare = await apiFetch(server.baseUrl, `/admin/brand-authorizations/${request.id}`, {
    method: 'PATCH', token: adminToken, body: { approved: false },
  })
  assert.equal(bare.status, 400)
})

test('approving lets the listing through, and the decision is final', async () => {
  const queue = await apiFetch(server.baseUrl, '/admin/brand-authorizations?status=pending', { token: adminToken })
  const request = queue.body.data.items.find((item) => item.brand.slug === brandSlug)

  const decided = await apiFetch(server.baseUrl, `/admin/brand-authorizations/${request.id}`, {
    method: 'PATCH', token: adminToken, body: { approved: true, validUntil: '2099-12-31' },
  })
  assert.equal(decided.status, 200, JSON.stringify(decided.body))

  const allowed = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST', token: sellerToken, body: listing(),
  })
  assert.equal(allowed.status, 201, JSON.stringify(allowed.body))

  const twice = await apiFetch(server.baseUrl, `/admin/brand-authorizations/${request.id}`, {
    method: 'PATCH', token: adminToken, body: { approved: true },
  })
  assert.equal(twice.status, 409)
  assert.equal(twice.body.error.code, 'ALREADY_DECIDED')
})

test('an expired authorisation stops working without waiting for the sweep', async () => {
  // The background job flips the status, but the check must not depend on it having run —
  // an agreement that lapsed overnight should not grant access until a job notices.
  // Both dates move: `ck_brand_auth_window` will not accept a window that ends before it began.
  await query(
    `UPDATE brand_authorizations a
       JOIN brands b ON b.id = a.brand_id
        SET a.valid_from = '2019-01-01', a.valid_until = '2020-01-01'
      WHERE b.slug = ?`,
    [brandSlug],
  )

  const response = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST', token: sellerToken, body: listing(),
  })
  assert.equal(response.status, 403)
  assert.equal(response.body.error.code, 'BRAND_AUTHORISATION_EXPIRED')
})

test('ungating the brand reopens it to everyone', async () => {
  assert.equal((await gate(false)).status, 200)

  const response = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST', token: sellerToken, body: listing(),
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
})
