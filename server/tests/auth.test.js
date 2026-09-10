import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

let server

before(async () => { server = await startTestServer() })
after(async () => {
  try { await server.close() } finally { await closePool() }
})

test('POST /auth/refresh with no cookie returns a clean 401, not a 500', async () => {
  // Regression test: auth.service.js's rotateRefreshToken() used to call
  // hashRefreshToken(undefined), which throws inside crypto.createHash().update() — the
  // universal first-visit case, since the frontend calls this unconditionally on every app
  // boot to find out who (if anyone) is signed in.
  const { status, body } = await apiFetch(server.baseUrl, '/auth/refresh', { method: 'POST' })
  assert.equal(status, 401)
  assert.equal(body.error.code, 'REFRESH_INVALID')
})

test('register then a duplicate email is rejected', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'dup' })
  const { status, body } = await apiFetch(server.baseUrl, '/auth/register', {
    method: 'POST',
    body: { email: user.email, password: 'AnotherPass123!', fullName: 'Someone Else' },
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'EMAIL_TAKEN')
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('login with the wrong password fails with a generic message', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'wrongpw' })
  const { status, body } = await apiFetch(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: { email: user.email, password: 'NotTheRightPassword!' },
  })
  assert.equal(status, 401)
  assert.equal(body.error.code, 'INVALID_CREDENTIALS')
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('self-registration only ever grants the customer role, never admin or seller', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'selfreg' })
  const { status, body } = await apiFetch(server.baseUrl, '/auth/me', { token: user.accessToken })
  assert.equal(status, 200)
  assert.deepEqual(body.data.user.roles, ['customer'])
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('a customer token is rejected by an admin-only endpoint — RBAC enforced server-side', async () => {
  // The Phase 0 audit's headline finding: the frontend used to trust a role string out of
  // localStorage, so any visitor could grant themselves admin with one console command.
  // This asserts the real gate: a real, validly-signed customer token still can't pass.
  const user = await registerTestUser(server.baseUrl, { label: 'rbac' })
  const { status, body } = await apiFetch(server.baseUrl, '/admin/orders', { token: user.accessToken })
  assert.equal(status, 403)
  assert.equal(body.error.code, 'FORBIDDEN')
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('the seeded admin account can reach the admin-only endpoint', async () => {
  const token = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
  const { status, body } = await apiFetch(server.baseUrl, '/admin/orders', { token })
  assert.equal(status, 200)
  // A page envelope now that the endpoint pages server-side, not a bare array.
  assert.ok(Array.isArray(body.data.items))
})
