import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, testEmail } from './setup.js'
import { queryOne, closePool } from '../src/db/pool.js'

/**
 * Session lifecycle — that signing out actually destroys the session server-side.
 *
 * These use raw fetch rather than the apiFetch helper because the thing under test IS the
 * httpOnly refresh cookie: the helper does not carry Set-Cookie between calls, and a test
 * that only checked the access token would pass while the long-lived refresh token stayed
 * valid — the exact failure this is here to catch.
 */

let server

before(async () => { server = await startTestServer() })
after(async () => {
  try { await server.close() } finally { await closePool() }
})

/** Pulls the refresh cookie out of a response so it can be replayed on later requests. */
function refreshCookieFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? []
  const cookie = raw.find((value) => value.startsWith('mirwal_rt='))
  return cookie ? cookie.split(';')[0] : null
}

async function registerWithCookie() {
  const email = testEmail('session')
  const response = await fetch(`${server.baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPass123!', fullName: 'Test User' }),
  })
  const body = await response.json()
  // The user's own id, so token assertions can be scoped to this account. Reading "the newest
  // row in refresh_tokens" instead makes the test depend on nothing else signing in at the
  // same moment — and `node --test` runs test FILES in parallel, so other files' logins land
  // between this registration and the assertion.
  const user = await queryOne('SELECT id FROM users WHERE email = ?', [email])
  return { email, userId: user.id, cookie: refreshCookieFrom(response), accessToken: body.data.accessToken }
}

/** This account's most recent refresh token. */
const latestTokenFor = (userId) =>
  queryOne('SELECT revoked_at FROM refresh_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId])

const post = (path, cookie) => fetch(`${server.baseUrl}${path}`, {
  method: 'POST',
  headers: cookie ? { Cookie: cookie } : {},
})

test('logout revokes the refresh token in the database and clears the cookie', async () => {
  const { cookie, userId } = await registerWithCookie()
  assert.ok(cookie, 'registration should set a refresh cookie')

  const before = await latestTokenFor(userId)
  assert.equal(before.revoked_at, null, 'a fresh session should not start revoked')

  const logout = await post('/auth/logout', cookie)
  assert.equal(logout.status, 200)

  // The row is genuinely marked revoked — not merely forgotten by the client.
  const after = await latestTokenFor(userId)
  assert.ok(after.revoked_at, 'logout must revoke the refresh token server-side')

  // And the browser is told to drop it.
  const cleared = logout.headers.getSetCookie?.() ?? []
  assert.ok(cleared.some((value) => value.startsWith('mirwal_rt=')), 'logout should clear the refresh cookie')
})

test('a refresh token cannot be reused after logout, even if the cookie was captured', async () => {
  const { cookie } = await registerWithCookie()
  await post('/auth/logout', cookie)

  // Replaying the exact pre-logout cookie is the realistic attack: a stolen cookie must be
  // worthless the moment the real user signs out, or "sign out" protects nobody.
  const replay = await post('/auth/refresh', cookie)
  assert.equal(replay.status, 401)
  const body = await replay.json()
  assert.ok(['REFRESH_INVALID', 'REFRESH_REUSED'].includes(body.error.code))
})

test('rotation invalidates the previous refresh token', async () => {
  const { cookie } = await registerWithCookie()

  const rotated = await post('/auth/refresh', cookie)
  assert.equal(rotated.status, 200, 'a valid refresh should succeed once')
  assert.ok(refreshCookieFrom(rotated), 'refresh should issue a replacement cookie')

  // Presenting the already-rotated token is treated as theft, not as a retry: the server
  // revokes the whole family rather than quietly issuing another session.
  const reused = await post('/auth/refresh', cookie)
  assert.equal(reused.status, 401)
  const body = await reused.json()
  assert.equal(body.error.code, 'REFRESH_REUSED')
})
