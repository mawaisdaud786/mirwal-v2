import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { getNumericSetting, getSetting } from '../settings/settings.service.js'
import { createNotification } from '../notifications/notifications.service.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * Becoming a seller on Mirwal.
 *
 * Before this module there was no path at all: `INSERT INTO sellers` existed once, in the
 * database seeder, so the admin "Applications" and "Verification" queues reviewed a list that
 * production could never populate, and the storefront's application form was a submit handler
 * that set a boolean.
 *
 * Two decisions shape everything here.
 *
 * **An application is not a store.** A `sellers` row is created only when an application is
 * approved. If the two were the same row, a rejected applicant would leave a half-built
 * storefront behind, re-applying would overwrite the record of why the first attempt was
 * refused, and "how many applications did we reject last month" would have no answer.
 *
 * **What is required depends on who is applying, and when.** A hobby seller in Lahore should
 * not be asked for a certificate of incorporation, and nobody should be asked for an IBAN
 * before they have anything to be paid for. Requirements are therefore split three ways:
 * always required, required for this seller type, and deferred until the thing it gates is
 * actually reached. Bank details are the clearest case — demanding them at signup is the
 * single largest drop-off point in Pakistani seller onboarding and buys nothing, because
 * nobody is owed money yet.
 */

// Statuses an applicant may still act on. Everything else is closed.
const LIVE_STATUSES = ['draft', 'submitted', 'in_review', 'more_info_required']

/** What a reviewer may move an application to, from where. */
const TRANSITIONS = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['in_review', 'more_info_required', 'approved', 'rejected'],
  in_review: ['more_info_required', 'approved', 'rejected'],
  more_info_required: ['submitted', 'in_review', 'approved', 'rejected', 'expired'],
  approved: [],
  rejected: [],
  withdrawn: [],
  expired: [],
}

/**
 * Reason codes a reviewer picks from.
 *
 * A free-text-only rejection is the largest single source of seller support tickets, because
 * the applicant cannot tell what to fix. A code also makes "why do we reject applications"
 * answerable without reading prose.
 */
export const DECISION_CODES = {
  document_illegible: 'The documents supplied could not be read clearly.',
  document_mismatch: 'The details supplied do not match the documents.',
  document_expired: 'A supplied document has expired.',
  identity_unverified: 'Identity could not be confirmed.',
  duplicate_account: 'This person or business already has a Mirwal store.',
  prohibited_category: 'The goods described cannot be sold on Mirwal.',
  incomplete: 'Required information is missing.',
  suspected_fraud: 'The application was refused following a risk review.',
  other: 'See the reviewer note.',
}

const CNIC_PATTERN = /^\d{13}$/
const NTN_PATTERN = /^[0-9-]{7,20}$/

function shapeApplication(row, { includePii = false } = {}) {
  const base = {
    id: row.public_id,
    reference: row.reference,
    status: row.status,
    sellerType: row.seller_type,
    storeName: row.store_name,
    legalName: row.legal_name,
    businessType: row.business_type,
    city: row.city,
    province: row.province,
    categories: row.categories,
    website: row.website,
    notes: row.notes,
    decisionCode: row.decision_code,
    decisionNote: row.decision_note,
    infoRequested: row.info_requested,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    applicant: {
      name: row.applicant_name,
      // Contact details are not PII-gated: a reviewer has to be able to contact an applicant,
      // and these are the details the applicant volunteered for exactly that purpose.
      email: row.applicant_email,
      phone: row.applicant_phone,
    },
    reviewedBy: row.reviewer_name ?? null,
    sellerId: row.seller_public_id ?? null,
  }

  // Identity numbers are returned only to a caller holding `seller.kyc.view`, and every such
  // read is written to the PII access log by the controller.
  if (!includePii) return base
  return {
    ...base,
    identity: {
      cnic: row.cnic,
      dateOfBirth: row.date_of_birth,
      ntn: row.ntn,
      strn: row.strn,
      businessRegNo: row.business_reg_no,
    },
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      province: row.province,
      postalCode: row.postal_code,
      countryCode: row.country_code,
    },
    agreement: { version: row.agreement_version, acceptedAt: row.agreed_at },
  }
}

