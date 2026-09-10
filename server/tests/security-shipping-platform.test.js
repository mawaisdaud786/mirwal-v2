import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, queryOne, closePool } from '../src/db/pool.js'
import { codeForStep, verifyToken, generateSecret, generateBackupCodes, hashBackupCode } from '../src/lib/totp.js'

/**
 * Two-factor authentication, shipping quotes, password reset and maintenance mode.
 *
 * The risks each of these introduces are what is tested here: a second factor that does not
 * interoperate with real authenticator apps, a shipping rate that charges the wrong amount at
 * a threshold, a reset token that can be replayed, and a maintenance switch that locks out
 * the person holding it.
 */

let server
let adminToken

async function scopedLogin(scope, email) {
  const { status, body } = await apiFetch(server.baseUrl, `/${scope}/auth/login`, {
    method: 'POST', body: { email, password: 'MirwalDev123!' },
  })
  if (status !== 200) throw new Error(`${scope} login failed: ${status} ${JSON.stringify(body)}`)
  return body.data.accessToken
}

before(async () => {
  server = await startTestServer()
  adminToken = await scopedLogin('admin', 'admin@mirwal.test')
  // These tables are shared, and a zone left over from a previous run would change what the
  // quote tests below match against.
  await query("DELETE FROM shipping_zones WHERE slug LIKE 'zz-test-%'")
  await query('DELETE FROM password_resets')
})

after(async () => {
  try {
    await query("DELETE FROM shipping_zones WHERE slug LIKE 'zz-test-%'")
    await query('DELETE FROM password_resets')
    // Never leave maintenance mode on: it would close the storefront for every later suite.
    await apiFetch(server.baseUrl, '/admin/platform/maintenance', {
      method: 'PATCH', token: adminToken, body: { enabled: false },
    })
    await server.close()
  } finally { await closePool() }
})

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

test('TOTP matches the RFC 6238 published test vectors', () => {
  /**
   * This is the test that matters for two-factor: not that the code round-trips against
   * itself, but that it agrees with the specification every authenticator app implements.
   * A self-consistent implementation that disagrees with Google Authenticator locks users out
   * of their own accounts, and would pass any test written only against itself.
   *
   * Secret is the RFC's ASCII "12345678901234567890" in base32. The RFC prints 8 digits;
   * Mirwal issues 6, which are the last 6.
   */
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    // Past 2^32 seconds — catches a counter written as a 32-bit value.
    [20000000000, '65353130'],
  ]
  for (const [seconds, expected] of vectors) {
    assert.equal(codeForStep(SECRET, Math.floor(seconds / 30)), expected.slice(-6), `vector at T=${seconds}`)
  }
})

test('a code from the adjacent time step is accepted, a distant one is not', () => {
  // Clocks drift. One step either side is the standard allowance; three is not.
  const secret = generateSecret()
  const now = 1_700_000_000_000
  const step = Math.floor(now / 1000 / 30)

  assert.ok(verifyToken(secret, codeForStep(secret, step), { now }))
  assert.ok(verifyToken(secret, codeForStep(secret, step - 1), { now }), 'a slightly slow clock must still work')
  assert.ok(verifyToken(secret, codeForStep(secret, step + 1), { now }))
  assert.equal(verifyToken(secret, codeForStep(secret, step + 3), { now }), false)
})

test('a malformed code is rejected rather than throwing', () => {
  // This runs on the sign-in path; an exception where a boolean is expected is a 500 on login.
  const secret = generateSecret()
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 56']) {
    assert.equal(verifyToken(secret, bad), false, `rejected: ${JSON.stringify(bad)}`)
  }
})

test('recovery codes are unique, and stored only as hashes', () => {
  const codes = generateBackupCodes()
  assert.equal(new Set(codes).size, codes.length, 'a duplicate code would be usable twice')
  // Formatting is cosmetic: the hash must not depend on the dash or on case.
  assert.equal(hashBackupCode(codes[0]), hashBackupCode(codes[0].replace('-', '').toLowerCase()))
  assert.notEqual(hashBackupCode(codes[0]), codes[0])
})

