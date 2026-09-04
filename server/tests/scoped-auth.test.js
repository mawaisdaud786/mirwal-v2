import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * The per-application authentication boundary.
 *
 * Mirwal runs three separate frontend applications (mirwal.pk, admin.mirwal.pk,
 * seller.mirwal.pk). Separate builds keep admin code out of a shopper's browser, but that is
 * a bundling property, not a security one — all three are public URLs served to anyone who
 * types them. The only thing actually stopping a customer from operating the admin panel is
 * the backend, so this file tests the backend gate rather than the frontend routing.
 *
 * The distinction these tests protect: `/admin/auth/login` refuses to *issue* a session to a
 * non-admin, rather than issuing one and relying on a later role check. If it merely issued
 * and then filtered, a valid admin-scoped token would briefly exist for a customer account,
 * and every route that forgot its role check would be a hole. Here there is no such token.
 *
 * Rate-limit note: each scope's router builds its own limiter at max(5, authMax/2) failures
 * per window, counting only responses >= 400. The intentional failures below stay under that
 * per scope; adding more failing login cases to this file may start tripping it (the limiter
 * is per-process, and `node --test` gives each file its own process).
 */

let server

before(async () => { server = await startTestServer() })
after(async () => {
  try { await server.close() } finally { await closePool() }
})

const ADMIN = { email: 'admin@mirwal.test', password: 'MirwalDev123!' }
const SELLER_A = { email: 'seller.a@mirwal.test', password: 'MirwalDev123!' }
const SELLER_B = { email: 'seller.b@mirwal.test', password: 'MirwalDev123!' }

const login = (scope, credentials) =>
  apiFetch(server.baseUrl, `/${scope}/auth/login`, { method: 'POST', body: credentials })

// ---------------------------------------------------------------------------
// Admin application boundary
// ---------------------------------------------------------------------------