const APPLICATION_SELECT = `
  SELECT a.*, u.full_name AS user_name, u.email AS user_email,
         r.full_name AS reviewer_name, s.public_id AS seller_public_id
    FROM seller_applications a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN users r ON r.id = a.reviewed_by
    LEFT JOIN sellers s ON s.id = a.seller_id`

// ---------------------------------------------------------------------------
// Applicant side
// ---------------------------------------------------------------------------

/**
 * What this account must do before it can apply.
 *
 * Returned to the storefront so the form can show a checklist rather than rejecting a
 * completed submission at the last step, which is how applicants are lost.
 */
export async function getApplicationRequirements(userId) {
  const user = await queryOne(
    'SELECT email, phone, email_verified_at, phone_verified_at FROM users WHERE id = ?',
    [userId],
  )
  if (!user) throw notFound('Account not found.')

  const needEmail = Boolean(await getSetting('sellers.require_email_verification', true))
  const needPhone = Boolean(await getSetting('sellers.require_phone_verification', true))

  const existing = await queryOne(
    `SELECT public_id, status FROM seller_applications
      WHERE user_id = ? AND status IN (${LIVE_STATUSES.map(() => '?').join(',')})`,
    [userId, ...LIVE_STATUSES],
  )
  const store = await queryOne('SELECT public_id, status FROM sellers WHERE user_id = ? AND deleted_at IS NULL', [userId])

  return {
    steps: [
      { key: 'email', label: 'Confirm your email address', required: needEmail, done: Boolean(user.email_verified_at) },
      { key: 'phone', label: 'Confirm your mobile number', required: needPhone, done: Boolean(user.phone_verified_at) },
      { key: 'application', label: 'Complete the application form', required: true, done: Boolean(existing) },
    ],
    canApply: (!needEmail || Boolean(user.email_verified_at))
      && (!needPhone || Boolean(user.phone_verified_at))
      && !store,
    hasApplication: Boolean(existing),
    applicationStatus: existing?.status ?? null,
    hasStore: Boolean(store),
    agreementVersion: await getSetting('sellers.agreement_version', '1.0'),
  }
}

/**
 * Submit an application.
 *
 * Verification of email and phone is checked here rather than trusted from the form, because
 * an unverified applicant is one Mirwal cannot contact about the decision — and an
 * application nobody can be told the outcome of is worse than no application.
 */
