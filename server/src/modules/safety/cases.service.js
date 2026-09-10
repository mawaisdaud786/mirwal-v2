import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { createNotification } from '../notifications/notifications.service.js'

/**
 * Reports, complaints and disputes.
 *
 * These are one object, not three. Someone says something is wrong; a human decides; an action
 * follows. What differs is only what the complaint points at — a listing, a store, a review, an
 * order, a payment. Six near-identical report tables would mean six queues, six SLAs, and six
 * places to forget to write an audit row.
 *
 * Before this module the only thing that could be reported was a product, and upholding that
 * report did nothing at all: no takedown, no warning, no record, no reply to the reporter.
 * There was no way to report a seller, a store, a review or a delivery, and "Disputes" in the
 * admin panel was a read-only SELECT over return requests where the seller was judge and jury
 * on complaints filed against themselves.
 *
 * Two rules run through everything here:
 *
 *   * **Anonymous reports are accepted.** A shopper who has not signed in can still be looking
 *     at a counterfeit, and refusing their report loses the signal. This mirrors what
 *     `product_reports` already decided.
 *
 *   * **A case never resolves itself.** Every closing transition names a person and a reason
 *     code. An automatically-closed case is a complaint nobody answered.
 */

/**
 * How long each priority has before it is overdue.
 *
 * Counterfeit and fraud default to `high` at creation (see `derivePriority`), because those
 * are the reports where a day's delay means more buyers receive the goods.
 */
const SLA_HOURS = { urgent: 4, high: 24, normal: 72, low: 168 }

const OPEN_STATUSES = ['reported', 'under_review', 'more_info_required']

const TRANSITIONS = {
  reported: ['under_review', 'more_info_required', 'rejected', 'action_taken', 'resolved'],
  under_review: ['more_info_required', 'action_taken', 'resolved', 'rejected'],
  more_info_required: ['under_review', 'action_taken', 'resolved', 'rejected'],
  action_taken: ['resolved', 'appealed'],
  resolved: ['appealed'],
  rejected: ['appealed'],
  appealed: ['under_review', 'resolved', 'rejected'],
  closed: [],
}

/** What a reporter may choose, per subject. Keeps the taxonomy reportable on. */
export const REASON_CODES = {
  product: ['counterfeit', 'prohibited', 'misleading', 'wrong_category', 'wrong_price', 'offensive', 'stolen_images', 'other'],
  seller: ['counterfeit', 'non_delivery', 'abusive', 'off_platform', 'fake_store', 'other'],
  store: ['impersonation', 'misleading', 'offensive', 'other'],
  review: ['spam', 'offensive', 'fake', 'personal_information', 'competitor', 'other'],
  order: ['never_arrived', 'wrong_item', 'damaged', 'incomplete', 'not_as_described', 'other'],
  payment: ['charged_twice', 'not_refunded', 'wrong_amount', 'unauthorised', 'other'],
  fraud: ['scam', 'phishing', 'stolen_card', 'other'],
  counterfeit: ['counterfeit', 'other'],
  policy: ['other'],
  other: ['other'],
}

function derivePriority(caseType, reasonCode) {
  // These reach more buyers with every hour they sit unread.
  if (caseType === 'counterfeit' || caseType === 'fraud') return 'high'
  if (reasonCode === 'counterfeit' || reasonCode === 'prohibited' || reasonCode === 'unauthorised') return 'high'
  if (caseType === 'payment') return 'high'
  return 'normal'
}

