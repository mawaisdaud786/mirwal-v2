import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'
import { renderTemplate } from '../src/lib/mailer.js'

/**
 * Transactional messaging and seller verification documents.
 *
 * These two capabilities are new, and the risks they introduce are the ones worth testing:
 * user-supplied text reaching an inbox unescaped, an executable uploaded under an image
 * content type, one seller reading another's identity documents, and a message being reported
 * as sent when nothing was.
 *
 * The suite runs with no SMTP host configured, which is the realistic default and lets the
 * `skipped` path be asserted directly.
 */

let server
let adminToken
let sellerAToken
let sellerBToken

// A real 1x1 PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478'
  + '9c636000000200010005fe02fa0000000049454e44ae426082',
  'hex',
)

async function scopedLogin(scope, email) {
  const { status, body } = await apiFetch(server.baseUrl, `/${scope}/auth/login`, {
    method: 'POST', body: { email, password: 'MirwalDev123!' },
  })
  if (status !== 200) throw new Error(`${scope} login failed: ${status} ${JSON.stringify(body)}`)
  return body.data.accessToken
}

/** Upload a file as a seller. Raw fetch — apiFetch only sends JSON. */
async function uploadAs(token, { buffer, filename, type, docType }) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type }), filename)
  form.append('docType', docType)
  const response = await fetch(`${server.baseUrl}/seller/me/documents`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  })
  return { status: response.status, body: await response.json() }
}

before(async () => {
  server = await startTestServer()
  adminToken = await scopedLogin('admin', 'admin@mirwal.test')
  sellerAToken = await scopedLogin('seller', 'seller.a@mirwal.test')
  sellerBToken = await scopedLogin('seller', 'seller.b@mirwal.test')

  // Start from a known state. Uploads are deduplicated by checksum, so a document left over
  // from manual testing would make the very first upload here fail as a duplicate — a
  // confusing failure that says nothing about the code under test.
  await query('DELETE FROM seller_documents')
  await query('DELETE FROM message_deliveries')
})

after(async () => {
  try {
    await query('DELETE FROM seller_documents')
    await query('DELETE FROM message_deliveries')
    await query("DELETE FROM message_templates WHERE `key` LIKE 'zz.%'")
    await server.close()
  } finally { await closePool() }
})

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

test('template values are HTML-escaped', () => {
  // A customer name, a rejection reason and a store name all reach a template, and all are
  // user-supplied. Rendering them raw would put stored XSS into every recipient's inbox.
  const out = renderTemplate('<p>Hi {{name}}</p>', { name: '<script>alert(1)</script>' })
  assert.ok(!out.includes('<script>'), 'a script tag must not survive rendering')
  assert.ok(out.includes('&lt;script&gt;'))
})

test('SMS rendering does not escape, because there is no markup in a text message', () => {
  const out = renderTemplate('Code {{code}} for {{name}}', { code: '123', name: 'A & B' }, { escape: false })
  assert.equal(out, 'Code 123 for A & B', 'an SMS containing &amp; would read as a bug')
})

test('an unknown placeholder is left visible rather than silently blanked', () => {
  // A typo that renders as an empty gap is invisible; one that renders as {{oderNumber}} is
  // noticed the first time anyone looks at the message.
  assert.equal(renderTemplate('Order {{oderNumber}}', { orderNumber: 'X' }), 'Order {{oderNumber}}')
})

// ---------------------------------------------------------------------------
// Templates and delivery ledger
// ---------------------------------------------------------------------------

test('default templates are seeded and expose their placeholders', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/messaging/templates', { token: adminToken })
  assert.equal(status, 200)
  const confirmation = body.data.find((template) => template.key === 'order.confirmation')
  assert.ok(confirmation, 'order.confirmation should exist')
  assert.ok(confirmation.variables.includes('orderNumber'))
})

test('a template cannot reference a placeholder the sending code never supplies', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/messaging/templates/email/order.confirmation', {
    method: 'PATCH', token: adminToken, body: { body: '<p>Order {{oderNumber}}</p>' },
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'UNKNOWN_PLACEHOLDER')
})

test('a send with no provider is recorded as skipped, not failed', async () => {
  // The distinction is the whole point of the ledger: "nothing is configured" must not look
  // like "the provider refused", or an operator hunts a fault that does not exist.
  const { status, body } = await apiFetch(server.baseUrl, '/admin/messaging/send-test', {
    method: 'POST', token: adminToken, body: { key: 'order.confirmation', channel: 'email', to: 'nobody@example.com' },
  })
  assert.equal(status, 200)
  assert.equal(body.data.status, 'skipped')

  const log = await apiFetch(server.baseUrl, '/admin/messaging/deliveries?pageSize=5', { token: adminToken })
  const entry = log.body.data.items.find((item) => item.recipient === 'nobody@example.com')
  assert.ok(entry, 'the attempt must still be recorded')
  assert.equal(entry.status, 'skipped')
})

