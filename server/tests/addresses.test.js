import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/** A buyer's saved address book — see migration 004 and server/src/modules/addresses. */

let server
let userA
let userB

const addr = (overrides = {}) => ({
  fullName: 'Test Buyer', phone: '03001112222', line1: 'House 1, Street 2', city: 'Lahore', ...overrides,
})

before(async () => {
  server = await startTestServer()
  userA = await registerTestUser(server.baseUrl, { label: 'addr-a' })
  userB = await registerTestUser(server.baseUrl, { label: 'addr-b' })
})

after(async () => {
  // Unlike orders, fk_addresses_user is ON DELETE CASCADE — deleting these throwaway users
  // is safe and takes their addresses with them. Still guarded so a failure here can never
  // prevent the server/pool from closing (see orders.test.js's after() for what happens
  // when it does: the process hangs indefinitely on an open socket/connection instead of
  // exiting).
  try {
    await query('DELETE FROM users WHERE email IN (?, ?)', [userA.email, userB.email])
  } finally {
    await server.close()
    await closePool()
  }
})

test('the first saved address becomes the default automatically', async () => {
  const created = await apiFetch(server.baseUrl, '/addresses', { method: 'POST', token: userA.accessToken, body: addr({ fullName: 'Home' }) })
  assert.equal(created.status, 201)
  assert.equal(created.body.data.isDefault, true)
})

test('exactly one address is ever the default', async () => {
  const second = await apiFetch(server.baseUrl, '/addresses', {
    method: 'POST', token: userA.accessToken, body: addr({ fullName: 'Office', city: 'Islamabad', isDefault: true }),
  })
  assert.equal(second.status, 201)
  assert.equal(second.body.data.isDefault, true)

  const list = await apiFetch(server.baseUrl, '/addresses', { token: userA.accessToken })
  const defaults = list.body.data.filter((address) => address.isDefault)
  assert.equal(defaults.length, 1)
  assert.equal(defaults[0].fullName, 'Office')
})

test('deleting the current default promotes the next remaining address', async () => {
  const list = await apiFetch(server.baseUrl, '/addresses', { token: userA.accessToken })
  const office = list.body.data.find((address) => address.fullName === 'Office')
  const deleted = await apiFetch(server.baseUrl, `/addresses/${office.id}`, { method: 'DELETE', token: userA.accessToken })
  assert.equal(deleted.status, 200)

  const after1 = await apiFetch(server.baseUrl, '/addresses', { token: userA.accessToken })
  assert.equal(after1.body.data.length, 1)
  assert.equal(after1.body.data[0].isDefault, true)
  assert.equal(after1.body.data[0].fullName, 'Home')
})

test('a user cannot read, edit or delete another user\'s address', async () => {
  const list = await apiFetch(server.baseUrl, '/addresses', { token: userA.accessToken })
  const homeId = list.body.data[0].id

  const intrudeUpdate = await apiFetch(server.baseUrl, `/addresses/${homeId}`, { method: 'PUT', token: userB.accessToken, body: addr({ fullName: 'Hijacked' }) })
  assert.equal(intrudeUpdate.status, 403)

  const intrudeDelete = await apiFetch(server.baseUrl, `/addresses/${homeId}`, { method: 'DELETE', token: userB.accessToken })
  assert.equal(intrudeDelete.status, 403)

  // Confirm the address is genuinely untouched.
  const stillThere = await apiFetch(server.baseUrl, '/addresses', { token: userA.accessToken })
  assert.equal(stillThere.body.data[0].fullName, 'Home')
})

test('two different users can each have their own default with no cross-talk', async () => {
  const created = await apiFetch(server.baseUrl, '/addresses', { method: 'POST', token: userB.accessToken, body: addr({ fullName: 'B\'s Place' }) })
  assert.equal(created.body.data.isDefault, true)

  const aList = await apiFetch(server.baseUrl, '/addresses', { token: userA.accessToken })
  const bList = await apiFetch(server.baseUrl, '/addresses', { token: userB.accessToken })
  assert.equal(aList.body.data.length, 1)
  assert.equal(bList.body.data.length, 1)
  assert.notEqual(aList.body.data[0].id, bList.body.data[0].id)
})