export async function submitApplication(userId, input, { ip = null, userAgent = '' } = {}) {
  const requirements = await getApplicationRequirements(userId)
  if (requirements.hasStore) {
    throw conflict('This account already has a Mirwal store.', 'SELLER_ALREADY_EXISTS')
  }
  if (requirements.hasApplication) {
    throw conflict(
      'You already have an application in progress. Update that one instead of starting again.',
      'APPLICATION_IN_PROGRESS',
    )
  }
  const blocked = requirements.steps.filter((step) => step.required && !step.done && step.key !== 'application')
  if (blocked.length) {
    throw badRequest(
      `Please complete: ${blocked.map((step) => step.label).join(', ')}.`,
      'VERIFICATION_REQUIRED',
      blocked.map((step) => ({ field: step.key, message: step.label })),
    )
  }

  assertTypeRequirements(input)
  await assertIdentityNotAlreadyUsed(input)

  const expiryDays = await getNumericSetting('sellers.application_expiry_days', { fallback: 30, max: 365 })
  const agreementVersion = await getSetting('sellers.agreement_version', '1.0')
  const publicId = randomUUID()

  const id = await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO seller_applications
         (public_id, reference, user_id, seller_type,
          applicant_name, applicant_email, applicant_phone, cnic, date_of_birth,
          store_name, legal_name, business_type, business_reg_no, ntn, strn,
          address_line1, address_line2, city, province, postal_code, country_code,
          categories, website, notes, heard_from,
          agreement_version, status, submitted_at, expires_at,
          submitted_ip, submitted_user_agent)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'submitted', NOW(3), DATE_ADD(NOW(3), INTERVAL ? DAY), INET6_ATON(?), ?)`,
      [
        publicId, userId, input.sellerType,
        input.applicantName, input.applicantEmail, input.applicantPhone,
        input.cnic ?? null, input.dateOfBirth ?? null,
        input.storeName, input.legalName ?? '', input.businessType ?? null,
        input.businessRegNo ?? null, input.ntn ?? null, input.strn ?? null,
        input.addressLine1, input.addressLine2 ?? '', input.city, input.province,
        input.postalCode ?? '', input.countryCode ?? 'PK',
        input.categories ?? '', input.website ?? '', input.notes ?? '', input.heardFrom ?? '',
        agreementVersion, expiryDays, ip, String(userAgent).slice(0, 255),
      ],
    )
    // Human-facing reference, assigned from the id for the same reason order numbers are:
    // it must be stable, quotable and not guessable as a count of anything sensitive.
    await connection.execute(
      "UPDATE seller_applications SET reference = CONCAT('MW-A-', LPAD(?, 6, '0')) WHERE id = ?",
      [result.insertId, result.insertId],
    )
    return result.insertId
  })

  await createNotification(userId, {
    type: 'seller_application_submitted',
    title: 'Application received',
    body: 'Mirwal is reviewing your seller application. We will email you when there is a decision.',
    link: '/sell-with-mirwal/status',
  })
  messaging.sendInBackground('seller.application_received', {
    to: input.applicantEmail,
    userId,
    variables: { sellerName: input.applicantName, storeName: input.storeName },
  })

  const row = await queryOne(`${APPLICATION_SELECT} WHERE a.id = ?`, [id])
  return shapeApplication(row)
}

/**
 * Field rules that depend on the seller type.
 *
 * Deliberately narrow. Every field demanded from an individual seller who does not need it is
 * an applicant lost for no gain, so the individual path asks for identity and nothing else,
 * and the business path asks only for what a registered business genuinely has.
 */
function assertTypeRequirements(input) {
  const problems = []

  if (input.sellerType === 'individual') {
    if (!input.cnic) problems.push({ field: 'cnic', message: 'A CNIC number is required for an individual seller.' })
    if (!input.dateOfBirth) problems.push({ field: 'dateOfBirth', message: 'Date of birth is required.' })
  }

  if (input.sellerType === 'business') {
    if (!input.legalName) problems.push({ field: 'legalName', message: 'The registered business name is required.' })
    if (!input.businessType) problems.push({ field: 'businessType', message: 'Select the type of business.' })
    if (!input.ntn) problems.push({ field: 'ntn', message: 'An NTN is required for a registered business.' })
    // The owner is still a person, and Mirwal still has to know who they are.
    if (!input.cnic) problems.push({ field: 'cnic', message: "The owner's CNIC is required." })
    // A private limited company has a registration number; a sole proprietor may not.
    if (input.businessType === 'private_limited' && !input.businessRegNo) {
      problems.push({ field: 'businessRegNo', message: 'A company registration number is required for a private limited company.' })
    }
  }

  if (input.cnic && !CNIC_PATTERN.test(input.cnic)) {
    problems.push({ field: 'cnic', message: 'A CNIC is 13 digits, without dashes.' })
  }
  if (input.ntn && !NTN_PATTERN.test(input.ntn)) {
    problems.push({ field: 'ntn', message: 'That does not look like a valid NTN.' })
  }
  if (input.dateOfBirth) {
    const age = (Date.now() - new Date(input.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000)
    if (!Number.isFinite(age)) problems.push({ field: 'dateOfBirth', message: 'Enter a valid date of birth.' })
    else if (age < 18) problems.push({ field: 'dateOfBirth', message: 'Sellers must be 18 or older.' })
  }

  if (problems.length) throw badRequest('Some details are missing.', 'VALIDATION_FAILED', problems)
}

/**
 * Refuse an identity that already belongs to a store.
 *
 * The database enforces this too (`uq_sellers_cnic`, `uq_sellers_ntn`), which is what actually
 * wins the race. This check exists so the applicant gets a comprehensible message instead of a
 * constraint violation, and so a second *application* is caught before a reviewer wastes time
 * on it.
 */
async function assertIdentityNotAlreadyUsed(input) {
  if (input.cnic) {
    const existing = await queryOne(
      'SELECT store_name FROM sellers WHERE cnic = ? AND deleted_at IS NULL',
      [input.cnic],
    )
    if (existing) {
      throw conflict(
        'A Mirwal store is already registered to this CNIC. Contact support if you believe this is wrong.',
        'IDENTITY_ALREADY_REGISTERED',
      )
    }
  }
  if (input.ntn) {
    const existing = await queryOne(
      'SELECT store_name FROM sellers WHERE ntn = ? AND deleted_at IS NULL',
      [input.ntn],
    )
    if (existing) {
      throw conflict(
        'A Mirwal store is already registered to this NTN. Contact support if you believe this is wrong.',
        'IDENTITY_ALREADY_REGISTERED',
      )
    }
  }
}

/** The applicant's own view of their application. */
export async function getMyApplication(userId) {
  const row = await queryOne(
    `${APPLICATION_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 1`,
    [userId],
  )
  if (!row) return null
  // The applicant sees their own identity details — it is their data.
  return shapeApplication(row, { includePii: true })
}

/**
 * Supply the information a reviewer asked for.
 *
 * Only from `more_info_required`, and it moves the application back into the queue. An
 * applicant editing a submission that is actively being reviewed would change the thing under
 * the reviewer's hands.
 */
export async function resubmitApplication(userId, input) {
  const row = await queryOne(
    'SELECT id, status, applicant_email, applicant_name FROM seller_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId],
  )
  if (!row) throw notFound('You have no application to update.')
  if (row.status !== 'more_info_required') {
    throw conflict(
      row.status === 'submitted' || row.status === 'in_review'
        ? 'Your application is being reviewed. You will hear from us shortly.'
        : `An application that is ${row.status} cannot be updated.`,
      'APPLICATION_NOT_EDITABLE',
    )
  }

  assertTypeRequirements(input)
  await assertIdentityNotAlreadyUsed(input)

  await query(
    `UPDATE seller_applications
        SET seller_type = ?, applicant_name = ?, applicant_phone = ?,
            cnic = ?, date_of_birth = ?,
            store_name = ?, legal_name = ?, business_type = ?, business_reg_no = ?, ntn = ?, strn = ?,
            address_line1 = ?, address_line2 = ?, city = ?, province = ?, postal_code = ?,
            categories = ?, website = ?, notes = ?,
            status = 'submitted', submitted_at = NOW(3),
            info_requested = NULL, decision_code = NULL, decision_note = NULL,
            updated_at = NOW(3)
      WHERE id = ?`,
    [
      input.sellerType, input.applicantName, input.applicantPhone,
      input.cnic ?? null, input.dateOfBirth ?? null,
      input.storeName, input.legalName ?? '', input.businessType ?? null,
      input.businessRegNo ?? null, input.ntn ?? null, input.strn ?? null,
      input.addressLine1, input.addressLine2 ?? '', input.city, input.province, input.postalCode ?? '',
      input.categories ?? '', input.website ?? '', input.notes ?? '',
      row.id,
    ],
  )
  return { status: 'submitted' }
}

/** Withdraw. Frees the applicant to start again, and clears the reviewer's queue honestly. */
export async function withdrawApplication(userId) {
  const row = await queryOne(
    'SELECT id, status FROM seller_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId],
  )
  if (!row) throw notFound('You have no application to withdraw.')
  if (!LIVE_STATUSES.includes(row.status)) {
    throw conflict(`An application that is ${row.status} cannot be withdrawn.`, 'APPLICATION_CLOSED')
  }
  await query("UPDATE seller_applications SET status = 'withdrawn', updated_at = NOW(3) WHERE id = ?", [row.id])
  return { status: 'withdrawn' }
}

// ---------------------------------------------------------------------------
// Reviewer side
// ---------------------------------------------------------------------------

export async function listApplications({ page = 1, pageSize = 25, status, search, sellerType } = {}) {
  const where = []
  const params = []
  if (status) { where.push('a.status = ?'); params.push(status) }
  if (sellerType) { where.push('a.seller_type = ?'); params.push(sellerType) }
  if (search) {
    where.push('(a.store_name LIKE ? OR a.applicant_name LIKE ? OR a.applicant_email LIKE ? OR a.reference LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    // Oldest submission first within the queue: the only ordering an SLA can be measured
    // against. A newest-first queue quietly starves the applications that have waited longest.
    `${APPLICATION_SELECT} ${clause}
      ORDER BY FIELD(a.status,'submitted','in_review','more_info_required','approved','rejected','withdrawn','expired'),
               a.submitted_at ASC, a.id ASC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM seller_applications a ${clause}`,
    params,
  )

  return { items: rows.map((row) => shapeApplication(row)), total: Number(total) }
}

/** Queue counts, for the operations dashboard and the sidebar badge. */
export async function applicationStatusCounts() {
  const rows = await query(
    `SELECT status, COUNT(*) AS n,
            SUM(submitted_at IS NOT NULL
                AND submitted_at < DATE_SUB(NOW(3), INTERVAL 2 DAY)) AS overdue
       FROM seller_applications GROUP BY status`,
  )
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]))
  const overdue = rows
    .filter((row) => ['submitted', 'in_review'].includes(row.status))
    .reduce((sum, row) => sum + Number(row.overdue ?? 0), 0)
  return { ...counts, waiting: (counts.submitted ?? 0) + (counts.in_review ?? 0), overdue }
}

/**
 * One application, with identity details.
 *
 * `includePii` is decided by the caller's permission, not by this function — and the caller is
 * also responsible for writing the PII access log entry. Splitting it that way keeps the
 * decision about who may see a CNIC in the route layer where it is reviewable.
 */
export async function getApplication(publicId, { includePii = false } = {}) {
  const row = await queryOne(`${APPLICATION_SELECT} WHERE a.public_id = ?`, [publicId])
  if (!row) throw notFound('Application not found.')

  const documents = await query(
    `SELECT public_id, doc_type, status, original_name, uploaded_at, expires_at, review_note
       FROM seller_documents
      WHERE seller_id IS NOT NULL AND deleted_at IS NULL
        AND seller_id = (SELECT seller_id FROM seller_applications WHERE public_id = ?)
      ORDER BY uploaded_at DESC`,
    [publicId],
  )

  return {
    ...shapeApplication(row, { includePii }),
    documents: documents.map((doc) => ({
      id: doc.public_id,
      type: doc.doc_type,
      status: doc.status,
      name: doc.original_name,
      uploadedAt: doc.uploaded_at,
      expiresAt: doc.expires_at,
      note: doc.review_note,
    })),
  }
}

/** Claim an application for review, so two agents do not work the same case. */
export async function claimApplication(publicId, reviewerId) {
  const row = await queryOne('SELECT id, status, reviewed_by FROM seller_applications WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Application not found.')
  if (row.status !== 'submitted' && row.status !== 'in_review') {
    throw conflict(`An application that is ${row.status} is not in the review queue.`, 'APPLICATION_NOT_REVIEWABLE')
  }
  if (row.reviewed_by && row.reviewed_by !== reviewerId && row.status === 'in_review') {
    throw conflict('Another reviewer is already working on this application.', 'APPLICATION_CLAIMED')
  }
  await query(
    "UPDATE seller_applications SET status = 'in_review', reviewed_by = ?, updated_at = NOW(3) WHERE id = ?",
    [reviewerId, row.id],
  )
  return { status: 'in_review' }
}

/**
 * Ask the applicant for something specific.
 *
 * `infoRequested` is shown to them verbatim, which is why it is required: "more information
 * needed" with no statement of what is needed is the worst possible outcome for both sides —
 * the applicant cannot act and the reviewer sees the same incomplete case again.
 */
export async function requestMoreInformation(publicId, { message, code }, reviewerId) {
  const row = await loadForDecision(publicId, 'more_info_required')
  if (!message) throw badRequest('Say what the applicant needs to supply.', 'MESSAGE_REQUIRED')

  const expiryDays = await getNumericSetting('sellers.application_expiry_days', { fallback: 30, max: 365 })
  await query(
    `UPDATE seller_applications
        SET status = 'more_info_required', info_requested = ?, decision_code = ?,
            reviewed_by = ?, reviewed_at = NOW(3),
            expires_at = DATE_ADD(NOW(3), INTERVAL ? DAY), updated_at = NOW(3)
      WHERE id = ?`,
    [message, code ?? null, reviewerId, expiryDays, row.id],
  )

  await createNotification(row.user_id, {
    type: 'seller_application_info_required',
    title: 'More information needed',
    body: message.slice(0, 480),
    link: '/sell-with-mirwal/status',
  })
  messaging.sendInBackground('seller.application_more_info', {
    to: row.applicant_email,
    userId: row.user_id,
    variables: { sellerName: row.applicant_name, storeName: row.store_name, message },
  })

  return { status: 'more_info_required' }
}

/**
 * Approve, and create the store.
 *
 * The `sellers` row, the seller role grant and the application's own status all change in one
 * transaction. If any could land without the others, the outcome is a store whose owner
 * cannot sign in, or an approved application with no store behind it — both of which are
 * support tickets that require a developer to resolve.
 *
 * The new store starts `approved` but with `verification_level = 'basic'`: they may trade,
 * and the verified badge is a separate, later grant that depends on documents actually being
 * checked. Conflating "allowed to sell" with "identity confirmed" is what makes a verification
 * badge meaningless.
 */
export async function approveApplication(publicId, reviewerId, { note } = {}) {
  const row = await loadForDecision(publicId, 'approved')

  const sellerRole = await queryOne("SELECT id FROM roles WHERE slug = 'seller'")
  if (!sellerRole) throw badRequest('The seller role is missing from this database.', 'ROLE_MISSING')

  const slug = await uniqueStoreSlug(row.store_name)
  const sellerPublicId = randomUUID()

  await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO sellers
         (public_id, user_id, seller_type, verification_level, slug, store_name, legal_name,
          cnic, date_of_birth, ntn, strn, business_reg_no, business_type,
          support_email, support_phone,
          city, address_line1, address_line2, province, postal_code, country_code,
          status, applied_at, approved_at, approved_by)
       VALUES (?, ?, ?, 'basic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'approved', ?, NOW(3), ?)`,
      [
        sellerPublicId, row.user_id, row.seller_type, slug, row.store_name, row.legal_name,
        row.cnic, row.date_of_birth, row.ntn, row.strn, row.business_reg_no, row.business_type,
        row.applicant_email, row.applicant_phone,
        row.city, row.address_line1, row.address_line2, row.province, row.postal_code, row.country_code,
        row.submitted_at, reviewerId,
      ],
    )
    // IGNORE rather than a pre-check, matching approveSeller: a user who somehow already holds
    // the role must not make the approval fail on the unique key.
    await connection.execute(
      'INSERT IGNORE INTO user_roles (user_id, role_id, granted_by, created_at) VALUES (?, ?, ?, NOW(3))',
      [row.user_id, sellerRole.id, reviewerId],
    )
    await connection.execute(
      `UPDATE seller_applications
          SET status = 'approved', seller_id = ?, decision_note = ?,
              reviewed_by = ?, reviewed_at = NOW(3), updated_at = NOW(3)
        WHERE id = ?`,
      [result.insertId, note ?? null, reviewerId, row.id],
    )
  })

  await createNotification(row.user_id, {
    type: 'seller_application_approved',
    title: 'Your Mirwal store is live',
    body: `${row.store_name} has been approved. Sign in to the seller panel to add your first product.`,
    link: '/sell-with-mirwal/status',
  })
  messaging.sendInBackground('seller.approved', {
    to: row.applicant_email,
    userId: row.user_id,
    variables: { sellerName: row.applicant_name, storeName: row.store_name },
  })

  return { status: 'approved', sellerId: sellerPublicId, storeName: row.store_name, slug }
}

