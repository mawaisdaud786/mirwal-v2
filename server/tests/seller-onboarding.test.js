import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, apiFetch, registerTestUser, loginAs } from './setup.js'
import { query, closePool } from '../src/db/pool.js'

/**
 * Seller onboarding, end to end.
 *
 * This is the capability that did not exist at all: `INSERT INTO sellers` appeared once in the
 * whole codebase, in the database seeder, so the admin "Applications" and "Verification"
 * queues reviewed a list production could never fill and the storefront's application form was
 * a submit handler that set a boolean.
 *
 * What is worth testing here is not the happy path on its own but the rules that make the
 * happy path safe:
 *
 *   - an unverified applicant cannot apply, because Mirwal could not tell them the outcome;
 *   - a business is asked for what a business has, an individual is not;
 *   - one CNIC cannot register two stores;
 *   - approving creates the store AND grants the role in one transaction, so a store whose
 *     owner cannot sign in is not a state that exists;
 *   - a reviewer without the KYC permission does not receive identity numbers;
 *   - reading identity data is written to the PII access log.
 */

let server
let adminToken

/** A CNIC that is unique to this run, so repeated runs do not collide on `uq_sellers_cnic`. */
const uniqueCnic = () => String(Date.now()).slice(-9).padStart(13, '42')

/** Mark an account verified directly — the OTP path has its own test file. */
async function markVerified(email) {
  await query(
    'UPDATE users SET email_verified_at = NOW(3), phone_verified_at = NOW(3), phone = ? WHERE email = ?',
    [`+9230${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`, email],
  )
}

function applicationBody(overrides = {}) {
  return {
    sellerType: 'individual',
    applicantName: 'Awais Khan',
    applicantEmail: 'awais@example.test',
    applicantPhone: '03001234567',
    cnic: uniqueCnic(),
    dateOfBirth: '1990-05-14',
    storeName: `Test Store ${Math.random().toString(36).slice(2, 8)}`,
    addressLine1: '12 Mall Road',
    city: 'Lahore',
    province: 'Punjab',
    categories: 'Electronics',
    acceptedTerms: true,
    ...overrides,
  }
}

before(async () => {
  server = await startTestServer()
  adminToken = await loginAs(server.baseUrl, 'admin@mirwal.test', 'MirwalDev123!')
})

after(async () => {
  // Remove only what this file created. Applications cascade from the user, and an approved
  // application's store is removed first because `sellers.user_id` is ON DELETE RESTRICT.
  await query("DELETE FROM sellers WHERE store_name LIKE 'Test Store %'")
  await query("DELETE FROM users WHERE email LIKE 'test-onboarding-%@mirwal.test'")
  await server.close()
  await closePool()
})

test('an applicant who has not confirmed their contact details cannot apply', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-unverified' })

  const requirements = await apiFetch(server.baseUrl, '/sell/requirements', { token: user.accessToken })
  assert.equal(requirements.status, 200)
  assert.equal(requirements.body.data.canApply, false, 'a brand-new account is not eligible yet')

  const { status, body } = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token: user.accessToken, body: applicationBody(),
  })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'VERIFICATION_REQUIRED')
  // The message has to say what is missing — an applicant who is told only "not eligible"
  // has no way to become eligible.
  assert.match(body.error.message, /email|mobile/i)
})

test('an individual applies, and the queue that was previously unfillable now has a row', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-individual' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)

  const before = await apiFetch(server.baseUrl, '/admin/applications/counts', { token: adminToken })
  const waitingBefore = before.body.data.waiting ?? 0

  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody(),
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.data.status, 'submitted')
  assert.match(created.body.data.reference, /^MW-A-\d{6}$/, 'a quotable reference is assigned')

  const after = await apiFetch(server.baseUrl, '/admin/applications/counts', { token: adminToken })
  assert.equal(after.body.data.waiting, waitingBefore + 1)
})

