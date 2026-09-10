import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'
import { getBalance } from '../src/modules/payouts/ledger.service.js'

/**
 * Marketing, support, payouts and settings — the surfaces migrations 012–015 unlocked.
 *
 * These endpoints are where the old admin panel lied most: settings that reset on reload,
 * a seller "Create Ticket" form that discarded the message, and payout figures that were
 * invented. So the tests concentrate on the properties that make them honest —
 *
 *   persistence   a saved setting is still saved on the next read
 *   tenancy       one seller cannot see or edit another's coupons or tickets
 *   privacy       staff internal notes never reach the requester
 *   money safety  an order item cannot be paid out twice, and "paid" needs a real reference
 *   secrets       a webhook signing secret is returned once and never listed
 *
 * Everything created here is named "ZZ Test …" and removed in `after`, so a failed run leaves
 * rows a human can recognise.
 */

let server
let adminToken
let sellerAToken
let sellerBToken

const CREDENTIALS = {
  admin: { email: 'admin@mirwal.test', password: 'MirwalDev123!' },
  sellerA: { email: 'seller.a@mirwal.test', password: 'MirwalDev123!' },
  sellerB: { email: 'seller.b@mirwal.test', password: 'MirwalDev123!' },
}

async function scopedLogin(scope, credentials) {
  const { status, body } = await apiFetch(server.baseUrl, `/${scope}/auth/login`, { method: 'POST', body: credentials })
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
    await query("DELETE FROM coupons WHERE code LIKE 'ZZT%'")
    await query("DELETE FROM promotions WHERE name LIKE 'ZZ Test%'")
    await query("DELETE FROM banners WHERE title LIKE 'ZZ Test%'")
    await query("DELETE FROM webhook_endpoints WHERE name LIKE 'ZZ Test%'")
    await query("DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE subject LIKE 'ZZ Test%')")
    await query("DELETE FROM support_tickets WHERE subject LIKE 'ZZ Test%'")
    // Payouts claim order items via a unique key; leaving one behind would make every later
    // run see a zero balance and fail for the wrong reason.
    await query('DELETE FROM payout_items')
    await query('DELETE FROM payouts')
    // Restore the two settings these tests write, so the dev database is unchanged.
    await query("UPDATE platform_settings SET value_json = '{\"v\":true}', updated_by = NULL WHERE `key` = 'payments.cod.enabled'")
    await query("UPDATE platform_settings SET value_json = '{\"v\":1000}', updated_by = NULL WHERE `key` = 'finance.commission_bps'")
    await server.close()
  } finally { await closePool() }
})

const uniqueCode = () => `ZZT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`

// ---------------------------------------------------------------------------
// Settings — the "toggle resets on reload" bug
// ---------------------------------------------------------------------------

test('a saved setting is still saved on the next read', async () => {
  const saved = await apiFetch(server.baseUrl, '/admin/settings', {
    method: 'PATCH', token: adminToken, body: { updates: { 'finance.commission_bps': 1234 } },
  })
  assert.equal(saved.status, 200)

  const reread = await apiFetch(server.baseUrl, '/admin/settings?category=finance', { token: adminToken })
  const setting = reread.body.data.find((row) => row.key === 'finance.commission_bps')
  assert.equal(setting.value, 1234, 'the value must survive the round trip')
  assert.equal(setting.updatedBy, 'Dev Admin', 'and record who changed it')
})

test('a setting is rejected when the value is the wrong type', async () => {
  // 'payments.cod.enabled' is a boolean. Accepting the string "yes" would store a value that
  // every consumer then has to defensively coerce.
  const { status, body } = await apiFetch(server.baseUrl, '/admin/settings', {
    method: 'PATCH', token: adminToken, body: { updates: { 'payments.cod.enabled': 'yes' } },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'INVALID_SETTING_TYPE')
})

test('an unknown setting key is rejected rather than silently created', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/settings', {
    method: 'PATCH', token: adminToken, body: { updates: { 'made.up.key': true } },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'UNKNOWN_SETTING')
})

// ---------------------------------------------------------------------------
// Coupons — validation and tenancy
// ---------------------------------------------------------------------------

test('a percentage coupon without a percentage is refused', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/coupons', {
    method: 'POST', token: adminToken,
    body: { code: uniqueCode(), name: 'ZZ Test bad', discountType: 'percentage' },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'DISCOUNT_REQUIRED')
})

