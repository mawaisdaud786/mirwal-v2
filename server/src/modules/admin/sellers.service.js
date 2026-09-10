import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * Admin seller management — the seller lifecycle the `sellers.status` enum already modelled
 * but nothing drove: pending → approved | rejected, and approved ⇄ suspended.
 *
 * The state machine is enforced here rather than left to the caller. Without it the UI could
 * "approve" an already-rejected store or suspend a pending application, both of which leave
 * `approved_at`/`suspended_reason` describing a history that never happened.
 *
 * Approving a seller is also what grants the `seller` role — see `approveSeller`. That is the
 * single point where a person gains the ability to sign in to seller.mirwal.pk, so it is a
 * transaction and it is audited by the caller.
 */

/** Which transitions are legal from each status. */
const TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['suspended', 'closed'],
  suspended: ['approved', 'closed'],
  rejected: ['approved'],
  closed: [],
}

function assertTransition(from, to) {
  if (from === to) throw conflict(`This store is already ${to}.`, 'NO_STATUS_CHANGE')
  if (!TRANSITIONS[from]?.includes(to)) {
    throw conflict(`A ${from} store cannot be moved to ${to}.`, 'INVALID_STATUS_TRANSITION')
  }
}

function shapeSeller(row) {
  return {
    id: row.public_id,
    slug: row.slug,
    storeName: row.store_name,
    legalName: row.legal_name,
    description: row.description,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    supportEmail: row.support_email,
    supportPhone: row.support_phone,
    city: row.city,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    status: row.status,
    suspendedReason: row.suspended_reason,
    approvedAt: row.approved_at,
    rating: { average: Number(row.rating_average), count: row.rating_count },
    productCount: Number(row.product_count),
    owner: row.owner_public_id
      ? { id: row.owner_public_id, name: row.owner_name, email: row.owner_email }
      : null,
    approvedBy: row.approver_name ?? null,
    createdAt: row.created_at,
  }
}

const SELLER_SELECT = `
  SELECT s.id, s.public_id, s.slug, s.store_name, s.legal_name, s.description,
         s.logo_url, s.banner_url, s.support_email, s.support_phone, s.city,
         s.country_code, s.currency_code, s.status, s.suspended_reason,
         s.approved_at, s.rating_average, s.rating_count, s.product_count, s.created_at,
         u.public_id AS owner_public_id, u.full_name AS owner_name, u.email AS owner_email,
         a.full_name AS approver_name
    FROM sellers s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users a ON a.id = s.approved_by`

/**
 * List stores. `status: 'pending'` is the seller-applications queue — the same data, filtered,
 * rather than a separate table, because an application *is* a store awaiting a decision.
 */
