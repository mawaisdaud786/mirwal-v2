import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * Admin catalogue/seller management and seller product management.
 *
 * These endpoints are the first *write* surface the admin panel has ever had, so the tests
 * concentrate on the things a write surface can get wrong that a read surface cannot:
 * privilege (can a seller reach admin writes?), tenancy (can one seller edit another's
 * product?), workflow (can a seller publish themselves?) and destructive safety (does
 * deleting a category orphan its products?).
 *
 * Everything created here is cleaned up in `after`, keyed off names beginning "ZZ Test" so a
 * failed run leaves rows a human can recognise and remove.
 */

let server
let adminToken
let sellerAToken
let sellerBToken
const createdProductIds = []

const CREDENTIALS = {
  admin: { email: 'admin@mirwal.test', password: 'MirwalDev123!' },
  sellerA: { email: 'seller.a@mirwal.test', password: 'MirwalDev123!' },
  sellerB: { email: 'seller.b@mirwal.test', password: 'MirwalDev123!' },
}

async function scopedLogin(scope, credentials) {
  const { status, body } = await apiFetch(server.baseUrl, `/${scope}/auth/login`, {
    method: 'POST', body: credentials,
  })
  if (status !== 200) throw new Error(`${scope} login failed: ${status} ${JSON.stringify(body)}`)
  return body.data.accessToken
}

before(async () => {
  server = await startTestServer()
  adminToken = await scopedLogin('admin', CREDENTIALS.admin)
  sellerAToken = await scopedLogin('seller', CREDENTIALS.sellerA)
  sellerBToken = await scopedLogin('seller', CREDENTIALS.sellerB)
})

after(async () => {
  try {
    for (const publicId of createdProductIds) {
      const rows = await query('SELECT id FROM products WHERE public_id = ?', [publicId])
      if (!rows.length) continue
      const productId = rows[0].id
      await query('DELETE i FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.product_id = ?', [productId])
      await query('DELETE FROM product_variants WHERE product_id = ?', [productId])
      await query('DELETE FROM product_images WHERE product_id = ?', [productId])
      await query('DELETE FROM products WHERE id = ?', [productId])
    }
    await query("DELETE FROM brands WHERE name LIKE 'ZZ Test%'")
    await query("DELETE FROM categories WHERE name LIKE 'ZZ Test%'")
    await query("DELETE FROM audit_logs WHERE entity_id LIKE 'zz-test%'")

    // `sellers.product_count` is a denormalised counter that the create/delete services keep
    // in step. The raw DELETEs above bypass those services, so without this the counter drifts
    // upward by one per product each time this file runs — which then shows up in the admin UI
    // as a store claiming more products than it has. Recomputing (rather than decrementing by
    // the number we happened to create) also repairs drift left by any earlier failed run.
    await query(`
      UPDATE sellers s
         SET s.product_count = (
           SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.deleted_at IS NULL
         )
       WHERE s.deleted_at IS NULL`)

    await server.close()
  } finally { await closePool() }
})

