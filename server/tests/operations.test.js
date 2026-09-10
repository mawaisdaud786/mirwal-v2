import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * Admin operations: accounts, sessions, product reports, system logs, teams and attributes.
 *
 * The properties worth protecting here are mostly about consequence. Suspending an account
 * must actually end its sessions, not merely relabel it. Reporting a listing must be open to a
 * signed-out visitor but not repeatable. And a staff-only surface must stay staff-only.
 */

let server
let adminToken
let sellerToken

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
  sellerToken = await scopedLogin('seller', 'seller.a@mirwal.test')
})

after(async () => {
  try {
    await query("DELETE FROM product_attributes WHERE name LIKE 'ZZ Test%'")
    await query("DELETE FROM admin_teams WHERE name LIKE 'ZZ Test%'")
    await query('DELETE FROM product_reports')
    await query("DELETE FROM system_logs WHERE code = 'ZZ_TEST'")
    await server.close()
  } finally { await closePool() }
})

// ---------------------------------------------------------------------------
// Accounts and sessions
// ---------------------------------------------------------------------------

test('suspending an account ends every one of its sessions', async () => {
  // A suspended account that stays signed in keeps working until its access token happens to
  // expire — the block would be cosmetic for up to the token's whole lifetime.
  const user = await registerTestUser(server.baseUrl, { label: 'suspend' })
  const [{ before: liveBefore }] = await query(
    `SELECT COUNT(*) AS \`before\` FROM refresh_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE u.email = ? AND t.revoked_at IS NULL`,
    [user.email],
  )
  assert.ok(Number(liveBefore) > 0, 'registration should have created a session')

  const accounts = await apiFetch(server.baseUrl, `/admin/accounts?search=${encodeURIComponent(user.email)}`, { token: adminToken })
  assert.equal(accounts.status, 200)
  const account = accounts.body.data.items.find((row) => row.email === user.email)
  assert.ok(account, 'the new account should be listed')

  const result = await apiFetch(server.baseUrl, `/admin/accounts/${account.id}/status`, {
    method: 'PATCH', token: adminToken, body: { status: 'suspended' },
  })
  assert.equal(result.status, 200)
  assert.ok(result.body.data.sessionsRevoked > 0, 'suspension must revoke live sessions')

  const [{ live }] = await query(
    `SELECT COUNT(*) AS live FROM refresh_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE u.email = ? AND t.revoked_at IS NULL`,
    [user.email],
  )
  assert.equal(Number(live), 0, 'no session may survive suspension')

  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('an admin cannot suspend their own account', async () => {
  const staff = await apiFetch(server.baseUrl, '/admin/staff', { token: adminToken })
  const self = staff.body.data.find((person) => person.email === 'admin@mirwal.test')
  assert.ok(self)

  const { status, body } = await apiFetch(server.baseUrl, `/admin/accounts/${self.id}/status`, {
    method: 'PATCH', token: adminToken, body: { status: 'suspended' },
  })
  // Locking yourself out of the panel is not a mistake worth allowing.
  assert.equal(status, 400)
  assert.equal(body.error.code, 'SELF_ACTION')
})

test('the sessions list shows only live sessions', async () => {
  /**
   * Asserted per row, not as a count.
   *
   * The count version compared two different moments — the endpoint's, and a `COUNT(*)` run
   * afterwards — and every other test file in the suite logs in and out in between, so it
   * failed on timing rather than on behaviour. The property that actually matters is that
   * nothing revoked or expired is listed, and that survives whatever else is happening.
   */
  const { status, body } = await apiFetch(server.baseUrl, '/admin/sessions?pageSize=200', { token: adminToken })
  assert.equal(status, 200)

  const listed = body.data.items.map((item) => item.id)
  assert.ok(listed.length > 0, 'this test signed in, so at least one session must be live')

  const stale = await query(
    `SELECT COUNT(*) AS n FROM refresh_tokens
      WHERE id IN (${listed.map(() => '?').join(',')})
        AND (revoked_at IS NOT NULL OR expires_at <= NOW())`,
    listed,
  )
  assert.equal(Number(stale[0].n), 0, 'a revoked or expired token is history, not a session')

  // And the total is a real count rather than the page size or a constant.
  assert.ok(body.data.pagination.total >= listed.length)
})

// ---------------------------------------------------------------------------
// Product reports
// ---------------------------------------------------------------------------

test('a signed-out visitor can report a listing', async () => {
  // Refusing anonymous reports would lose the signal from exactly the people most likely to
  // stumble across a counterfeit.
  const products = await apiFetch(server.baseUrl, '/products?pageSize=1')
  const slug = products.body.data.items[0].slug

  const { status } = await apiFetch(server.baseUrl, `/products/${slug}/report`, {
    method: 'POST', body: { reason: 'counterfeit', details: 'ZZ Test anonymous report.' },
  })
  assert.equal(status, 201)
})

test('the same person cannot report one listing twice while it is open', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'report' })
  const products = await apiFetch(server.baseUrl, '/products?pageSize=2')
  const slug = products.body.data.items[1].slug

  const first = await apiFetch(server.baseUrl, `/products/${slug}/report`, {
    method: 'POST', token: user.accessToken, body: { reason: 'misleading' },
  })
  assert.equal(first.status, 201)

  // Otherwise one annoyed person looks like many complaints.
  const second = await apiFetch(server.baseUrl, `/products/${slug}/report`, {
    method: 'POST', token: user.accessToken, body: { reason: 'misleading' },
  })
  assert.equal(second.status, 409)
  assert.equal(second.body.error.code, 'ALREADY_REPORTED')

  await query('DELETE FROM users WHERE email = ?', [user.email])
})

