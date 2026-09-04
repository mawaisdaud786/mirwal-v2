import http from 'node:http'
import { createApp } from '../src/app.js'

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