/** Create a product as Seller A and remember it for cleanup. */
async function createSellerProduct(overrides = {}) {
  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/products', {
    method: 'POST',
    token: sellerAToken,
    body: {
      name: `ZZ Test Product ${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      categorySlug: 'travel-safety-and-utility',
      price: '1500',
      quantity: 10,
      ...overrides,
    },
  })
  if (status !== 201) throw new Error(`createSellerProduct failed: ${status} ${JSON.stringify(body)}`)
  createdProductIds.push(body.data.id)
  return body.data
}

// ---------------------------------------------------------------------------
// Privilege: the admin write surface is admin-only
// ---------------------------------------------------------------------------

test('a seller token cannot reach admin catalogue writes', async () => {
  // The seller holds catalog.product.write for their OWN store. That must not be mistaken for
  // authority over the marketplace catalogue — these routes sit behind requireRole as well.
  const attempts = [
    ['POST', '/admin/brands', { name: 'ZZ Test Sneaky Brand' }],
    ['POST', '/admin/categories', { name: 'ZZ Test Sneaky Category' }],
  ]
  for (const [method, path, body] of attempts) {
    const { status } = await apiFetch(server.baseUrl, path, { method, token: sellerAToken, body })
    assert.equal(status, 403, `${method} ${path} must be forbidden for a seller`)
  }
})

test('a customer cannot reach admin catalogue reads or writes', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'admincat' })
  for (const path of ['/admin/products', '/admin/sellers', '/admin/audit-logs', '/admin/inventory']) {
    const { status } = await apiFetch(server.baseUrl, path, { token: user.accessToken })
    assert.equal(status, 403, `${path} must be forbidden for a customer`)
  }
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

// ---------------------------------------------------------------------------
// Seller product workflow
// ---------------------------------------------------------------------------

test('a seller-created product lands in review, not on the storefront', async () => {
  // The approval queue only means something if a seller cannot bypass it. The product must be
  // pending_review, and the public catalogue must not serve it.
  const product = await createSellerProduct()
  assert.equal(product.status, 'pending_review')

  const publicView = await apiFetch(server.baseUrl, `/products/${product.slug}`)
  assert.equal(publicView.status, 404, 'a product awaiting review must not be publicly readable')
})

test('a seller cannot publish their own product to active', async () => {
  const product = await createSellerProduct()
  const { status, body } = await apiFetch(server.baseUrl, `/seller/me/products/${product.id}/status`, {
    method: 'PATCH', token: sellerAToken, body: { status: 'active' },
  })
  // Rejected by the schema, before any service code runs — 'active' is not in the enum a
  // seller may send at all.
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})

test('admin approval publishes the product to the storefront', async () => {
  const product = await createSellerProduct()

  const approval = await apiFetch(server.baseUrl, `/admin/products/${product.id}/approval`, {
    method: 'PATCH', token: adminToken, body: { approved: true },
  })
  assert.equal(approval.status, 200)
  assert.equal(approval.body.data.status, 'active')

  const publicView = await apiFetch(server.baseUrl, `/products/${product.slug}`)
  assert.equal(publicView.status, 200, 'an approved product must be publicly readable')
  assert.equal(publicView.body.data.name, product.name)
})

test('rejecting a product requires a reason, and the reason reaches the seller', async () => {
  const product = await createSellerProduct()

  const noReason = await apiFetch(server.baseUrl, `/admin/products/${product.id}/approval`, {
    method: 'PATCH', token: adminToken, body: { approved: false },
  })
  assert.equal(noReason.status, 400)
  assert.equal(noReason.body.error.code, 'REASON_REQUIRED')

  const rejected = await apiFetch(server.baseUrl, `/admin/products/${product.id}/approval`, {
    method: 'PATCH', token: adminToken, body: { approved: false, reason: 'Images are too low resolution.' },
  })
  assert.equal(rejected.status, 200)

  // The seller must be able to see WHY, or rejection is unactionable.
  const sellerView = await apiFetch(server.baseUrl, `/seller/me/products/${product.id}`, { token: sellerAToken })
  assert.equal(sellerView.status, 200)
  assert.equal(sellerView.body.data.status, 'rejected')
  assert.equal(sellerView.body.data.rejectedReason, 'Images are too low resolution.')
})

test('editing a live listing sends it back for review', async () => {
  // Otherwise approval is a one-time gate: get something bland approved, then swap the
  // content afterwards and keep the "active" status.
  const product = await createSellerProduct()
  await apiFetch(server.baseUrl, `/admin/products/${product.id}/approval`, {
    method: 'PATCH', token: adminToken, body: { approved: true },
  })

  const edited = await apiFetch(server.baseUrl, `/seller/me/products/${product.id}`, {
    method: 'PATCH', token: sellerAToken, body: { name: 'ZZ Test Product Renamed' },
  })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.data.status, 'pending_review')

  const publicView = await apiFetch(server.baseUrl, `/products/${product.slug}`)
  assert.equal(publicView.status, 404, 'an edited listing must leave the storefront until re-approved')
})

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

test("a seller cannot read, edit or delete another seller's product", async () => {
  const product = await createSellerProduct()

  const attempts = [
    ['GET', `/seller/me/products/${product.id}`, undefined],
    ['PATCH', `/seller/me/products/${product.id}`, { price: '1' }],
    ['PATCH', `/seller/me/products/${product.id}/status`, { status: 'archived' }],
    ['DELETE', `/seller/me/products/${product.id}`, undefined],
  ]
  for (const [method, path, body] of attempts) {
    const { status, body: responseBody } = await apiFetch(server.baseUrl, path, { method, token: sellerBToken, body })
    assert.equal(status, 404, `${method} ${path} must not expose Seller A's product to Seller B`)
    // 404 rather than 403 on purpose: a 403 would confirm the id names a real product.
    assert.equal(responseBody.error.code, 'NOT_FOUND')
  }

  // And it is genuinely untouched, not merely reported as failed.
  const owner = await apiFetch(server.baseUrl, `/seller/me/products/${product.id}`, { token: sellerAToken })
  assert.equal(owner.status, 200)
  assert.equal(owner.body.data.price.amount, '1500.00')
})

