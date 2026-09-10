import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch } from './setup.js'
import { closePool } from '../src/db/pool.js'
import { rateLimitKey } from '../src/middleware/rateLimit.js'

/**
 * Rate limits.
 *
 * Every limiter runs relaxed under test — hundreds of requests in seconds would trip a
 * production limit and produce failures that look like application bugs — so asserting on live
 * 429s here would only prove that the relaxation works. What is worth testing is the part that
 * would rot silently:
 *
 *   - the key is the **account** when there is one. That is the whole point of the change: in
 *     Pakistan an IP is routinely shared by a carrier's entire subscriber base, so an IP-keyed
 *     limit punishes bystanders and misses the signed-in abuser who changes networks;
 *   - an IPv6 caller cannot buy a fresh budget by moving one address along its own /64;
 *   - the limiters did not accidentally change who may reach a route.
 */

let server

before(async () => { server = await startTestServer() })
after(async () => { await server?.close(); await closePool() })

test('a signed-in caller is limited as an account, not as an address', () => {
  const first = rateLimitKey({ user: { id: 42 }, ip: '203.0.113.9' })
  const second = rateLimitKey({ user: { id: 42 }, ip: '198.51.100.7' })
  assert.equal(first, second, 'changing networks must not reset the budget')
  assert.match(first, /^u:/)
})

test('two accounts behind one address do not share a budget', () => {
  const shared = '203.0.113.9'
  assert.notEqual(
    rateLimitKey({ user: { id: 1 }, ip: shared }),
    rateLimitKey({ user: { id: 2 }, ip: shared }),
  )
})

test('anonymous callers fall back to the address', () => {
  assert.equal(rateLimitKey({ ip: '203.0.113.9' }), 'ip:203.0.113.9')
  // Express reports IPv4 clients as IPv4-mapped IPv6 on a dual-stack socket; both spellings of
  // the same client must land on one key.
  assert.equal(rateLimitKey({ ip: '::ffff:203.0.113.9' }), 'ip:203.0.113.9')
})

test('an IPv6 caller cannot walk their own /64 for a fresh budget', () => {
  const first = rateLimitKey({ ip: '2001:db8:1234:5678:aaaa:bbbb:cccc:dddd' })
  const second = rateLimitKey({ ip: '2001:db8:1234:5678:1111:2222:3333:4444' })
  assert.equal(first, second)

  // A genuinely different network still gets its own budget.
  assert.notEqual(first, rateLimitKey({ ip: '2001:db8:1234:9999:aaaa:bbbb:cccc:dddd' }))
})

test('a missing address does not throw or collapse into an empty key', () => {
  assert.equal(rateLimitKey({}), 'ip:unknown')
})

test('reporting a product is still reachable without an account', async () => {
  // The report limiter sits in front of `optionalAuth`-guarded routes. If it were ever attached
  // somewhere that implied authentication, Mirwal would lose the counterfeit reports that
  // matter most — the ones from shoppers who have not signed in.
  const response = await apiFetch(server.baseUrl, '/products/does-not-exist/report', {
    method: 'POST',
    body: { reasonCode: 'counterfeit', details: 'Checking that the route is reachable anonymously.' },
  })
  assert.notEqual(response.status, 401)
  assert.notEqual(response.status, 429)
})

test('an ordinary burst of catalogue reads is not throttled', async () => {
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => apiFetch(server.baseUrl, '/products?pageSize=1')),
  )
  assert.ok(responses.every((response) => response.status === 200), 'a normal burst should not be limited')
})
