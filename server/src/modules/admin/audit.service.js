import { query } from '../../db/pool.js'
import { parseJsonColumn } from '../../lib/json.js'

/**
 * Audit logging.
 *
 * The `audit_logs` table has existed since migration 001 but nothing ever wrote to it, so the
 * admin panel's audit view had nothing to show. Every state-changing admin action now records
 * one row here — who did it, to what, and what changed.
 *
 * Two deliberate properties:
 *
 *   - Writing an audit row must never break the operation it describes. A failed insert is
 *     swallowed and reported to the log rather than thrown: losing an audit row is bad, but
 *     rolling back an approval the admin already saw succeed is worse, and this is called
 *     after the operation's own transaction has committed.
 *   - `metadata` records the *change*, not the whole entity. Storing full rows here would
 *     quietly duplicate customer PII into a table with a much longer retention life.
 */

/** Actions are `<entity>.<verb>` so the admin UI can filter by either half. */
export const AUDIT = {
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  PRODUCT_APPROVED: 'product.approved',
  PRODUCT_REJECTED: 'product.rejected',
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  CATEGORY_DELETED: 'category.deleted',
  BRAND_CREATED: 'brand.created',
  BRAND_UPDATED: 'brand.updated',
  BRAND_DELETED: 'brand.deleted',
  INVENTORY_UPDATED: 'inventory.updated',
  SELLER_APPROVED: 'seller.approved',
  SELLER_REJECTED: 'seller.rejected',
  SELLER_SUSPENDED: 'seller.suspended',
  SELLER_REINSTATED: 'seller.reinstated',
  REVIEW_DELETED: 'review.deleted',
  COUPON_CREATED: 'coupon.created',
  COUPON_UPDATED: 'coupon.updated',
  COUPON_DELETED: 'coupon.deleted',
  PROMOTION_CREATED: 'promotion.created',
  PROMOTION_UPDATED: 'promotion.updated',
  PROMOTION_DELETED: 'promotion.deleted',
  BANNER_CREATED: 'banner.created',
  BANNER_UPDATED: 'banner.updated',
  BANNER_DELETED: 'banner.deleted',
  PAYOUT_APPROVED: 'payout.approved',
  PAYOUT_PAID: 'payout.paid',
  PAYOUT_REJECTED: 'payout.rejected',
  PAYOUT_UPDATED: 'payout.updated',
  SETTINGS_UPDATED: 'settings.updated',
  INTEGRATION_UPDATED: 'integration.updated',
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_UPDATED: 'webhook.updated',
  WEBHOOK_DELETED: 'webhook.deleted',
  WEBHOOK_SECRET_ROTATED: 'webhook.secret_rotated',
  ROLE_PERMISSIONS_UPDATED: 'role.permissions_updated',
  TICKET_UPDATED: 'ticket.updated',
  SESSION_REVOKED: 'session.revoked',
  ACCOUNT_SUSPENDED: 'account.suspended',
  ACCOUNT_RESTORED: 'account.restored',
  REPORT_RESOLVED: 'report.resolved',
  TEAM_CREATED: 'team.created',
  TEAM_DELETED: 'team.deleted',
  TEAM_MEMBERSHIP_CHANGED: 'team.membership_changed',
  ATTRIBUTE_CREATED: 'attribute.created',
  ATTRIBUTE_DELETED: 'attribute.deleted',
  TEMPLATE_UPDATED: 'template.updated',
  TEST_MESSAGE_SENT: 'message.test_sent',
  DOCUMENT_APPROVED: 'document.approved',
  DOCUMENT_REJECTED: 'document.rejected',
  ZONE_CREATED: 'shipping.zone_created',
  ZONE_UPDATED: 'shipping.zone_updated',
  ZONE_DELETED: 'shipping.zone_deleted',
  METHOD_CREATED: 'shipping.method_created',
  METHOD_UPDATED: 'shipping.method_updated',
  METHOD_DELETED: 'shipping.method_deleted',
  WAREHOUSE_CREATED: 'warehouse.created',
  WAREHOUSE_UPDATED: 'warehouse.updated',
  WAREHOUSE_DELETED: 'warehouse.deleted',
  MAINTENANCE_TOGGLED: 'maintenance.toggled',
  BACKUP_CREATED: 'backup.created',
  BACKUP_DELETED: 'backup.deleted',
  BACKUP_DOWNLOADED: 'backup.downloaded',
  TWO_FACTOR_ENABLED: 'security.two_factor_enabled',
  TWO_FACTOR_DISABLED: 'security.two_factor_disabled',
  REFUND_SETTLED: 'refund.settled',
  RETURN_RESOLVED: 'return.resolved',

  // Seller onboarding and KYC (migration 020).
  APPLICATION_CLAIMED: 'application.claimed',
  APPLICATION_INFO_REQUESTED: 'application.info_requested',
  APPLICATION_APPROVED: 'application.approved',
  APPLICATION_REJECTED: 'application.rejected',
  BANK_ACCOUNT_ADDED: 'bank_account.added',
  BANK_ACCOUNT_VERIFIED: 'bank_account.verified',
  BANK_ACCOUNT_REJECTED: 'bank_account.rejected',
  // A seller changing their payout destination is the primary account-takeover cash-out
  // path, so it is an audited event in its own right rather than a store-profile edit.
  BANK_ACCOUNT_CHANGED: 'bank_account.changed',
  DOCUMENT_VIEWED: 'document.viewed',
  SELLER_RESTRICTED: 'seller.restricted',
  SELLER_BANNED: 'seller.banned',
  SELLER_PAYOUT_HELD: 'seller.payout_held',
  SELLER_PAYOUT_RELEASED: 'seller.payout_released',
  SELLER_BADGE_GRANTED: 'seller.badge_granted',
  SELLER_BADGE_REVOKED: 'seller.badge_revoked',
  STORE_UPDATED: 'store.updated',

  // Fulfilment (migration 021).
  SHIPMENT_CREATED: 'shipment.created',
  SHIPMENT_UPDATED: 'shipment.updated',
  LEDGER_ADJUSTED: 'ledger.adjusted',
  PAYOUT_HELD: 'payout.held',

  // Trust and safety (migration 022).
  CASE_ASSIGNED: 'case.assigned',
  CASE_ACTIONED: 'case.actioned',
  CASE_RESOLVED: 'case.resolved',
  REVIEW_MODERATED: 'review.moderated',
  RETURN_OVERRIDDEN: 'return.overridden',
  BRAND_AUTHORIZED: 'brand.authorized',
  BRAND_AUTHORIZATION_REVOKED: 'brand.authorization_revoked',
}