/** Reject. A reason code is required so the applicant is told what actually happened. */
export async function rejectApplication(publicId, { code, note }, reviewerId) {
  const row = await loadForDecision(publicId, 'rejected')
  if (!code || !DECISION_CODES[code]) {
    throw badRequest('Choose a rejection reason.', 'DECISION_CODE_REQUIRED', [
      { field: 'code', message: `One of: ${Object.keys(DECISION_CODES).join(', ')}` },
    ])
  }
  if (code === 'other' && !note) {
    throw badRequest('A note is required when the reason is "other".', 'NOTE_REQUIRED')
  }

  await query(
    `UPDATE seller_applications
        SET status = 'rejected', decision_code = ?, decision_note = ?,
            reviewed_by = ?, reviewed_at = NOW(3), updated_at = NOW(3)
      WHERE id = ?`,
    [code, note ?? null, reviewerId, row.id],
  )

  const reason = note || DECISION_CODES[code]
  await createNotification(row.user_id, {
    type: 'seller_application_rejected',
    title: 'Your seller application was not approved',
    body: reason.slice(0, 480),
    link: '/sell-with-mirwal/status',
  })
  messaging.sendInBackground('seller.rejected', {
    to: row.applicant_email,
    userId: row.user_id,
    variables: { sellerName: row.applicant_name, storeName: row.store_name, reason },
  })

  return { status: 'rejected', code }
}