export async function listSellers({ page = 1, pageSize = 25, status, search, sort = 'newest' } = {}) {
  const where = ['s.deleted_at IS NULL']
  const params = []
  if (status) { where.push('s.status = ?'); params.push(status) }
  if (search) {
    where.push('(s.store_name LIKE ? OR s.legal_name LIKE ? OR u.email LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const ORDER = {
    newest: 's.created_at DESC',
    oldest: 's.created_at ASC',
    name: 's.store_name ASC',
    products: 's.product_count DESC',
    rating: 's.rating_average DESC',
  }
  const clause = `WHERE ${where.join(' AND ')}`
  const offset = (page - 1) * pageSize

  const rows = await query(
    `${SELLER_SELECT} ${clause} ORDER BY ${ORDER[sort] ?? ORDER.newest} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM sellers s JOIN users u ON u.id = s.user_id ${clause}`,
    params,
  )
  return { items: rows.map(shapeSeller), total: Number(total) }
}

export async function getSellerStatusCounts() {
  const rows = await query(
    'SELECT status, COUNT(*) AS count FROM sellers WHERE deleted_at IS NULL GROUP BY status',
  )
  const counts = { pending: 0, approved: 0, suspended: 0, rejected: 0, closed: 0 }
  for (const row of rows) counts[row.status] = Number(row.count)
  counts.all = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return counts
}

/** One store, with the trading summary an admin needs before making a decision about it. */
export async function getSeller(publicId) {
  const row = await queryOne(`${SELLER_SELECT} WHERE s.public_id = ? AND s.deleted_at IS NULL`, [publicId])
  if (!row) throw notFound('Seller not found.')

  const [stats] = await query(
    `SELECT COUNT(DISTINCT oi.order_id) AS order_count,
            COALESCE(SUM(oi.line_total), 0) AS gross_revenue,
            COUNT(*) AS item_count
       FROM order_items oi
      WHERE oi.seller_id = ? AND oi.status NOT IN ('cancelled')`,
    [row.id],
  )
  const [products] = await query(
    `SELECT
       SUM(status = 'active') AS active,
       SUM(status = 'pending_review') AS pending,
       SUM(status = 'draft') AS draft,
       SUM(status = 'rejected') AS rejected
     FROM products WHERE seller_id = ? AND deleted_at IS NULL`,
    [row.id],
  )

  return {
    ...shapeSeller(row),
    stats: {
      orderCount: Number(stats.order_count),
      itemCount: Number(stats.item_count),
      grossRevenue: formatMoney(stats.gross_revenue, row.currency_code),
      products: {
        active: Number(products.active ?? 0),
        pendingReview: Number(products.pending ?? 0),
        draft: Number(products.draft ?? 0),
        rejected: Number(products.rejected ?? 0),
      },
    },
  }
}

/** Look up the seller role id once; it is seeded by migration 001 and never changes. */
async function sellerRoleId() {
  const role = await queryOne("SELECT id FROM roles WHERE slug = 'seller'")
  if (!role) throw badRequest('The seller role is missing from this database.', 'ROLE_MISSING')
  return role.id
}

/**
 * Approve a pending (or previously rejected) application.
 *
 * Grants the `seller` role in the same transaction as the status change: the two must not be
 * able to disagree, or the store shows as approved while its owner is refused at
 * seller.mirwal.pk's login — which checks for the role *and* an approved store.
 */
export async function approveSeller(publicId, adminUserId) {
  const seller = await queryOne(
    `SELECT s.id, s.user_id, s.status, s.store_name, u.full_name AS owner_name, u.email AS owner_email
       FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.public_id = ? AND s.deleted_at IS NULL`,
    [publicId],
  )
  if (!seller) throw notFound('Seller not found.')
  assertTransition(seller.status, 'approved')

  const roleId = await sellerRoleId()
  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE sellers
          SET status = 'approved', approved_at = NOW(3), approved_by = ?,
              suspended_reason = NULL, updated_at = NOW(3)
        WHERE id = ?`,
      [adminUserId, seller.id],
    )
    // IGNORE rather than a pre-check: re-approving a previously suspended seller who still
    // holds the role must not fail on the unique key.
    await connection.execute(
      'INSERT IGNORE INTO user_roles (user_id, role_id, granted_by, created_at) VALUES (?, ?, ?, NOW(3))',
      [seller.user_id, roleId, adminUserId],
    )
  })

  // Tell them. An approval the applicant never hears about leaves them waiting on a decision
  // that has already been made. send() never throws, so mail trouble cannot undo the approval.
  messaging.sendInBackground('seller.approved', {
    to: seller.owner_email,
    userId: seller.user_id,
    variables: { sellerName: seller.owner_name, storeName: seller.store_name },
  })

  return { storeName: seller.store_name, previousStatus: seller.status }
}

/** Reject a pending application. The reason is shown to the applicant, so it is required. */
export async function rejectSeller(publicId, reason) {
  const seller = await queryOne(
    `SELECT s.id, s.user_id, s.status, s.store_name, u.full_name AS owner_name, u.email AS owner_email
       FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.public_id = ? AND s.deleted_at IS NULL`,
    [publicId],
  )
  if (!seller) throw notFound('Seller not found.')
  assertTransition(seller.status, 'rejected')
  if (!reason) throw badRequest('A rejection reason is required.', 'REASON_REQUIRED')

  await query(
    `UPDATE sellers SET status = 'rejected', suspended_reason = ?, updated_at = NOW(3) WHERE id = ?`,
    [reason, seller.id],
  )

  messaging.sendInBackground('seller.rejected', {
    to: seller.owner_email,
    userId: seller.user_id,
    variables: { sellerName: seller.owner_name, storeName: seller.store_name, reason },
  })

  return { storeName: seller.store_name, previousStatus: seller.status }
}

/**
 * Suspend a trading store.
 *
 * Their products are pulled from the storefront in the same transaction. Leaving them active
 * would let a suspended store keep taking orders it is not allowed to fulfil — the archived
 * status is reversible, so reinstating restores them.
 */
export async function suspendSeller(publicId, reason) {
  const seller = await queryOne(
    'SELECT id, status, store_name FROM sellers WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!seller) throw notFound('Seller not found.')
  assertTransition(seller.status, 'suspended')
  if (!reason) throw badRequest('A suspension reason is required.', 'REASON_REQUIRED')

  const affected = await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE sellers SET status = 'suspended', suspended_reason = ?, updated_at = NOW(3) WHERE id = ?`,
      [reason, seller.id],
    )
    const [result] = await connection.execute(
      `UPDATE products SET status = 'archived', updated_at = NOW(3)
        WHERE seller_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [seller.id],
    )
    return result.affectedRows
  })
  return { storeName: seller.store_name, previousStatus: seller.status, productsArchived: affected }
}

/** Lift a suspension and restore the products this suspension archived. */
export async function reinstateSeller(publicId, adminUserId) {
  const seller = await queryOne(
    'SELECT id, status, store_name FROM sellers WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!seller) throw notFound('Seller not found.')
  assertTransition(seller.status, 'approved')

  const affected = await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE sellers
          SET status = 'approved', suspended_reason = NULL,
              approved_at = COALESCE(approved_at, NOW(3)), approved_by = COALESCE(approved_by, ?),
              updated_at = NOW(3)
        WHERE id = ?`,
      [adminUserId, seller.id],
    )
    const [result] = await connection.execute(
      `UPDATE products SET status = 'active', updated_at = NOW(3)
        WHERE seller_id = ? AND status = 'archived' AND deleted_at IS NULL`,
      [seller.id],
    )
    return result.affectedRows
  })
  return { storeName: seller.store_name, previousStatus: seller.status, productsRestored: affected }
}
