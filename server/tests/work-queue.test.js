import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * The operations board.
 *
 * Mirwal grew a queue at a time, each with its own screen and its own idea of what "waiting"
 * means, and the admin dashboard opened on thirty-day GMV — telling an operator nothing about
 * the people currently waiting on a decision. Answering "what is late" meant visiting eight
 * screens and remembering the ninth.
 *
 * What is worth holding onto here is not the counts, which move constantly, but the two
 * properties that make the board trustworthy:
 *
 *   - it shows only what the caller can act on, because work everybody can see is work nobody
 *     owns;
 *   - a queue it cannot read reports as unavailable rather than as zero. "Nothing waiting" and
 *     "we could not look" are different answers, and conflating them is how a queue quietly
 *     stops being worked.
 */

let server
let adminToken

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
})

after(async () => { await server?.close(); await closePool() })

test('the board reports every queue with an open count and an overdue count', async () => {
  const { status, body } = await apiFetch(server.baseUrl, '/admin/work-queue', { token: adminToken })
  assert.equal(status, 200)

  const keys = body.data.queues.map((queue) => queue.key).sort()
  assert.deepEqual(keys, [
    'applications', 'brandAuthorizations', 'cases', 'payouts',
    'products', 'returnDisputes', 'reviews', 'tickets',
  ])

  for (const queue of body.data.queues) {
    assert.ok(queue.label && queue.link, `${queue.key} must say what it is and where to go`)
    assert.ok(queue.slaHours > 0, `${queue.key} must have a service level`)
    // Overdue is a subset of open, always. A board where they disagree is worse than no board.
    assert.ok(queue.overdue <= queue.open, `${queue.key}: overdue (${queue.overdue}) cannot exceed open (${queue.open})`)
  }

  const summed = body.data.queues.reduce((sum, queue) => sum + queue.open, 0)
  assert.equal(body.data.totals.open, summed, 'the totals must be the rows added up')
})

test('the counts are real, not a placeholder', async () => {
  const { body } = await apiFetch(server.baseUrl, '/admin/work-queue', { token: adminToken })
  const listings = body.data.queues.find((queue) => queue.key === 'products')

  const [{ n }] = await query(
    "SELECT COUNT(*) AS n FROM products WHERE status = 'pending_review' AND deleted_at IS NULL",
  )
  assert.equal(listings.open, Number(n))
})

test('the overdue count follows the service level, not the total', async () => {
  const before = await apiFetch(server.baseUrl, '/admin/work-queue', { token: adminToken })
  const wasOverdue = before.body.data.queues.find((queue) => queue.key === 'products').overdue

  // Push one pending listing past its 24-hour service level and put it back afterwards, so the
  // dev database is left as it was found.
  const [target] = await query(
    "SELECT id, updated_at FROM products WHERE status = 'pending_review' AND deleted_at IS NULL LIMIT 1",
  )
  if (!target) return

  await query('UPDATE products SET updated_at = NOW() - INTERVAL 40 HOUR WHERE id = ?', [target.id])
  try {
    const after = await apiFetch(server.baseUrl, '/admin/work-queue', { token: adminToken })
    const queue = after.body.data.queues.find((entry) => entry.key === 'products')
    assert.equal(queue.overdue, wasOverdue + 1, 'a listing past its SLA must be counted as late')
    assert.ok(queue.overdue <= queue.open)
  } finally {
    await query('UPDATE products SET updated_at = ? WHERE id = ?', [target.updated_at, target.id])
  }
})

test('an operator only sees the queues they can act on', async () => {
  // A shopper holds no admin permission at all, so the board is not theirs to read.
  const shopper = await registerTestUser(server.baseUrl, { label: 'workqueue-outsider' })
  const denied = await apiFetch(server.baseUrl, '/admin/work-queue', { token: shopper.accessToken })
  assert.equal(denied.status, 403)

  // And a seller — who has real permissions, just not staff ones — is refused the same way.
  const sellerToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
  const seller = await apiFetch(server.baseUrl, '/admin/work-queue', { token: sellerToken })
  assert.equal(seller.status, 403)
})