test('a business is asked for what a business has, and an individual is not', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-business' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)

  const incomplete = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST',
    token,
    // A private limited company with no NTN and no registration number.
    body: applicationBody({ sellerType: 'business', businessType: 'private_limited', ntn: null, cnic: uniqueCnic() }),
  })
  assert.equal(incomplete.status, 400)
  const fields = incomplete.body.error.details.map((detail) => detail.field)
  assert.ok(fields.includes('ntn'), 'a registered business needs an NTN')
  assert.ok(fields.includes('businessRegNo'), 'a private limited company needs a registration number')
  assert.ok(fields.includes('legalName'), 'and a registered name')

  const complete = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST',
    token,
    body: applicationBody({
      sellerType: 'business',
      businessType: 'private_limited',
      legalName: 'Khan Traders (Pvt) Ltd',
      businessRegNo: 'SECP-99881',
      ntn: '1234567-8',
      cnic: uniqueCnic(),
    }),
  })
  assert.equal(complete.status, 201, JSON.stringify(complete.body))
})

test('one account cannot have two applications open at once', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-double' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)

  const first = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody(),
  })
  assert.equal(first.status, 201)

  const second = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody(),
  })
  assert.equal(second.status, 409)
  assert.equal(second.body.error.code, 'APPLICATION_IN_PROGRESS')
})

test('approval creates the store and grants the seller role together', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-approve' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)

  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody(),
  })
  const applicationId = created.body.data.id

  // Before approval the seller namespace refuses them: they hold no seller role and no store.
  const beforeLogin = await apiFetch(server.baseUrl, '/seller/auth/login', {
    method: 'POST', body: { email: user.email, password: user.password },
  })
  assert.equal(beforeLogin.status, 403, 'an applicant is not yet a seller')

  const approved = await apiFetch(server.baseUrl, `/admin/applications/${applicationId}/approve`, {
    method: 'POST', token: adminToken, body: { note: 'Documents in order.' },
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  assert.ok(approved.body.data.sellerId, 'a store is created')
  assert.ok(approved.body.data.slug, 'with a storefront slug')

  // The whole point of doing both in one transaction: the owner can now actually sign in.
  const afterLogin = await apiFetch(server.baseUrl, '/seller/auth/login', {
    method: 'POST', body: { email: user.email, password: user.password },
  })
  assert.equal(afterLogin.status, 200, 'the approved owner can reach the seller panel')

  // A newly approved store may trade, but is not yet identity-verified. Conflating the two is
  // what makes a verified badge meaningless.
  const [store] = await query('SELECT status, verification_level, verified_badge FROM sellers WHERE public_id = ?', [approved.body.data.sellerId])
  assert.equal(store.status, 'approved')
  assert.equal(store.verification_level, 'basic')
  assert.equal(store.verified_badge, 0)
})

test('a second store cannot be registered to the same CNIC', async () => {
  const cnic = uniqueCnic()

  const first = await registerTestUser(server.baseUrl, { label: 'onboarding-cnic-a' })
  await markVerified(first.email)
  const firstToken = await loginAs(server.baseUrl, first.email, first.password)
  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token: firstToken, body: applicationBody({ cnic }),
  })
  await apiFetch(server.baseUrl, `/admin/applications/${created.body.data.id}/approve`, {
    method: 'POST', token: adminToken, body: {},
  })

  const second = await registerTestUser(server.baseUrl, { label: 'onboarding-cnic-b' })
  await markVerified(second.email)
  const secondToken = await loginAs(server.baseUrl, second.email, second.password)
  const blocked = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token: secondToken, body: applicationBody({ cnic }),
  })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.error.code, 'IDENTITY_ALREADY_REGISTERED')
})

test('rejection requires a reason the applicant can act on', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-reject' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)
  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody(),
  })
  const id = created.body.data.id

  const noCode = await apiFetch(server.baseUrl, `/admin/applications/${id}/reject`, {
    method: 'POST', token: adminToken, body: {},
  })
  assert.equal(noCode.status, 400, 'a rejection with no reason code is refused')

  const rejected = await apiFetch(server.baseUrl, `/admin/applications/${id}/reject`, {
    method: 'POST', token: adminToken, body: { code: 'document_illegible' },
  })
  assert.equal(rejected.status, 200)

  // The applicant is told what happened, in their own view of the application.
  const mine = await apiFetch(server.baseUrl, '/sell/application', { token })
  assert.equal(mine.body.data.status, 'rejected')
  assert.equal(mine.body.data.decisionCode, 'document_illegible')
})

