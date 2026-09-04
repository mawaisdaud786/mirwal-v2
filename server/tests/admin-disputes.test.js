import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, loginAs } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * Admin disputes (server/src/modules/admin/disputes.service.js) — a platform-wide,
 * read-only view of `return_requests`/`refunds`. AdminOrderPages.jsx's Disputes view claimed
 * "there is still no disputes, refunds or returns system" — stale once those tables became
 * real for the seller and buyer views. This checks it actually spans every seller (not just
 * one, the way the seller-scoped Returns page correctly does) and that a non-admin cannot
 * reach it.
 */

let server
let adminToken
let sellerToken

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
  sellerToken = await loginAs(server.baseUrl, 'seller.a@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  await server.close()
  await closePool()
})

test('only an admin can reach the platform disputes view', async () => {
  assert.equal((await apiFetch(server.baseUrl, '/admin/disputes', { token: sellerToken })).status, 403)
  assert.equal((await apiFetch(server.baseUrl, '/admin/disputes')).status, 401)
})

test('admin disputes reflects real return_requests and is internally consistent', async () => {
  const [{ status, body }, [realCount]] = await Promise.all([
    apiFetch(server.baseUrl, '/admin/disputes', { token: adminToken }),
    query('SELECT COUNT(*) AS n FROM return_requests'),
  ])
  assert.equal(status, 200)
  assert.equal(body.data.disputes.length, Math.min(Number(realCount.n), 200))
  assert.equal(
    body.data.summary.pending + body.data.summary.approved + body.data.summary.rejected,
    body.data.disputes.length,
    'every dispute must fall into exactly one status bucket',
  )
  for (const dispute of body.data.disputes) {
    assert.ok(dispute.buyerName && dispute.sellerName, 'every dispute must resolve to a real buyer and seller')
  }
})