test('two-factor enrolment does nothing until a real code confirms it', async () => {
  const status = await apiFetch(server.baseUrl, '/admin/security/two-factor', { token: adminToken })
  assert.equal(status.body.data.enabled, false)

  const setup = await apiFetch(server.baseUrl, '/admin/security/two-factor/setup', { method: 'POST', token: adminToken })
  assert.equal(setup.status, 200)
  assert.match(setup.body.data.otpauthUri, /^otpauth:\/\/totp\//)

  // Enrolment has started but is not switched on — a secret nobody successfully scanned must
  // not start demanding codes.
  const mid = await apiFetch(server.baseUrl, '/admin/security/two-factor', { token: adminToken })
  assert.equal(mid.body.data.enabled, false)
  assert.equal(mid.body.data.enrolmentStarted, true)

  const wrong = await apiFetch(server.baseUrl, '/admin/security/two-factor/confirm', {
    method: 'POST', token: adminToken, body: { code: '000000' },
  })
  assert.equal(wrong.status, 400)

  // Still off after a failed confirmation.
  const after = await apiFetch(server.baseUrl, '/admin/security/two-factor', { token: adminToken })
  assert.equal(after.body.data.enabled, false)

  // Clean up the half-started enrolment so later suites log in with a password alone.
  await query('UPDATE users SET totp_secret = NULL WHERE email = ?', ['admin@mirwal.test'])
})

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

test('a shipping method that cannot produce a price is refused', async () => {
  const zone = await apiFetch(server.baseUrl, '/admin/shipping/zones', {
    method: 'POST', token: adminToken,
    body: { name: 'zz test invalid', cities: ['zzznowhere'], countryCodes: ['PK'], priority: 5 },
  })
  assert.equal(zone.status, 201)
  const zoneId = zone.body.data.id

  // "Free over" with no threshold has no answer to "what does this cost?" — better refused
  // here than met by a shopper at checkout.
  const noThreshold = await apiFetch(server.baseUrl, `/admin/shipping/zones/${zoneId}/methods`, {
    method: 'POST', token: adminToken, body: { name: 'Broken', rateType: 'free_over', baseAmount: '100' },
  })
  assert.equal(noThreshold.status, 400)
  assert.equal(noThreshold.body.error.code, 'MISSING_FREE_OVER')

  await apiFetch(server.baseUrl, `/admin/shipping/zones/${zoneId}`, { method: 'DELETE', token: adminToken })
})

test('a quote charges the right amount either side of a free-delivery threshold', async () => {
  const zone = await apiFetch(server.baseUrl, '/admin/shipping/zones', {
    method: 'POST', token: adminToken,
    body: { name: 'zz test quoteville', cities: ['quoteville'], countryCodes: ['PK'], priority: 1 },
  })
  const zoneId = zone.body.data.id

  await apiFetch(server.baseUrl, `/admin/shipping/zones/${zoneId}/methods`, {
    method: 'POST', token: adminToken,
    body: { name: 'Standard', rateType: 'free_over', baseAmount: '199', freeOverAmount: '3000' },
  })

  const under = await apiFetch(server.baseUrl, '/shipping/quote?city=Quoteville&subtotal=2999')
  assert.equal(under.body.data.options[0].amount.amount, '199.00')
  assert.equal(under.body.data.options[0].isFree, false)

  // Exactly at the threshold must already be free: "free over 3000" that still charges at
  // 3000 is the kind of off-by-one a shopper notices and complains about.
  const at = await apiFetch(server.baseUrl, '/shipping/quote?city=Quoteville&subtotal=3000')
  assert.equal(at.body.data.options[0].isFree, true)
  assert.equal(at.body.data.options[0].amount.amount, '0.00')

  await apiFetch(server.baseUrl, `/admin/shipping/zones/${zoneId}`, { method: 'DELETE', token: adminToken })
})

test('an address no zone covers still gets a shippable option', async () => {
  // A checkout with no delivery option is a dead end, so the platform default stands in.
  const { status, body } = await apiFetch(server.baseUrl, '/shipping/quote?city=Nowhere-At-All&subtotal=500')
  assert.equal(status, 200)
  assert.equal(body.data.zone, null)
  assert.equal(body.data.options.length, 1)
  assert.ok(body.data.options[0].amount)
})

test('a seller cannot change shipping rates', async () => {
  const sellerToken = await scopedLogin('seller', 'seller.a@mirwal.test')
  const { status } = await apiFetch(server.baseUrl, '/admin/shipping/zones', {
    method: 'POST', token: sellerToken, body: { name: 'zz test seller zone' },
  })
  assert.equal(status, 403, 'rates are marketplace-wide; a seller must not be able to set them')
})

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

test('a reset request reveals nothing about whether the account exists', async () => {
  const real = await apiFetch(server.baseUrl, '/auth/forgot-password', {
    method: 'POST', body: { email: 'customer@mirwal.test' },
  })
  const fake = await apiFetch(server.baseUrl, '/auth/forgot-password', {
    method: 'POST', body: { email: 'definitely-not-a-user@example.com' },
  })

  // Identical status and identical wording — anything else turns this into a way to find out
  // who shops on Mirwal.
  assert.equal(real.status, fake.status)
  assert.equal(real.body.message, fake.body.message)
  assert.equal(real.body.success, fake.body.success)

  // But only the real one created a token.
  const rows = await query('SELECT COUNT(*) AS total FROM password_resets')
  assert.equal(Number(rows[0].total), 1)
})

test('a reset token cannot be guessed, replayed, or used after the password changes', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'resetflow' })

  await apiFetch(server.baseUrl, '/auth/forgot-password', { method: 'POST', body: { email: user.email } })

  // The token is only ever in the email; the row holds a hash. Read it the way the endpoint
  // does, by inserting a known token, so the test does not need a mail server.
  const { createRefreshToken } = await import('../src/lib/tokens.js')
  const { token, hash } = createRefreshToken()
  const account = await queryOne('SELECT id FROM users WHERE email = ?', [user.email])
  await query('UPDATE password_resets SET token_hash = ? WHERE user_id = ?', [hash, account.id])

  const wrong = await apiFetch(server.baseUrl, '/auth/reset-password', {
    method: 'POST', body: { token: 'x'.repeat(64), password: 'CompletelyNew123!' },
  })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.body.error.code, 'INVALID_RESET_TOKEN')

  const first = await apiFetch(server.baseUrl, '/auth/reset-password', {
    method: 'POST', body: { token, password: 'CompletelyNew123!' },
  })
  assert.equal(first.status, 200)

  // Single use: a link forwarded, cached or resent must not work twice.
  const second = await apiFetch(server.baseUrl, '/auth/reset-password', {
    method: 'POST', body: { token, password: 'AnotherOne123!' },
  })
  assert.equal(second.status, 401)

  const signedIn = await apiFetch(server.baseUrl, '/auth/login', {
    method: 'POST', body: { email: user.email, password: 'CompletelyNew123!' },
  })
  assert.equal(signedIn.status, 200, 'the new password must work')

  const old = await apiFetch(server.baseUrl, '/auth/login', {
    method: 'POST', body: { email: user.email, password: user.password },
  })
  assert.equal(old.status, 401, 'the old password must not')

  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('resetting a password ends every existing session', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'resetsessions' })
  const account = await queryOne('SELECT id FROM users WHERE email = ?', [user.email])

  const before = await queryOne(
    'SELECT COUNT(*) AS live FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL',
    [account.id],
  )
  assert.ok(Number(before.live) > 0, 'registering signs you in, so there is a session to revoke')

  await apiFetch(server.baseUrl, '/auth/forgot-password', { method: 'POST', body: { email: user.email } })
  const { createRefreshToken } = await import('../src/lib/tokens.js')
  const { token, hash } = createRefreshToken()
  await query('UPDATE password_resets SET token_hash = ? WHERE user_id = ? AND used_at IS NULL', [hash, account.id])

  await apiFetch(server.baseUrl, '/auth/reset-password', { method: 'POST', body: { token, password: 'FreshStart123!' } })

  // Whoever prompted the reset is signed out too — that is the point of doing it.
  const after = await queryOne(
    'SELECT COUNT(*) AS live FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL',
    [account.id],
  )
  assert.equal(Number(after.live), 0)

  await query('DELETE FROM users WHERE email = ?', [user.email])
})