test('coupon codes are unique case-insensitively', async () => {
  const code = uniqueCode()
  const first = await apiFetch(server.baseUrl, '/admin/coupons', {
    method: 'POST', token: adminToken,
    body: { code, name: 'ZZ Test first', discountType: 'percentage', discountPercent: 10 },
  })
  assert.equal(first.status, 201)

  // A shopper typing "save20" must not get a different coupon from "SAVE20".
  const clash = await apiFetch(server.baseUrl, '/admin/coupons', {
    method: 'POST', token: adminToken,
    body: { code: code.toLowerCase(), name: 'ZZ Test clash', discountType: 'percentage', discountPercent: 50 },
  })
  assert.equal(clash.status, 409)
  assert.equal(clash.body.error.code, 'COUPON_CODE_TAKEN')
})

test("a seller cannot see or edit another seller's coupon", async () => {
  const created = await apiFetch(server.baseUrl, '/seller/me/coupons', {
    method: 'POST', token: sellerAToken,
    body: { code: uniqueCode(), name: 'ZZ Test alpha only', discountType: 'percentage', discountPercent: 10 },
  })
  assert.equal(created.status, 201)
  const id = created.body.data.id

  for (const [method, body] of [['GET', undefined], ['PATCH', { name: 'hijacked' }], ['DELETE', undefined]]) {
    const attempt = await apiFetch(server.baseUrl, `/seller/me/coupons/${id}`, { method, token: sellerBToken, body })
    assert.equal(attempt.status, 404, `${method} must not expose Seller A's coupon to Seller B`)
  }

  const bList = await apiFetch(server.baseUrl, '/seller/me/coupons', { token: sellerBToken })
  assert.ok(
    !bList.body.data.items.some((coupon) => coupon.id === id),
    "Seller A's coupon must not appear in Seller B's list",
  )
})

test('a seller does not see Mirwal-wide coupons in their own list', async () => {
  // An admin-owned coupon has seller_id NULL. It is not the seller's to manage, so it must
  // not appear in their list at all — not merely be read-only there.
  const code = uniqueCode()
  await apiFetch(server.baseUrl, '/admin/coupons', {
    method: 'POST', token: adminToken,
    body: { code, name: 'ZZ Test sitewide', discountType: 'percentage', discountPercent: 5 },
  })
  const sellerList = await apiFetch(server.baseUrl, '/seller/me/coupons', { token: sellerAToken })
  assert.ok(!sellerList.body.data.items.some((coupon) => coupon.code === code))
})

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

test('a flash sale must have an end time', async () => {
  // Without one the storefront countdown has nothing to count down to, and it is
  // indistinguishable from an ordinary promotion.
  const { status, body } = await apiFetch(server.baseUrl, '/admin/promotions', {
    method: 'POST', token: adminToken,
    body: { name: 'ZZ Test endless flash', kind: 'flash_sale', discountType: 'percentage', discountPercent: 30 },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'FLASH_SALE_WINDOW_REQUIRED')
})

test('a scheduled promotion reports itself as scheduled, not active', async () => {
  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  const later = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString()
  const { status, body } = await apiFetch(server.baseUrl, '/admin/promotions', {
    method: 'POST', token: adminToken,
    body: {
      name: 'ZZ Test future sale', kind: 'promotion', status: 'active',
      discountType: 'percentage', discountPercent: 15, startsAt: future, endsAt: later,
    },
  })
  assert.equal(status, 201)
  // Stored status is the intent; effectiveStatus is the truth right now.
  assert.equal(body.data.status, 'active')
  assert.equal(body.data.effectiveStatus, 'scheduled')
})

test("a seller cannot attach another seller's product to their promotion", async () => {
  const victim = await apiFetch(server.baseUrl, '/seller/me/products', { token: sellerBToken })
  const foreignProductId = victim.body.data.items[0]?.id
  assert.ok(foreignProductId, 'Seller B should have seed products')

  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/promotions', {
    method: 'POST', token: sellerAToken,
    body: {
      name: 'ZZ Test cross-store promo', discountType: 'percentage', discountPercent: 20,
      productIds: [foreignProductId],
    },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'PRODUCT_NOT_OWNED')
})

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