test('resolving a report requires saying what was decided', async () => {
  const list = await apiFetch(server.baseUrl, '/admin/product-reports?status=open', { token: adminToken })
  const report = list.body.data.items[0]
  assert.ok(report, 'the earlier tests should have left an open report')

  const bare = await apiFetch(server.baseUrl, `/admin/product-reports/${report.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'dismissed' },
  })
  assert.equal(bare.status, 400)
  assert.equal(bare.body.error.code, 'RESOLUTION_REQUIRED')

  const resolved = await apiFetch(server.baseUrl, `/admin/product-reports/${report.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'dismissed', resolution: 'Listing checked and accurate.' },
  })
  assert.equal(resolved.status, 200)
})

// ---------------------------------------------------------------------------
// System logs
// ---------------------------------------------------------------------------

test('the error log records real server failures, not validation rejections', async () => {
  const before = await apiFetch(server.baseUrl, '/admin/system-logs?pageSize=1', { token: adminToken })
  const countBefore = before.body.data.total

  // A 400 is an ordinary rejection, not an incident: recording it would bury real failures.
  const rejected = await apiFetch(server.baseUrl, '/admin/coupons', {
    method: 'POST', token: adminToken, body: { code: 'ZZ', name: 'x', discountType: 'percentage' },
  })
  assert.ok(rejected.status === 400)

  const after = await apiFetch(server.baseUrl, '/admin/system-logs?pageSize=1', { token: adminToken })
  assert.equal(after.body.data.total, countBefore, 'a 4xx must not be logged as a system error')
})

test('system logs never contain a request body', async () => {
  // Bodies carry addresses and, on the auth routes, passwords — the error handler stores the
  // stack only.
  const logs = await apiFetch(server.baseUrl, '/admin/system-logs?pageSize=100', { token: adminToken })
  assert.equal(logs.status, 200)
  for (const entry of logs.body.data.items) {
    const keys = Object.keys(entry.context ?? {})
    assert.ok(
      keys.every((key) => key === 'stack'),
      `log context may only carry a stack, found: ${keys.join(', ')}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Teams and attributes
// ---------------------------------------------------------------------------

test('a team groups staff without granting anything', async () => {
  const created = await apiFetch(server.baseUrl, '/admin/teams', {
    method: 'POST', token: adminToken, body: { name: 'ZZ Test Team' },
  })
  assert.equal(created.status, 201)
  const slug = created.body.data.slug

  const staff = await apiFetch(server.baseUrl, '/admin/staff', { token: adminToken })
  const member = staff.body.data[0]

  const added = await apiFetch(server.baseUrl, `/admin/teams/${slug}/members`, {
    method: 'POST', token: adminToken, body: { userId: member.id, isMember: true },
  })
  assert.equal(added.status, 200)

  // Membership must not have touched their roles — authority lives in one place only.
  const after = await apiFetch(server.baseUrl, '/admin/staff', { token: adminToken })
  const sameMember = after.body.data.find((person) => person.id === member.id)
  assert.deepEqual(sameMember.roles, member.roles)

  await apiFetch(server.baseUrl, `/admin/teams/${slug}`, { method: 'DELETE', token: adminToken })
})

test('a select attribute must define its options', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/attributes', {
    method: 'POST', token: adminToken, body: { name: 'ZZ Test Material', inputType: 'select' },
  })
  // Otherwise the seller form would render a dropdown with nothing in it.
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VALIDATION_FAILED')
})

// ---------------------------------------------------------------------------
// Privilege
// ---------------------------------------------------------------------------

test('a seller cannot reach any admin operations endpoint', async () => {
  const paths = [
    '/admin/staff', '/admin/sessions', '/admin/accounts', '/admin/notifications',
    '/admin/seller-performance', '/admin/product-reports', '/admin/system-logs',
    '/admin/teams', '/admin/attributes',
  ]
  for (const path of paths) {
    const { status } = await apiFetch(server.baseUrl, path, { token: sellerToken })
    assert.equal(status, 403, `${path} must be forbidden for a seller`)
  }
})

test('a customer cannot read the account list or the error log', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'opspriv' })
  for (const path of ['/admin/accounts', '/admin/system-logs', '/admin/staff']) {
    const { status } = await apiFetch(server.baseUrl, path, { token: user.accessToken })
    assert.equal(status, 403, `${path} must be forbidden for a customer`)
  }
  await query('DELETE FROM users WHERE email = ?', [user.email])
})