test('the delivery ledger never stores the rendered body', async () => {
  // Bodies carry order totals and addresses; the ledger keeps the variables instead.
  const rows = await query('SELECT context FROM message_deliveries LIMIT 20')
  for (const row of rows) {
    if (!row.context) continue
    const context = typeof row.context === 'object' ? row.context : JSON.parse(row.context)
    assert.ok(!('body' in context) && !('html' in context), 'context must not carry a rendered body')
  }
})

// ---------------------------------------------------------------------------
// Document upload
// ---------------------------------------------------------------------------

test('a real PNG is accepted', async () => {
  const { status, body } = await uploadAs(sellerAToken, {
    buffer: PNG, filename: 'cnic.png', type: 'image/png', docType: 'cnic_front',
  })
  assert.equal(status, 201)
  assert.ok(body.data.id)
})

test('a script declaring itself an image is rejected on its contents', async () => {
  // The client controls the filename and the Content-Type; it does not control the bytes.
  const { status, body } = await uploadAs(sellerAToken, {
    buffer: Buffer.from('<?php system($_GET["c"]); ?>', 'utf8'),
    filename: 'harmless.png', type: 'image/png', docType: 'other',
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'UNSUPPORTED_FILE_TYPE')
})

test('re-uploading identical bytes is refused', async () => {
  const { status, body } = await uploadAs(sellerAToken, {
    buffer: PNG, filename: 'again.png', type: 'image/png', docType: 'cnic_back',
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'DUPLICATE_DOCUMENT')
})

test('a seller sees which required documents are still outstanding', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/seller/me/documents', { token: sellerAToken })
  assert.equal(status, 200)
  assert.equal(body.data.isVerified, false, 'not verified until every required document is approved')
  const outstanding = body.data.requirements.filter((entry) => entry.required && !entry.provided)
  assert.ok(outstanding.some((entry) => entry.type === 'cnic_back'))
})

// ---------------------------------------------------------------------------
// Document access control
// ---------------------------------------------------------------------------

test("a seller cannot download another seller's document", async () => {
  const list = await apiFetch(server.baseUrl, '/seller/me/documents', { token: sellerAToken })
  const doc = list.body.data.documents[0]
  assert.ok(doc)

  const response = await fetch(`${server.baseUrl}/seller/me/documents/${doc.id}/file`, {
    headers: { Authorization: `Bearer ${sellerBToken}` },
  })
  // 404 rather than 403: a 403 would confirm the id names a real document.
  assert.equal(response.status, 404)
})

test('a document download is served as a non-sniffable, uncacheable attachment', async () => {
  const list = await apiFetch(server.baseUrl, '/seller/me/documents', { token: sellerAToken })
  const doc = list.body.data.documents[0]

  const response = await fetch(`${server.baseUrl}/admin/seller-documents/${doc.id}/file`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert.equal(response.status, 200)
  // Together these stop an uploaded file rendering inline in Mirwal's own origin, which is
  // how an uploaded HTML or SVG becomes stored XSS.
  assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)

  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.equals(PNG), 'the bytes returned must be the bytes uploaded')
})

test('a customer cannot reach the document endpoints at all', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'docpriv' })
  for (const path of ['/admin/seller-documents', '/seller/me/documents']) {
    const { status } = await apiFetch(server.baseUrl, path, { token: user.accessToken })
    assert.equal(status, 403, `${path} must be forbidden for a customer`)
  }
  await query('DELETE FROM users WHERE email = ?', [user.email])
})

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

test('rejecting a document requires a reason the seller can act on', async () => {
  const list = await apiFetch(server.baseUrl, '/admin/seller-documents?status=pending', { token: adminToken })
  const doc = list.body.data.items[0]
  assert.ok(doc)

  const bare = await apiFetch(server.baseUrl, `/admin/seller-documents/${doc.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'rejected' },
  })
  assert.equal(bare.status, 400)

  const withReason = await apiFetch(server.baseUrl, `/admin/seller-documents/${doc.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'rejected', note: 'The scan is cut off at the edge.' },
  })
  assert.equal(withReason.status, 200)

  // And the seller is told, through the ledger, why.
  const sellerView = await apiFetch(server.baseUrl, '/seller/me/documents', { token: sellerAToken })
  const seen = sellerView.body.data.documents.find((entry) => entry.id === doc.id)
  assert.equal(seen.status, 'rejected')
  assert.equal(seen.reviewNote, 'The scan is cut off at the edge.')
})

test('an approved document cannot be removed by the seller', async () => {
  const list = await apiFetch(server.baseUrl, '/seller/me/documents', { token: sellerAToken })
  const doc = list.body.data.documents[0]

  await apiFetch(server.baseUrl, `/admin/seller-documents/${doc.id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'approved', note: 'Clear.' },
  })

  const { status, body } = await apiFetch(server.baseUrl, `/seller/me/documents/${doc.id}`, {
    method: 'DELETE', token: sellerAToken,
  })
  assert.equal(status, 409)
  assert.equal(body.error.code, 'DOCUMENT_APPROVED')
})
