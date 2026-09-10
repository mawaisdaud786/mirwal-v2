import http from 'node:http'
import { createApp } from '../src/app.js'

/**
 * Mark this process as the test suite.
 *
 * Set after the imports deliberately — ESM hoists imports, so an assignment written above them
 * would still run second and reading like it ran first is worse than not writing it there.
 * This works because `env.isTest` is a getter evaluated inside `createApp()` at call time, not
 * a constant captured when `env.js` was first imported.
 *
 * It relaxes only the global rate limiter. The suite makes several hundred requests in well
 * under a minute from a single process, which the production limit throttles — producing
 * intermittent failures that look like application bugs and teach people to re-run a red suite
 * until it goes green. The credential limiter is deliberately left alone, because brute-force
 * protection is behaviour these tests assert on directly.
 */
process.env.MIRWAL_TEST = '1'

/**
 * Never send a real message from a test.
 *
 * Once SMTP is configured in `.env`, the suite starts delivering to a live mailbox: a single
 * send took twenty-four seconds against Gmail, order-placement tests timed out waiting on the
 * transport, and the "recorded as skipped, not failed" test asserted the opposite of what a
 * configured environment does. Worse, the account gets rate-limited for sending hundreds of
 * identical messages to itself.
 *
 * Blanking the transports here rather than in each test keeps the delivery ledger exercised —
 * every send still records a row — while the network is never touched.
 */
process.env.SMTP_HOST = ''
process.env.SMS_API_URL = ''
process.env.SMS_API_KEY = ''

/**
 * Spins up a real instance of the Express app on an OS-assigned free port, so the test suite
 * never depends on (or fights over a port with) the `npm run dev` server a developer may
 * already have running. Tests exercise the real HTTP layer — routing, validation, auth
 * middleware, error handling — against the real dev MariaDB database, the same one `npm run
 * seed` populates. This is deliberately an integration suite, not a mocked unit suite: the
 * bugs this project has actually shipped (the `/auth/refresh` crash, the localStorage RBAC
 * hole) were bugs in how real layers fit together, not in an isolated function.
 *
 * `package.json`'s "test" script lists each test file explicitly rather than passing this
 * `tests/` directory to `node --test` — on this Windows/Node 24 setup, `node --test tests`
 * (with or without a trailing slash or `./`) fails outright with `MODULE_NOT_FOUND`, treating
 * the bare directory name as a module specifier instead of scanning it; only an explicit file
 * list (or shell-side glob expansion, which cmd.exe doesn't do) works. A new test file needs
 * to be added to that script's file list to actually run under `npm test`.
 */
export async function startTestServer() {
  const app = createApp()
  const server = http.createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}/api/v1`
  return {
    baseUrl,
    // `server.close()` alone waits for every open connection to end before its callback
    // fires — including idle keep-alive sockets, which Node's built-in fetch (undici) reuses
    // by default and does not proactively close. Without `closeAllConnections()`, `close()`
    // can hang indefinitely, which reads as the whole test file hanging rather than as a
    // teardown bug.
    close: () => new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    }),
  }
}

/** Thin JSON fetch wrapper matching the API's `{success, data}` / `{success, error}` envelope. */
export async function apiFetch(baseUrl, path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : null
  return { status: response.status, body: json }
}

/** A unique, obviously-a-test email so cleanup can find (and a human can recognise) test rows. */
export function testEmail(label) {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@mirwal.test`
}

export async function registerTestUser(baseUrl, { label = 'user', fullName = 'Test User' } = {}) {
  const email = testEmail(label)
  const password = 'TestPass123!'
  const { status, body } = await apiFetch(baseUrl, '/auth/register', {
    method: 'POST',
    body: { email, password, fullName },
  })
  if (status !== 200 && status !== 201) throw new Error(`registerTestUser failed: ${status} ${JSON.stringify(body)}`)
  return { email, password, userId: body.data.user.id, accessToken: body.data.accessToken }
}

export async function loginAs(baseUrl, email, password) {
  const { status, body } = await apiFetch(baseUrl, '/auth/login', { method: 'POST', body: { email, password } })
  if (status !== 200) throw new Error(`loginAs(${email}) failed: ${status} ${JSON.stringify(body)}`)
  return body.data.accessToken
}

/**
 * Ship an item the way a seller actually does.
 *
 * `PATCH .../status` no longer accepts 'shipped': that status is what a *shipment* means, and
 * it carries the carrier, tracking number and dispatch time a buyer needs to follow a parcel —
 * and the only evidence either side has in an "it never arrived" dispute. Setting it directly
 * left it decorative, so the API refuses and these tests take the real path.
 */
export async function shipItem(baseUrl, token, orderItemId, apiFetch) {
  const carriers = await apiFetch(baseUrl, '/seller/me/carriers', { token })
  const carrierSlug = carriers.body.data[0].slug
  const result = await apiFetch(baseUrl, '/seller/me/shipments', {
    method: 'POST',
    token,
    body: {
      orderItemIds: [orderItemId],
      carrierSlug,
      // Unique per shipment: `uq_shipments_tracking` refuses a duplicate on the same carrier,
      // which is the point — a repeated number is a typo, never a second parcel.
      trackingNumber: `TEST-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    },
  })
  if (result.status !== 201 && result.status !== 200) {
    throw new Error(`shipItem failed: ${JSON.stringify(result.body)}`)
  }
  return result.body.data
}