test("a seller cannot change stock on another seller's variant", async () => {
  const product = await createSellerProduct()
  const variantId = product.variants[0].id

  const { status } = await apiFetch(server.baseUrl, `/seller/me/inventory/${variantId}`, {
    method: 'PATCH', token: sellerBToken, body: { quantity: 0 },
  })
  assert.equal(status, 404)

  const owner = await apiFetch(server.baseUrl, `/seller/me/products/${product.id}`, { token: sellerAToken })
  assert.equal(owner.body.data.variants[0].quantity, 10, 'stock must be unchanged')
})

// ---------------------------------------------------------------------------
// Destructive safety
// ---------------------------------------------------------------------------

test('a category that still holds products cannot be deleted', async () => {
  // products.category_id is NOT NULL, so this is not merely a policy — cascading would be a
  // foreign-key error. The refusal must be a clean, explanatory 409.
  const { status, body } = await apiFetch(server.baseUrl, '/admin/categories/travel-safety-and-utility', {
    method: 'DELETE', token: adminToken,
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'CATEGORY_NOT_EMPTY')
})

test('deleting a product is a soft delete, so order history survives', async () => {
  const product = await createSellerProduct()
  const { status } = await apiFetch(server.baseUrl, `/admin/products/${product.id}`, {
    method: 'DELETE', token: adminToken,
  })
  assert.equal(status, 200)

  const rows = await query('SELECT deleted_at FROM products WHERE public_id = ?', [product.id])
  assert.equal(rows.length, 1, 'the row must still exist')
  assert.notEqual(rows[0].deleted_at, null, 'and be marked deleted rather than removed')
})

// ---------------------------------------------------------------------------
// Seller lifecycle
// ---------------------------------------------------------------------------

test('an illegal seller status transition is refused', async () => {
  const list = await apiFetch(server.baseUrl, '/admin/sellers?status=approved&pageSize=1', { token: adminToken })
  assert.equal(list.status, 200)
  const seller = list.body.data.items[0]
  assert.ok(seller, 'seed data should contain an approved seller')

  const { status, body } = await apiFetch(server.baseUrl, `/admin/sellers/${seller.id}/approve`, {
    method: 'POST', token: adminToken,
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'NO_STATUS_CHANGE')
})

test('suspension requires a reason', async () => {
  const list = await apiFetch(server.baseUrl, '/admin/sellers?status=approved&pageSize=1', { token: adminToken })
  const seller = list.body.data.items[0]

  const { status, body } = await apiFetch(server.baseUrl, `/admin/sellers/${seller.id}/suspend`, {
    method: 'POST', token: adminToken, body: {},
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

test('admin writes are recorded in the audit trail with the acting admin', async () => {
  // The audit_logs table existed from migration 001 but nothing wrote to it until now, so
  // this asserts the write happens at all — and that it names a real actor rather than "system".
  const name = `ZZ Test Audit Brand ${Date.now()}`
  const created = await apiFetch(server.baseUrl, '/admin/brands', {
    method: 'POST', token: adminToken, body: { name },
  })
  assert.equal(created.status, 201)
  const slug = created.body.data.slug

  const logs = await apiFetch(server.baseUrl, '/admin/audit-logs?action=brand.created&pageSize=10', { token: adminToken })
  assert.equal(logs.status, 200)
  const entry = logs.body.data.items.find((item) => item.entityId === slug)
  assert.ok(entry, 'creating a brand should write an audit row')
  assert.equal(entry.actor.email, CREDENTIALS.admin.email)
  assert.equal(entry.metadata.name, name)

  await apiFetch(server.baseUrl, `/admin/brands/${slug}`, { method: 'DELETE', token: adminToken })
})

test('an audit row records the before and after of a stock change', async () => {
  const product = await createSellerProduct()
  const variantId = product.variants[0].id

  const updated = await apiFetch(server.baseUrl, `/admin/inventory/${variantId}`, {
    method: 'PATCH', token: adminToken, body: { quantity: 42 },
  })
  assert.equal(updated.status, 200)

  const logs = await apiFetch(server.baseUrl, '/admin/audit-logs?action=inventory.updated&pageSize=10', { token: adminToken })
  const entry = logs.body.data.items.find((item) => item.entityId === String(variantId))
  assert.ok(entry, 'a stock change should write an audit row')
  assert.equal(entry.metadata.from, 10)
  assert.equal(entry.metadata.to, 42)
})