function shapeCase(row, { staff = false } = {}) {
  return {
    id: row.public_id,
    reference: row.reference,
    type: row.case_type,
    subject: { type: row.subject_type, id: row.subject_id, summary: row.subject_summary },
    reasonCode: row.reason_code,
    details: row.details,
    status: row.status,
    priority: row.priority,
    slaDueAt: row.sla_due_at,
    overdue: row.sla_due_at ? new Date(`${row.sla_due_at}Z`) < new Date() && OPEN_STATUSES.includes(row.status) : false,
    resolution: row.resolution_code
      ? { code: row.resolution_code, note: row.resolution_note, at: row.resolved_at }
      : null,
    messageCount: Number(row.message_count ?? 0),
    evidenceCount: Number(row.evidence_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // A reporter's identity is staff-only. Showing it to the seller being reported is how a
    // reporting system becomes a retaliation system.
    ...(staff
      ? {
        reporter: row.reporter_name
          ? { name: row.reporter_name, email: row.reporter_email }
          : { name: 'Anonymous', email: row.reporter_email ?? null },
        against: row.store_name ? { id: row.seller_public_id, storeName: row.store_name } : null,
        assignedTo: row.assignee_name ?? null,
      }
      : {}),
  }
}

const CASE_SELECT = `
  SELECT c.*, u.full_name AS reporter_name, u.email AS reporter_email,
         a.full_name AS assignee_name,
         s.public_id AS seller_public_id, s.store_name
    FROM cases c
    LEFT JOIN users u ON u.id = c.reporter_id
    LEFT JOIN users a ON a.id = c.assigned_to
    LEFT JOIN sellers s ON s.id = c.against_seller_id`

/**
 * Resolve what is being reported into a seller, an order and a human-readable summary.
 *
 * `against_seller_id` is denormalised here rather than joined later so that "everything ever
 * filed against this store" — the query the enforcement view and the risk score both run — is
 * one indexed read instead of a union across whichever subject tables happen to apply.
 */
async function resolveSubject(caseType, subjectType, subjectId) {
  if (!subjectId) return { sellerId: null, orderId: null, summary: '' }

  if (subjectType === 'product') {
    const row = await queryOne(
      'SELECT p.name, p.seller_id FROM products p WHERE p.public_id = ? OR p.slug = ?',
      [subjectId, subjectId],
    )
    if (!row) throw notFound('That product could not be found.')
    return { sellerId: row.seller_id, orderId: null, summary: row.name }
  }
  if (subjectType === 'seller' || subjectType === 'store') {
    const row = await queryOne('SELECT id, store_name FROM sellers WHERE public_id = ? OR slug = ?', [subjectId, subjectId])
    if (!row) throw notFound('That store could not be found.')
    return { sellerId: row.id, orderId: null, summary: row.store_name }
  }
  if (subjectType === 'review') {
    const row = await queryOne(
      `SELECT r.id, p.name, p.seller_id FROM product_reviews r
         JOIN products p ON p.id = r.product_id WHERE r.public_id = ?`,
      [subjectId],
    )
    if (!row) throw notFound('That review could not be found.')
    return { sellerId: row.seller_id, orderId: null, summary: `Review on ${row.name}` }
  }
  if (subjectType === 'order') {
    const row = await queryOne('SELECT id, order_number FROM orders WHERE public_id = ?', [subjectId])
    if (!row) throw notFound('That order could not be found.')
    return { sellerId: null, orderId: row.id, summary: row.order_number }
  }
  return { sellerId: null, orderId: null, summary: '' }
}

/**
 * File a case.
 *
 * `uq_cases_open_once` stops the same person filing the same complaint repeatedly against one
 * subject while it is still open — re-submitting must not inflate a report count into a false
 * signal that many people complained. A closed case does not block a genuine new report months
 * later, which is why the constraint is on a generated column rather than the raw columns.
 */
export async function createCase({
  caseType, subjectType, subjectId, reasonCode, details,
  reporterId = null, reporterEmail = null, reporterSide = 'buyer', orderId = null,
}) {
  const allowed = REASON_CODES[caseType] ?? REASON_CODES.other
  if (reasonCode && !allowed.includes(reasonCode)) {
    throw badRequest(`"${reasonCode}" is not a reason for a ${caseType} report.`, 'INVALID_REASON_CODE')
  }

  const subject = await resolveSubject(caseType, subjectType, subjectId)
  const priority = derivePriority(caseType, reasonCode)
  const publicId = randomUUID()

  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO cases
           (public_id, reference, case_type, subject_type, subject_id, subject_summary,
            against_seller_id, order_id, reporter_id, reporter_email, reporter_side,
            reason_code, details, priority, sla_due_at)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 DATE_ADD(NOW(3), INTERVAL ? HOUR))`,
        [
          publicId, caseType, subjectType, subjectId ?? null, subject.summary,
          subject.sellerId, orderId ?? subject.orderId, reporterId, reporterEmail, reporterSide,
          reasonCode ?? null, details ?? '', priority, SLA_HOURS[priority],
        ],
      )
      await connection.execute(
        "UPDATE cases SET reference = CONCAT('MW-C-', LPAD(?, 6, '0')) WHERE id = ?",
        [result.insertId, result.insertId],
      )
      return result.insertId
    })

    // Acknowledge, so a reporter knows the report landed. A report that vanishes silently is
    // one the person never files again.
    if (reporterId) {
      await createNotification(reporterId, {
        type: 'case_received',
        title: 'Thank you — Mirwal is reviewing your report',
        body: 'We will let you know the outcome. Reports help keep Mirwal safe for everyone.',
        link: '/my-reports',
      })
    }

    const row = await queryOne(`${CASE_SELECT} WHERE c.id = ?`, [id])
    return shapeCase(row)
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      throw conflict(
        'You have already reported this, and we are still looking into it.',
        'ALREADY_REPORTED',
      )
    }
    throw error
  }
}

/** A reporter's own cases. */
export async function listMine(userId, { page = 1, pageSize = 25 } = {}) {
  const rows = await query(
    `${CASE_SELECT} WHERE c.reporter_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM cases WHERE reporter_id = ?', [userId])
  return { items: rows.map((row) => shapeCase(row)), total: Number(total) }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function listCases({ page = 1, pageSize = 25, status, caseType, priority, assignedToMe, userId, overdue, sellerId } = {}) {
  const where = []
  const params = []
  if (status) { where.push('c.status = ?'); params.push(status) }
  else { where.push(`c.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`); params.push(...OPEN_STATUSES) }
  if (caseType) { where.push('c.case_type = ?'); params.push(caseType) }
  if (priority) { where.push('c.priority = ?'); params.push(priority) }
  if (assignedToMe && userId) { where.push('c.assigned_to = ?'); params.push(userId) }
  if (overdue) where.push('c.sla_due_at < NOW(3)')
  if (sellerId) { where.push('s.public_id = ?'); params.push(sellerId) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    // Most urgent first, then most overdue. An arrival-ordered safety queue starves exactly
    // the reports that matter most.
    `${CASE_SELECT} ${clause}
      ORDER BY FIELD(c.priority,'urgent','high','normal','low'), c.sla_due_at ASC, c.id ASC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM cases c LEFT JOIN sellers s ON s.id = c.against_seller_id ${clause}`,
    params,
  )
  return { items: rows.map((row) => shapeCase(row, { staff: true })), total: Number(total) }
}

/** Queue health, for the operations dashboard. */
export async function caseStats() {
  const rows = await query(
    `SELECT status, priority, COUNT(*) AS n,
            SUM(sla_due_at < NOW(3)) AS overdue
       FROM cases GROUP BY status, priority`,
  )
  const open = rows.filter((row) => OPEN_STATUSES.includes(row.status))
  return {
    open: open.reduce((sum, row) => sum + Number(row.n), 0),
    overdue: open.reduce((sum, row) => sum + Number(row.overdue ?? 0), 0),
    urgent: open.filter((row) => row.priority === 'urgent').reduce((sum, row) => sum + Number(row.n), 0),
    high: open.filter((row) => row.priority === 'high').reduce((sum, row) => sum + Number(row.n), 0),
    byStatus: Object.fromEntries(
      Object.entries(
        rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + Number(row.n) }), {}),
      ),
    ),
  }
}