// ---------------------------------------------------------------------------
// Maintenance mode
// ---------------------------------------------------------------------------

test('maintenance mode closes the storefront but never locks staff out', async () => {
  const on = await apiFetch(server.baseUrl, '/admin/platform/maintenance', {
    method: 'PATCH', token: adminToken, body: { enabled: true, message: 'Back shortly.' },
  })
  assert.equal(on.status, 200)
  assert.equal(on.body.data.enabled, true)

  try {
    const shopper = await apiFetch(server.baseUrl, '/products?pageSize=1')
    assert.equal(shopper.status, 503)
    assert.equal(shopper.body.error.code, 'MAINTENANCE_MODE')
    assert.equal(shopper.body.error.message, 'Back shortly.')

    // The three things that must stay reachable, each one a lockout otherwise: the panel that
    // owns the switch, sign-in, and the health check a load balancer depends on.
    const panel = await apiFetch(server.baseUrl, '/admin/shipping', { token: adminToken })
    assert.equal(panel.status, 200)

    const signIn = await apiFetch(server.baseUrl, '/admin/auth/login', {
      method: 'POST', body: { email: 'admin@mirwal.test', password: 'MirwalDev123!' },
    })
    assert.equal(signIn.status, 200)

    const health = await fetch(`${server.baseUrl.replace(/\/api\/v\d+$/, '')}/health`)
    assert.equal(health.status, 200)
  } finally {
    const off = await apiFetch(server.baseUrl, '/admin/platform/maintenance', {
      method: 'PATCH', token: adminToken, body: { enabled: false },
    })
    assert.equal(off.body.data.enabled, false)
  }

  // And the storefront is open again immediately, not after the cache expires.
  const reopened = await apiFetch(server.baseUrl, '/products?pageSize=1')
  assert.equal(reopened.status, 200)
})