test('a banner cannot link off-site', async () => {
  // The homepage hero is the most prominent slot on mirwal.pk; an absolute URL here would
  // turn it into an open redirect.
  const { status, body } = await apiFetch(server.baseUrl, '/admin/banners', {
    method: 'POST', token: adminToken,
    body: {
      title: 'ZZ Test offsite', imageUrl: 'https://example.com/a.png',
      linkUrl: 'https://evil.example.com/phish',
    },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'EXTERNAL_LINK_REJECTED')
})

// ---------------------------------------------------------------------------
// Support — the form that used to discard its input
// ---------------------------------------------------------------------------

test('a seller ticket is stored and returns a quotable reference', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/tickets', {
    method: 'POST', token: sellerAToken,
    body: { subject: 'ZZ Test payout question', message: 'When are withdrawals processed?', category: 'payments' },
  })
  assert.equal(status, 201)
  assert.match(body.data.reference, /^MW-T-\d{6}$/)
  assert.equal(body.data.messages.length, 1, 'the opening message is part of the ticket')

  // And it is genuinely readable back, which the old fake form never managed.
  const reread = await apiFetch(server.baseUrl, `/seller/me/tickets/${body.data.id}`, { token: sellerAToken })
  assert.equal(reread.status, 200)
  assert.equal(reread.body.data.messages[0].body, 'When are withdrawals processed?')
})

test('staff internal notes are never returned to the requester', async () => {
  const created = await apiFetch(server.baseUrl, '/seller/me/tickets', {
    method: 'POST', token: sellerAToken,
    body: { subject: 'ZZ Test privacy', message: 'A question that needs internal triage.' },
  })
  const id = created.body.data.id

  await apiFetch(server.baseUrl, `/admin/tickets/${id}/messages`, {
    method: 'POST', token: adminToken,
    body: { body: 'Internal: verify their bank details before replying.', isInternal: true },
  })
  await apiFetch(server.baseUrl, `/admin/tickets/${id}/messages`, {
    method: 'POST', token: adminToken,
    body: { body: 'Withdrawals are processed weekly.', isInternal: false },
  })

  const staffView = await apiFetch(server.baseUrl, `/admin/tickets/${id}`, { token: adminToken })
  const sellerView = await apiFetch(server.baseUrl, `/seller/me/tickets/${id}`, { token: sellerAToken })

  assert.equal(staffView.body.data.messages.length, 3)
  assert.equal(sellerView.body.data.messages.length, 2, 'the internal note must be absent')
  assert.ok(
    sellerView.body.data.messages.every((message) => !message.isInternal),
    'no message the requester can read may be internal',
  )
  assert.ok(
    !JSON.stringify(sellerView.body).includes('verify their bank details'),
    'the internal text must not appear anywhere in the requester payload',
  )
})

test("a requester's message count matches the thread they can actually see", async () => {
  // The list showing "3 messages" beside a thread containing 2 both looks broken and reveals
  // that a hidden message exists — the exact thing internal notes are meant to conceal.
  const created = await apiFetch(server.baseUrl, '/seller/me/tickets', {
    method: 'POST', token: sellerAToken,
    body: { subject: 'ZZ Test count', message: 'Opening message.' },
  })
  const id = created.body.data.id

  await apiFetch(server.baseUrl, `/admin/tickets/${id}/messages`, {
    method: 'POST', token: adminToken, body: { body: 'Internal triage note.', isInternal: true },
  })

  const list = await apiFetch(server.baseUrl, '/seller/me/tickets', { token: sellerAToken })
  const listed = list.body.data.items.find((ticket) => ticket.id === id)
  const thread = await apiFetch(server.baseUrl, `/seller/me/tickets/${id}`, { token: sellerAToken })

  assert.equal(listed.messageCount, thread.body.data.messages.length)
  assert.equal(listed.messageCount, 1, 'the internal note must not be counted for the requester')

  // Staff still see the true total, including the note.
  const staffList = await apiFetch(server.baseUrl, '/admin/tickets', { token: adminToken })
  const staffListed = staffList.body.data.items.find((ticket) => ticket.id === id)
  assert.equal(staffListed.messageCount, 2)
})

test('a requester cannot write an internal note', async () => {
  const created = await apiFetch(server.baseUrl, '/seller/me/tickets', {
    method: 'POST', token: sellerAToken,
    body: { subject: 'ZZ Test note privilege', message: 'Trying to add a staff-only note.' },
  })
  const { status } = await apiFetch(server.baseUrl, `/seller/me/tickets/${created.body.data.id}/messages`, {
    method: 'POST', token: sellerAToken, body: { body: 'sneaky', isInternal: true },
  })
  assert.equal(status, 403)
})