export async function getCase(publicId) {
  const row = await queryOne(`${CASE_SELECT} WHERE c.public_id = ?`, [publicId])
  if (!row) throw notFound('Case not found.')

  const messages = await query(
    `SELECT m.body, m.author_side, m.is_internal, m.created_at, u.full_name AS author_name
       FROM case_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.case_id = ? ORDER BY m.created_at`,
    [row.id],
  )
  const evidence = await query(
    `SELECT public_id, original_name, mime_type, size_bytes, caption, uploader_side, uploaded_at
       FROM case_evidence WHERE case_id = ? AND deleted_at IS NULL ORDER BY uploaded_at`,
    [row.id],
  )
  const actions = await query(
    `SELECT public_id, action_type, severity, reason_code, reason_note, expires_at, lifted_at, created_at
       FROM seller_enforcement_actions WHERE case_id = ? ORDER BY created_at`,
    [row.id],
  )

  return {
    ...shapeCase(row, { staff: true }),
    messages: messages.map((message) => ({
      body: message.body,
      side: message.author_side,
      author: message.author_name,
      internal: Boolean(message.is_internal),
      at: message.created_at,
    })),
    evidence: evidence.map((file) => ({
      id: file.public_id,
      name: file.original_name,
      mimeType: file.mime_type,
      size: Number(file.size_bytes),
      caption: file.caption,
      side: file.uploader_side,
      at: file.uploaded_at,
    })),
    actions: actions.map((action) => ({
      id: action.public_id,
      type: action.action_type,
      severity: action.severity,
      reasonCode: action.reason_code,
      note: action.reason_note,
      expiresAt: action.expires_at,
      liftedAt: action.lifted_at,
      at: action.created_at,
    })),
  }
}