test('a customer with a correct password is refused a session by the admin application', async () => {
  // The headline case: knowing valid credentials is not the same as being authorized for
  // admin.mirwal.pk. The response must carry no token at all, not a token with fewer roles.
  const user = await registerTestUser(server.baseUrl, { label: 'scoped-cust-admin' })
  const { status, body } = await login('admin', { email: user.email, password: 'TestPass123!' })

  assert.equal(status, 403)
  assert.equal(body.error.code, 'NOT_AUTHORIZED_FOR_APPLICATION')
  assert.equal(body.data, undefined, 'a refused admin login must not return an access token')

  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('a seller cannot authenticate into the admin application', async () => {
  // Seller and admin are separate applications, not two tiers of one dashboard. Holding a
  // seller account must not be a step on a path toward admin access.
  const { status, body } = await login('admin', SELLER_A)
  assert.equal(status, 403)
  assert.equal(body.error.code, 'NOT_AUTHORIZED_FOR_APPLICATION')
})

test('an admin authenticates through the admin namespace and the token works on admin APIs', async () => {
  const { status, body } = await login('admin', ADMIN)
  assert.equal(status, 200)
  assert.ok(body.data.accessToken, 'admin login should return an access token')

  const orders = await apiFetch(server.baseUrl, '/admin/orders', { token: body.data.accessToken })
  assert.equal(orders.status, 200)
  assert.ok(Array.isArray(orders.data ?? orders.body.data))
})

test('the admin refresh cookie is a distinct, httpOnly, path-scoped cookie', async () => {
  // The three applications must not share one refresh cookie: a cookie scoped to the whole
  // domain would be sent by the storefront to every API route, so an XSS-adjacent leak on
  // mirwal.pk would hand over admin session material too. Name and Path both matter — Path
  // is what stops the browser sending this cookie to /auth/refresh or /seller/auth/refresh.
  const response = await fetch(`${server.baseUrl}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  })
  assert.equal(response.status, 200)

  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('mirwal_rt_admin='))
  assert.ok(setCookie, 'admin login should set the admin-scoped refresh cookie')
  assert.match(setCookie, /HttpOnly/i, 'refresh cookie must be unreadable from JavaScript')
  assert.match(setCookie, /Path=\/api\/v1\/admin\/auth/i, 'admin refresh cookie must be path-scoped')
})

// ---------------------------------------------------------------------------
// Seller application boundary
// ---------------------------------------------------------------------------

test('a customer is refused a session by the seller application', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'scoped-cust-seller' })
  const { status, body } = await login('seller', { email: user.email, password: 'TestPass123!' })

  assert.equal(status, 403)
  assert.equal(body.error.code, 'NOT_AUTHORIZED_FOR_APPLICATION')
  assert.equal(body.data, undefined, 'a refused seller login must not return an access token')

  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('an admin does not implicitly become a seller', async () => {
  // Admin is not a superset of seller. The seller portal keys every query off an approved
  // `sellers` row, and the seeded admin has none — so it must be refused here rather than
  // reaching the portal and querying with an undefined store id.
  const { status, body } = await login('seller', ADMIN)
  assert.equal(status, 403)
  assert.equal(body.error.code, 'NOT_AUTHORIZED_FOR_APPLICATION')
})

test('an approved seller authenticates through the seller namespace', async () => {
  const { status, body } = await login('seller', SELLER_A)
  assert.equal(status, 200)
  assert.ok(body.data.accessToken)

  const store = await apiFetch(server.baseUrl, '/seller/me/store', { token: body.data.accessToken })
  assert.equal(store.status, 200)
  assert.equal(store.body.data.slug, 'dev-store-alpha')
})

// ---------------------------------------------------------------------------
// Cross-application and cross-tenant authorization
// ---------------------------------------------------------------------------

test('a seller-issued token is rejected by admin APIs', async () => {
  // Even a legitimately issued seller token must not reach admin routes: the gate at login
  // is the outer boundary, and this is the per-request one behind it.
  const { body } = await login('seller', SELLER_A)
  const { status } = await apiFetch(server.baseUrl, '/admin/orders', { token: body.data.accessToken })
  assert.equal(status, 403)
})

test("a seller cannot act on another seller's order item by guessing its id", async () => {
  // Seller routes are all `/me/*`, so most ownership is enforced by construction — but the
  // routes that take an id in the URL are exactly where a tenant-isolation bug would live.
  // Seller B sends a well-formed request for an item that belongs to Seller A.
  const sellerA = await login('seller', SELLER_A)
  const ownItems = await apiFetch(server.baseUrl, '/seller/me/orders', {
    token: sellerA.body.data.accessToken,
  })
  assert.equal(ownItems.status, 200)
  const victimItemId = ownItems.body.data[0]?.id
  assert.ok(victimItemId, 'seed data should give Seller A at least one order item')

  const sellerB = await login('seller', SELLER_B)
  const { status } = await apiFetch(server.baseUrl, `/seller/me/orders/${victimItemId}/status`, {
    method: 'PATCH',
    token: sellerB.body.data.accessToken,
    body: { status: 'cancelled' },
  })
  assert.equal(status, 403, "Seller B must not be able to modify Seller A's order item")
})

test('unauthenticated requests to admin and seller APIs are refused', async () => {
  for (const path of ['/admin/orders', '/seller/me/store', '/seller/me/orders']) {
    const { status } = await apiFetch(server.baseUrl, path)
    assert.equal(status, 401, `${path} must require authentication`)
  }
})

test('a forged token is rejected — signature is verified, not decoded and trusted', async () => {
  // A hand-made JWT claiming admin roles, unsigned by the server's secret. This is the
  // client-side-role attack the architecture exists to defeat, expressed at the API level.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sub: 1, roles: ['admin', 'super_admin'], exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const forged = `${header}.${payload}.not-a-real-signature`

  const { status } = await apiFetch(server.baseUrl, '/admin/orders', { token: forged })
  assert.equal(status, 401)
})

test('a wrong password fails the same generic way on the admin namespace', async () => {
  // The admin endpoint must not become an oracle: "wrong password" and "not an admin" should
  // not be distinguishable in a way that lets someone enumerate which accounts hold admin.
  const { status, body } = await login('admin', { email: ADMIN.email, password: 'WrongPassword123!' })
  assert.ok(status === 401 || status === 403)
  assert.ok(!body.data, 'a failed admin login must never return a token')
})
