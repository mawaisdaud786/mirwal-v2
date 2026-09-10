import { query } from '../../db/pool.js'

/**
 * The PII access log.
 *
 * `audit_logs` records that a staff member approved or rejected a document. It never recorded
 * that one was *looked at* — and for a CNIC, a bank letter or a tax certificate, the read is
 * the event that matters. A reviewer who browses identity documents they have no case for
 * triggers no approve/reject entry at all, so before this table that access left no trace.
 *
 * Kept separate from `audit_logs` on purpose:
 *
 *   * it is high volume — one row per view, not one per decision;
 *   * it has its own retention policy, because holding a record of who looked at someone's
 *     identity document forever is its own privacy problem;
 *   * it is the table a regulator or an incident review asks for by name, and mixing it into
 *     a general activity feed makes that request answerable only by filtering.
 *
 * Like `recordAudit`, this never throws. The alternative is a failed log entry taking down
 * the document view it was describing, which helps nobody.
 */

/** Kinds of subject, so the caller cannot invent an unqueryable string. */
export const PII_SUBJECT = {
  SELLER_DOCUMENT: 'seller_document',
  SELLER_KYC: 'seller_kyc',
  BANK_ACCOUNT: 'bank_account',
  APPLICATION: 'seller_application',
  CUSTOMER_CONTACT: 'customer_contact',
  RETURN_EVIDENCE: 'return_evidence',
}

/**
 * Record one access to personal data.
 *
 * @param {object} req                the Express request, for actor, IP and request id
 * @param {object} entry
 * @param {string} entry.subjectType  one of PII_SUBJECT
 * @param {string} entry.subjectId    the public id of the thing read
 * @param {number} [entry.sellerId]   whose data it is, so "who looked at this seller" is one query
 * @param {'view'|'download'|'export'} [entry.action]
 * @param {string} [entry.reason]
 */
export async function recordPiiAccess(req, { subjectType, subjectId, sellerId = null, action = 'view', reason = null }) {
  try {
    const actorRole = req.user?.roles?.includes('super_admin') ? 'super_admin'
      : req.user?.roles?.includes('admin') ? 'admin'
        : req.user?.roles?.[0] ?? 'system'

    await query(
      `INSERT INTO pii_access_logs
         (actor_user_id, actor_role, subject_type, subject_id, seller_id, action, reason,
          ip_address, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, INET6_ATON(?), ?, NOW(3))`,
      [
        req.user?.id ?? null,
        actorRole,
        subjectType,
        String(subjectId).slice(0, 64),
        sellerId,
        action,
        reason ? String(reason).slice(0, 255) : null,
        req.ip ?? null,
        // Same reasoning as recordAudit: `req.id` may echo a caller-supplied header, so
        // anything that is not a plain 36-character id is recorded as absent rather than
        // risking a throw under STRICT_TRANS_TABLES that would silently cost us the row.
        typeof req.id === 'string' && req.id.length === 36 ? req.id : null,
      ],
    )
  } catch {
    // Deliberately swallowed — see the module comment.
  }
}

/**
 * Read the log.
 *
 * Gated by its own permission (`pii.audit.read`), not by the permission that grants access to
 * the documents themselves: the people who read identity documents should not be the people
 * who decide what the record of that reading says.
 */
export async function listPiiAccess({ page = 1, pageSize = 50, actorId, sellerId, subjectType, action } = {}) {
  const where = []
  const params = []
  if (actorId) { where.push('u.public_id = ?'); params.push(actorId) }
  if (sellerId) { where.push('s.public_id = ?'); params.push(sellerId) }
  if (subjectType) { where.push('l.subject_type = ?'); params.push(subjectType) }
  if (action) { where.push('l.action = ?'); params.push(action) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT l.subject_type, l.subject_id, l.action, l.reason, l.created_at,
            l.actor_role, INET6_NTOA(l.ip_address) AS ip,
            u.public_id AS actor_id, u.full_name AS actor_name, u.email AS actor_email,
            s.public_id AS seller_id, s.store_name
       FROM pii_access_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       LEFT JOIN sellers s ON s.id = l.seller_id
       ${clause}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM pii_access_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       LEFT JOIN sellers s ON s.id = l.seller_id
       ${clause}`,
    params,
  )

  return {
    items: rows.map((row) => ({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      action: row.action,
      reason: row.reason,
      actor: row.actor_id
        ? { id: row.actor_id, name: row.actor_name, email: row.actor_email, role: row.actor_role }
        : null,
      seller: row.seller_id ? { id: row.seller_id, storeName: row.store_name } : null,
      ip: row.ip,
      at: row.created_at,
    })),
    total: Number(total),
  }
}

/**
 * How often one staff member has read identity data recently.
 *
 * This is the actual detection signal the table exists for: not any single view, which is
 * usually legitimate, but a reviewer whose volume does not match their caseload.
 */
export async function piiAccessSummary({ days = 7 } = {}) {
  const rows = await query(
    `SELECT u.public_id, u.full_name, l.actor_role,
            COUNT(*) AS views,
            COUNT(DISTINCT l.seller_id) AS distinct_sellers,
            MAX(l.created_at) AS last_at
       FROM pii_access_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
      GROUP BY u.id, l.actor_role
      ORDER BY views DESC`,
    [days],
  )
  return rows.map((row) => ({
    actor: row.public_id ? { id: row.public_id, name: row.full_name, role: row.actor_role } : null,
    views: Number(row.views),
    distinctSellers: Number(row.distinct_sellers),
    lastAt: row.last_at,
  }))
}