async function loadForDecision(publicId, target) {
  const row = await queryOne('SELECT * FROM seller_applications WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Application not found.')
  if (!TRANSITIONS[row.status]?.includes(target)) {
    throw conflict(
      `An application that is ${row.status} cannot be moved to ${target}.`,
      'INVALID_STATUS_TRANSITION',
    )
  }
  return row
}

/**
 * A storefront slug that is free.
 *
 * `uq_sellers_slug` is the real guarantee; this only avoids handing a reviewer a constraint
 * error for a store name that happens to collide. Two shops legitimately called "Al Madina
 * Traders" is an ordinary situation, not an error.
 */
async function uniqueStoreSlug(storeName) {
  const base = String(storeName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'store'

  const taken = await query('SELECT slug FROM sellers WHERE slug = ? OR slug LIKE ?', [base, `${base}-%`])
  if (!taken.some((row) => row.slug === base)) return base

  const used = new Set(taken.map((row) => row.slug))
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/**
 * Expire applications that have sat unanswered.
 *
 * Run from the maintenance sweep. Without it `more_info_required` is a queue leak: those
 * applications stay "live" forever, block the applicant from starting again because of the
 * one-live-application rule, and inflate every backlog figure an operator looks at.
 */
export async function expireStaleApplications() {
  const result = await query(
    `UPDATE seller_applications
        SET status = 'expired', updated_at = NOW(3)
      WHERE status = 'more_info_required'
        AND expires_at IS NOT NULL AND expires_at < NOW(3)`,
  )
  return { expired: result.affectedRows ?? 0 }
}

export { LIVE_STATUSES }