test("a seller cannot read another seller's ticket", async () => {
  const created = await apiFetch(server.baseUrl, '/seller/me/tickets', {
    method: 'POST', token: sellerAToken,
    body: { subject: 'ZZ Test tenancy', message: 'Only Seller A should see this.' },
  })
  const { status } = await apiFetch(server.baseUrl, `/seller/me/tickets/${created.body.data.id}`, { token: sellerBToken })
  assert.equal(status, 404)
})

test('a customer sees only their own tickets', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'support' })
  const created = await apiFetch(server.baseUrl, '/support/tickets', {
    method: 'POST', token: user.accessToken,
    body: { subject: 'ZZ Test customer ticket', message: 'Where is my order?' },
  })
  assert.equal(created.status, 201)

  const list = await apiFetch(server.baseUrl, '/support/tickets', { token: user.accessToken })
  assert.equal(list.body.data.pagination.total, 1, 'a new customer sees exactly their own one ticket')

  await query('DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE requester_id = (SELECT id FROM users WHERE email = ?))', [user.email])
  await query('DELETE FROM support_tickets WHERE requester_id = (SELECT id FROM users WHERE email = ?)', [user.email])
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

// ---------------------------------------------------------------------------
// Payouts — money
// ---------------------------------------------------------------------------

/**
 * Give Seller A a fresh, withdrawable earning.
 *
 * These tests used to rely on the seed leaving an unconsumed balance, which meant they only
 * passed on a virgin database: the first run withdrew the money and every run after it failed.
 * A suite that has to be preceded by `db:reset` is a suite people re-run rather than trust.
 *
 * Writing the ledger row directly is deliberate — the point under test is the payout
 * assembly, not how an earning gets there, and driving a whole order through delivery would
 * couple this file to the fulfilment tests.
 */
async function giveSellerAPayableBalance() {
  const [seller] = await query("SELECT id FROM sellers WHERE slug = 'dev-store-alpha'")

  // Ask the same question the endpoint asks, rather than guessing from order items. Seeded
  // earnings can legitimately be unavailable — inside the payout hold, or reserved against a
  // return another test file opened — and a helper that assumed "delivered item = payable"
  // reproduced exactly the seed-dependence it was meant to remove.
  const balance = await getBalance(seller.id)
  if (balance.canRequest) return

  await query(
    `INSERT INTO seller_ledger_entries (public_id, seller_id, entry_type, amount, description)
     VALUES (UUID(), ?, 'adjustment', 5000.00, 'Test top-up')`,
    [seller.id],
  )
}

test('a withdrawal claims its order items so they cannot be paid twice', async () => {
  await giveSellerAPayableBalance()

  const before = await apiFetch(server.baseUrl, '/seller/me/balance', { token: sellerAToken })
  assert.equal(before.status, 200)
  assert.ok(before.body.data.canRequest, 'Seller A should have a payable balance')
  const itemCount = before.body.data.itemCount

  const requested = await apiFetch(server.baseUrl, '/seller/me/payouts', {
    method: 'POST', token: sellerAToken, body: { method: 'bank_transfer' },
  })
  assert.equal(requested.status, 201)
  assert.equal(requested.body.data.itemCount, itemCount)

  // The same earnings must not still be available — that is what would let a seller request
  // the same money twice.
  const after = await apiFetch(server.baseUrl, '/seller/me/balance', { token: sellerAToken })
  assert.ok(
    after.body.data.itemCount < itemCount || itemCount === 0,
    'the claimed earnings must no longer be offered',
  )

  const second = await apiFetch(server.baseUrl, '/seller/me/payouts', { method: 'POST', token: sellerAToken, body: {} })
  assert.equal(second.status, 409)
  assert.equal(second.body.error.code, 'PAYOUT_IN_PROGRESS')
})

test('a payout cannot be marked paid without being approved, or without a reference', async () => {
  const list = await apiFetch(server.baseUrl, '/admin/payouts', { token: adminToken })
  const payout = list.body.data.items[0]
  assert.ok(payout, 'the previous test should have left a requested payout')

  const skipped = await apiFetch(server.baseUrl, `/admin/payouts/${payout.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'paid', externalReference: 'X' },
  })
  assert.equal(skipped.status, 409)
  assert.equal(skipped.body.error.code, 'INVALID_STATUS_TRANSITION')

  const approved = await apiFetch(server.baseUrl, `/admin/payouts/${payout.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'approved' },
  })
  assert.equal(approved.status, 200)

  // Marking money as sent with nothing to reconcile against the bank is the mistake this
  // check exists to prevent.
  const noReference = await apiFetch(server.baseUrl, `/admin/payouts/${payout.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'paid' },
  })
  assert.equal(noReference.status, 400)
  assert.equal(noReference.body.error.code, 'REFERENCE_REQUIRED')

  const paid = await apiFetch(server.baseUrl, `/admin/payouts/${payout.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'paid', externalReference: 'ZZ-TEST-TXN-1' },
  })
  assert.equal(paid.status, 200)
})