/**
 * Record one admin action.
 *
 * @param {object} req     the request, for the actor, request id and IP
 * @param {object} entry
 * @param {string} entry.action      one of AUDIT
 * @param {string} entry.entityType  'product' | 'category' | 'seller' | ...
 * @param {string|number} entry.entityId
 * @param {object} [entry.metadata]  what changed — keep it small and PII-free
 */
export async function recordAudit(req, { action, entityType, entityId, metadata }) {
  try {
    // The most privileged role the actor holds, so the log reads "super_admin did X" rather
    // than listing every role they happen to have.
    const actorRole = req.user?.roles?.includes('super_admin') ? 'super_admin'
      : req.user?.roles?.includes('admin') ? 'admin'
        : req.user?.roles?.[0] ?? 'system'

    await query(
      `INSERT INTO audit_logs
         (actor_user_id, actor_role, action, entity_type, entity_id, metadata, ip_address, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, INET6_ATON(?), ?, NOW(3))`,
      [
        req.user?.id ?? null,
        actorRole,
        action,
        entityType,
        entityId == null ? null : String(entityId),
        metadata ? JSON.stringify(metadata) : null,
        // INET6_ATON returns NULL for a malformed address rather than erroring, and the
        // column is nullable, so an unusual proxy value degrades to "no IP" not a failure.
        req.ip ?? null,
        // `req.id` echoes a caller-supplied X-Request-Id when one is sent, so it is not
        // trusted to fit char(36): an over-long header would make this INSERT throw under
        // STRICT_TRANS_TABLES and (because failures here are swallowed) silently cost us the
        // audit row. Anything that is not a plain 36-character id is recorded as absent.
        /^[A-Za-z0-9-]{36}$/.test(req.id ?? '') ? req.id : null,
      ],
    )
  } catch (error) {
    // Deliberately swallowed — see the note above.
    console.error('[audit] failed to record %s on %s#%s: %s', action, entityType, entityId, error.message)
  }
}

/**
 * Read the audit trail, newest first.
 *
 * Filters are all optional and combine with AND. `entityType`/`action` are matched exactly
 * rather than by LIKE so an index can be used and a caller cannot turn this into a scan.
 */
export async function listAuditLogs({ page = 1, pageSize = 50, action, entityType, actorUserId, from, to } = {}) {
  const where = []
  const params = []

  if (action) { where.push('a.action = ?'); params.push(action) }
  if (entityType) { where.push('a.entity_type = ?'); params.push(entityType) }
  if (actorUserId) { where.push('a.actor_user_id = ?'); params.push(actorUserId) }
  if (from) { where.push('a.created_at >= ?'); params.push(from) }
  if (to) { where.push('a.created_at <= ?'); params.push(to) }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (page - 1) * pageSize

  const rows = await query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
            a.actor_role, a.request_id,
            INET6_NTOA(a.ip_address) AS ip_address,
            u.public_id AS actor_public_id, u.full_name AS actor_name, u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${clause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM audit_logs a ${clause}`,
    params,
  )

  return {
    items: rows.map((row) => ({
      id: String(row.id),
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: parseJsonColumn(row.metadata),
      actor: row.actor_public_id
        ? { id: row.actor_public_id, name: row.actor_name, email: row.actor_email, role: row.actor_role }
        : { id: null, name: 'System', email: null, role: row.actor_role },
      ipAddress: row.ip_address,
      requestId: row.request_id,
      createdAt: row.created_at,
    })),
    total: Number(total),
  }
}

/** The distinct actions and entity types present, so the UI can build real filter dropdowns. */
export async function getAuditFilters() {
  const [actions, entityTypes] = await Promise.all([
    query('SELECT DISTINCT action FROM audit_logs ORDER BY action'),
    query('SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type'),
  ])
  return {
    actions: actions.map((row) => row.action),
    entityTypes: entityTypes.map((row) => row.entity_type),
  }
}
