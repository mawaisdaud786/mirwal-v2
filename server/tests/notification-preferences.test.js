import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, queryOne, closePool } from '../src/db/pool.js'
import { categoryFor } from '../src/modules/notifications/preferences.service.js'

/**
 * Notification preferences.
 *
 * `users.notification_channels` and `notification_preferences` have existed since migration
 * 027, and the storefront has had a panel writing to them the whole time. Nothing read them —
 * turning "Email Notifications" off changed a JSON column and every message still went out.
 * A control that visibly does nothing is worse than no control: it teaches people that
 * nothing on the account page is real.
 *
 * The two properties worth holding onto:
 *
 *   - a category switched off actually stops the send, and the skip is recorded rather than
 *     dropped, so "why did they not get it" has an answer;
 *   - security cannot be switched off, by anyone, ever. These messages exist to be noticed by
 *     the person who did *not* do the thing, and an attacker holding the session would turn
 *     them off first.
 */

let server
let user

before(async () => {
  server = await startTestServer()
  user = await registerTestUser(server.baseUrl, { label: 'notif-prefs' })
})

after(async () => { await server?.close(); await closePool() })

const prefs = (body) => apiFetch(server.baseUrl, '/notifications/preferences', {
  method: body ? 'PUT' : 'GET', token: user.accessToken, body,
})

test('the server owns the category list, so the browser has nothing to invent', async () => {
  const { status, body } = await prefs()
  assert.equal(status, 200)

  const keys = body.data.categories.map((category) => category.key)
  assert.deepEqual(keys, ['orders', 'returns', 'account', 'security', 'marketing'])
  // Everything defaults on. Anyone who has never opened the settings page must keep hearing
  // about their orders.
  assert.ok(body.data.categories.every((category) => category.enabled))
  assert.ok(body.data.channels.every((channel) => channel.enabled))
})

test('security cannot be switched off, and the response says so rather than pretending', async () => {
  const { status, body } = await prefs({ categories: { security: false }, channels: { inApp: false } })
  assert.equal(status, 200)

  const security = body.data.categories.find((category) => category.key === 'security')
  assert.equal(security.enabled, true, 'a security opt-out must never take effect')
  assert.equal(security.forced, true, 'and the client must be told why it did not')

  const inApp = body.data.channels.find((channel) => channel.key === 'inApp')
  assert.equal(inApp.enabled, true)

  // Nor may it reach the database, where a later reader might trust it.
  const row = await queryOne('SELECT notification_preferences AS p FROM users WHERE email = ?', [user.email])
  const stored = typeof row.p === 'string' ? JSON.parse(row.p) : (row.p ?? {})
  assert.ok(!('security' in stored), 'a refused preference must not be stored at all')
})

test('a category switched off is merged, not replaced — an old client cannot silence the rest', async () => {
  await prefs({ categories: { marketing: false } })
  const { body } = await prefs({ categories: { returns: false } })

  const enabled = Object.fromEntries(body.data.categories.map((category) => [category.key, category.enabled]))
  assert.equal(enabled.marketing, false, 'the earlier choice must survive a partial update')
  assert.equal(enabled.returns, false)
  assert.equal(enabled.orders, true)
})

test('turning a channel off stops the send, and records why', async () => {
  await prefs({ categories: { marketing: true, returns: true }, channels: { email: false } })

  const before = await query(
    "SELECT COUNT(*) AS n FROM message_deliveries WHERE recipient = ? AND status = 'skipped'",
    [user.email],
  )

  // A password reset is security, so it goes regardless — that is the next test. This one uses
  // the profile-shaped path: ask for the preference gate directly through a category message.
  const { send } = await import('../src/modules/messaging/messaging.service.js')
  const userRow = await queryOne('SELECT id FROM users WHERE email = ?', [user.email])
  await send('order.shipped', {
    to: user.email,
    userId: userRow.id,
    variables: { orderNumber: 'MW-TEST', trackingNumber: 'X', carrierName: 'TCS' },
  })

  const after = await query(
    "SELECT COUNT(*) AS n FROM message_deliveries WHERE recipient = ? AND status = 'skipped'",
    [user.email],
  )
  assert.equal(Number(after[0].n), Number(before[0].n) + 1, 'the send must be skipped, and the skip recorded')

  const latest = await queryOne(
    'SELECT status, error_message FROM message_deliveries WHERE recipient = ? ORDER BY id DESC LIMIT 1',
    [user.email],
  )
  assert.equal(latest.status, 'skipped')
  assert.match(latest.error_message ?? '', /turned this off/i)
})

test('a security message ignores every preference the account has set', async () => {
  // Email is still off from the previous test, and this account has opted out of two
  // categories. None of it applies here.
  const { send } = await import('../src/modules/messaging/messaging.service.js')
  const userRow = await queryOne('SELECT id FROM users WHERE email = ?', [user.email])

  await send('security.new_device_login', {
    to: user.email,
    userId: userRow.id,
    variables: { deviceLabel: 'Chrome on Windows', when: 'today', ipAddress: '203.0.113.9' },
  })

  const latest = await queryOne(
    'SELECT status, error_message, template_key FROM message_deliveries WHERE recipient = ? ORDER BY id DESC LIMIT 1',
    [user.email],
  )
  // The suite runs with no SMTP transport, so a security message is still "skipped" — for
  // want of a transport, which is a different thing entirely. What must never appear is the
  // preference gate's own reason.
  assert.doesNotMatch(
    latest.error_message ?? '',
    /turned this off/i,
    'a security message must never be suppressed by a preference',
  )
  assert.equal(latest.template_key, 'security.new_device_login', 'and it must have been attempted at all')
})

test('every message name lands in a category, including ones nobody has classified', () => {
  // The fallback matters more than the mapping: an unclassified message going missing is a
  // worse failure than one arriving in the wrong bucket, so it must land somewhere on by
  // default and never in `marketing`.
  assert.equal(categoryFor('security.bank_account_changed'), 'security')
  assert.equal(categoryFor('account.password_reset'), 'security')
  assert.equal(categoryFor('order.shipped'), 'orders')
  assert.equal(categoryFor('return_approved'), 'returns')
  assert.equal(categoryFor('order.refunded'), 'returns')
  assert.equal(categoryFor('seller.approved'), 'account')
  assert.equal(categoryFor('something.nobody.has.thought.of'), 'account')
})

test('saving preferences does not break signing in', async () => {
  /**
   * A regression, and a nasty one: `publicUser` called `JSON.parse` directly on the two JSON
   * columns these preferences live in. mysql2 returns JSON columns already parsed on some
   * paths and as a string on others, so the raw parse threw the moment anything actually
   * wrote them — and `publicUser` is on the login path, so the symptom was not a missing
   * preference but a 500 on sign-in for every account that had ever saved one.
   */
  await prefs({ categories: { marketing: false }, channels: { sms: false } })

  const login = await apiFetch(server.baseUrl, '/auth/login', {
    method: 'POST', body: { email: user.email, password: user.password },
  })
  assert.equal(login.status, 200, JSON.stringify(login.body))
  assert.equal(login.body.data.user.notificationPreferences.marketing, false)
  assert.equal(login.body.data.user.notificationChannels.sms, false)
})