/** Claim a case, so two agents do not work the same complaint. */
export async function assignCase(publicId, userId) {
  const row = await queryOne('SELECT id, status, assigned_to FROM cases WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Case not found.')
  if (!OPEN_STATUSES.includes(row.status)) {
    throw conflict(`A case that is ${row.status} is not in the queue.`, 'CASE_NOT_OPEN')
  }
  await query(
    `UPDATE cases SET assigned_to = ?, status = CASE WHEN status = 'reported' THEN 'under_review' ELSE status END,
                      updated_at = NOW(3)
      WHERE id = ?`,
    [userId, row.id],
  )
  return { status: 'under_review' }
}

/** Add a message. Internal notes are never returned on a reporter's read path. */
export async function addMessage(publicId, { body, isInternal }, { userId, side }) {
  const row = await queryOne('SELECT id, status, reporter_id FROM cases WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Case not found.')

  // Only staff may write an internal note. Without this check the flag is client-supplied and
  // a reporter could hide their own message from the person handling it.
  const internal = side === 'staff' ? Boolean(isInternal) : false

  await withTransaction(async (connection) => {
    await connection.execute(
      'INSERT INTO case_messages (case_id, author_id, author_side, body, is_internal) VALUES (?, ?, ?, ?, ?)',
      [row.id, userId, side, body, internal ? 1 : 0],
    )
    await connection.execute(
      `UPDATE cases SET last_message_at = NOW(3),
                        message_count = (SELECT COUNT(*) FROM case_messages WHERE case_id = ? AND is_internal = 0),
                        updated_at = NOW(3)
        WHERE id = ?`,
      [row.id, row.id],
    )
  })

  if (side === 'staff' && !internal && row.reporter_id) {
    await createNotification(row.reporter_id, {
      type: 'case_reply',
      title: 'Mirwal replied to your report',
      body: String(body).slice(0, 200),
      link: '/my-reports',
    })
  }
  return { added: true }
}

/**
 * Close a case.
 *
 * A resolution code is required, always. "Resolved" with no statement of what was decided is
 * indistinguishable from a case someone closed to clear their queue, and it makes an appeal
 * impossible because there is nothing to appeal against.
 */
export async function resolveCase(publicId, { status, resolutionCode, note }, userId) {
  const row = await queryOne('SELECT id, status, reporter_id, reference FROM cases WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Case not found.')
  if (!TRANSITIONS[row.status]?.includes(status)) {
    throw conflict(`A case that is ${row.status} cannot be moved to ${status}.`, 'INVALID_STATUS_TRANSITION')
  }
  if (!resolutionCode) {
    throw badRequest('Choose what was decided.', 'RESOLUTION_CODE_REQUIRED')
  }

  await query(
    `UPDATE cases
        SET status = ?, resolution_code = ?, resolution_note = ?,
            resolved_by = ?, resolved_at = NOW(3), updated_at = NOW(3)
      WHERE id = ?`,
    [status, resolutionCode, note ?? null, userId, row.id],
  )

  // Close the loop with the reporter. A report whose outcome is never communicated teaches
  // people that reporting is pointless, which is how a marketplace goes blind.
  if (row.reporter_id) {
    await createNotification(row.reporter_id, {
      type: 'case_resolved',
      title: status === 'rejected'
        ? 'We reviewed your report'
        : 'We have acted on your report',
      body: note
        ? String(note).slice(0, 400)
        : status === 'rejected'
          ? 'We looked into this and did not find a breach of our policies. Thank you for telling us.'
          : 'Thank you for reporting this — we have taken action.',
      link: '/my-reports',
    })
  }

  return { status, reference: row.reference }
}

/** Cases filed against one store, for the seller detail view and the risk score. */
export async function listAgainstSeller(sellerId, { limit = 50 } = {}) {
  const rows = await query(
    `${CASE_SELECT} WHERE c.against_seller_id = ? ORDER BY c.created_at DESC LIMIT ?`,
    [sellerId, limit],
  )
  return rows.map((row) => shapeCase(row, { staff: true }))
}

export { OPEN_STATUSES, SLA_HOURS }