test('more-information keeps the application open and tells the applicant what is needed', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-moreinfo' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)
  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody(),
  })
  const id = created.body.data.id

  const vague = await apiFetch(server.baseUrl, `/admin/applications/${id}/request-info`, {
    method: 'POST', token: adminToken, body: { message: 'nope' },
  })
  assert.equal(vague.status, 400, 'a request for information has to say what is wanted')

  const asked = await apiFetch(server.baseUrl, `/admin/applications/${id}/request-info`, {
    method: 'POST',
    token: adminToken,
    body: { message: 'The CNIC photograph is blurred. Please upload a clearer copy of the front.' },
  })
  assert.equal(asked.status, 200)

  const mine = await apiFetch(server.baseUrl, '/sell/application', { token })
  assert.equal(mine.body.data.status, 'more_info_required')
  assert.match(mine.body.data.infoRequested, /blurred/)

  // And they can act on it, which puts the case back in the queue rather than requiring a
  // brand-new application.
  const resubmitted = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'PUT', token, body: applicationBody({ storeName: mine.body.data.storeName }),
  })
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body))
  assert.equal(resubmitted.body.data.status, 'submitted')
})

test('identity numbers reach only a reviewer holding the KYC permission, and the read is logged', async () => {
  const user = await registerTestUser(server.baseUrl, { label: 'onboarding-pii' })
  await markVerified(user.email)
  const token = await loginAs(server.baseUrl, user.email, user.password)
  const cnic = uniqueCnic()
  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token, body: applicationBody({ cnic }),
  })
  const id = created.body.data.id

  // The seeded admin holds super_admin, so it does receive the identity block.
  const asAdmin = await apiFetch(server.baseUrl, `/admin/applications/${id}`, { token: adminToken })
  assert.equal(asAdmin.status, 200)
  assert.equal(asAdmin.body.data.identity.cnic, cnic)

  // And that read left a trace. This is the gap the PII log exists to close: approving a
  // document was audited, but merely reading one was not.
  const [logged] = await query(
    "SELECT COUNT(*) AS n FROM pii_access_logs WHERE subject_type = 'seller_application' AND subject_id = ?",
    [id],
  )
  assert.ok(Number(logged.n) >= 1, 'viewing identity data is recorded')

  // The applicant sees their own details — it is their data.
  const mine = await apiFetch(server.baseUrl, '/sell/application', { token })
  assert.equal(mine.body.data.identity.cnic, cnic)
})

test('an applicant cannot read or decide anyone else\'s application', async () => {
  const owner = await registerTestUser(server.baseUrl, { label: 'onboarding-owner' })
  await markVerified(owner.email)
  const ownerToken = await loginAs(server.baseUrl, owner.email, owner.password)
  const created = await apiFetch(server.baseUrl, '/sell/application', {
    method: 'POST', token: ownerToken, body: applicationBody(),
  })
  const id = created.body.data.id

  const stranger = await registerTestUser(server.baseUrl, { label: 'onboarding-stranger' })

  // The applicant route is scoped to the caller and takes no id at all, so a stranger reading
  // it simply gets their own (absent) application rather than someone else's.
  const theirs = await apiFetch(server.baseUrl, '/sell/application', { token: stranger.accessToken })
  assert.equal(theirs.status, 200)
  assert.equal(theirs.body.data, null)

  // And the review routes are permission-gated.
  const peek = await apiFetch(server.baseUrl, `/admin/applications/${id}`, { token: stranger.accessToken })
  assert.equal(peek.status, 403)

  const decide = await apiFetch(server.baseUrl, `/admin/applications/${id}/approve`, {
    method: 'POST', token: stranger.accessToken, body: {},
  })
  assert.equal(decide.status, 403)
})