test("a seller cannot read another seller's payout", async () => {
  const list = await apiFetch(server.baseUrl, '/seller/me/payouts', { token: sellerAToken })
  const payout = list.body.data.items[0]
  assert.ok(payout)
  const { status } = await apiFetch(server.baseUrl, `/seller/me/payouts/${payout.id}`, { token: sellerBToken })
  assert.equal(status, 404)
})

// ---------------------------------------------------------------------------
// Webhooks — secrets
// ---------------------------------------------------------------------------

test('a webhook secret is returned once and never listed again', async () => {
  const created = await apiFetch(server.baseUrl, '/admin/webhooks', {
    method: 'POST', token: adminToken,
    body: { name: 'ZZ Test hook', url: 'https://example.com/hook', events: ['order.paid'] },
  })
  assert.equal(created.status, 201)
  assert.match(created.body.data.secret, /^whsec_/)

  const list = await apiFetch(server.baseUrl, '/admin/webhooks', { token: adminToken })
  const hook = list.body.data.find((row) => row.id === created.body.data.id)
  assert.ok(hook)
  assert.equal(hook.secret, undefined, 'the listing must never carry the secret')
  assert.match(hook.secretHint, /^••••/)
  assert.ok(
    !JSON.stringify(list.body).includes(created.body.data.secret),
    'the secret must not appear anywhere in the listing payload',
  )
})

test('a webhook endpoint must use https', async () => {
  const { status } = await apiFetch(server.baseUrl, '/admin/webhooks', {
    method: 'POST', token: adminToken,
    body: { name: 'ZZ Test insecure', url: 'http://example.com/hook', events: ['order.paid'] },
  })
  assert.equal(status, 400)
})

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('the access matrix reflects the grants the server actually enforces', async () => {
  const matrix = await apiFetch(server.baseUrl, '/admin/access-matrix', { token: adminToken })
  assert.equal(matrix.status, 200)
  // Read straight from role_permissions — the same rows requirePermission consults.
  const [{ count }] = await query(
    "SELECT COUNT(*) AS count FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.slug = 'admin'",
  )
  assert.equal(matrix.body.data.admin.length, Number(count))
})

test('the super_admin and customer roles cannot be edited', async () => {
  for (const slug of ['super_admin', 'customer']) {
    const { status, body } = await apiFetch(server.baseUrl, `/admin/roles/${slug}/permissions`, {
      method: 'PUT', token: adminToken, body: { permissions: [] },
    })
    assert.equal(status, 409, `${slug} must be locked`)
    assert.equal(body.error.code, 'ROLE_LOCKED')
  }
})

test('granting an unknown permission is refused', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/roles/seller/permissions', {
    method: 'PUT', token: adminToken, body: { permissions: ['catalog.product.read', 'not.a.real.permission'] },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'UNKNOWN_PERMISSION')
})

// ---------------------------------------------------------------------------
// Privilege
// ---------------------------------------------------------------------------

test('a seller cannot reach the admin marketing, settings or payout endpoints', async () => {
  const paths = [
    ['GET', '/admin/coupons'], ['GET', '/admin/settings'], ['GET', '/admin/payouts'],
    ['GET', '/admin/webhooks'], ['GET', '/admin/roles'], ['GET', '/admin/banners'],
  ]
  for (const [method, path] of paths) {
    const { status } = await apiFetch(server.baseUrl, path, { method, token: sellerAToken })
    assert.equal(status, 403, `${path} must be forbidden for a seller`)
  }
})

test('a customer cannot reach seller payout or marketing endpoints', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'privesc' })
  for (const path of ['/seller/me/balance', '/seller/me/coupons', '/seller/me/payouts']) {
    const { status } = await apiFetch(server.baseUrl, path, { token: user.accessToken })
    assert.equal(status, 403, `${path} must be forbidden for a customer`)
  }
  await query('DELETE FROM users WHERE email = ?', [user.email])
})
