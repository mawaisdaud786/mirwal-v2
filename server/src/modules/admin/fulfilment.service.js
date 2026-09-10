import { query, queryOne } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'
import { notFound, badRequest, conflict } from '../../lib/errors.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * Admin views of returns, refunds and one dispute in detail.
 *
 * The three pages these back all said the same thing — that no returns or refunds system
 * existed. `return_requests` has existed since migration 005 and `refunds` since 008; the
 * seller portal has been approving returns against them the whole time. What was missing was
 * a platform-wide view and a place to settle the refunds that need a human.
 *
 * The one action here is settling a refund. Approving or rejecting a return still belongs to
 * the seller it was filed against — an admin overriding that quietly would leave the seller
 * with stock decisions made for them and no record of why.
 */

const PAGE_MAX = 200

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

const mapReturn = (row) => ({
  id: row.public_id,
  orderNumber: row.order_number,
  orderId: row.order_public_id,
  // Ids alongside the names: a return row is a question about a listing and about a buyer,
  // and both used to be dead strings.
  productId: row.product_public_id ?? null,
  productName: row.product_name,
  sku: row.sku,
  quantity: Number(row.quantity),
  amount: formatMoney(row.line_total, row.currency_code),
  reason: row.reason,
  description: row.description,
  status: row.status,
  resolutionNote: row.resolution_note,
  buyer: { id: row.buyer_public_id ?? null, name: row.buyer_name, email: row.buyer_email },
  seller: { id: row.seller_public_id, name: row.store_name },
  refund: row.refund_public_id
    ? {
      id: row.refund_public_id,
      status: row.refund_status,
      amount: formatMoney(row.refund_amount, row.currency_code),
      provider: row.refund_provider,
    }
    : null,
  requestedAt: row.created_at,
  resolvedAt: row.resolved_at,
})

const RETURN_SELECT = `
  SELECT r.public_id, r.reason, r.description, r.status, r.resolution_note,
         r.created_at, r.resolved_at,
         o.order_number, o.public_id AS order_public_id, o.currency_code,
         oi.product_name, oi.sku, oi.quantity, oi.line_total,
         prod.public_id AS product_public_id,
         buyer.public_id AS buyer_public_id, buyer.full_name AS buyer_name, buyer.email AS buyer_email,
         s.public_id AS seller_public_id, s.store_name,
         f.public_id AS refund_public_id, f.status AS refund_status,
         f.amount AS refund_amount, f.provider AS refund_provider
    FROM return_requests r
    JOIN order_items oi ON oi.id = r.order_item_id
    JOIN orders o       ON o.id = oi.order_id
    JOIN users buyer    ON buyer.id = r.buyer_id
    JOIN sellers s      ON s.id = r.seller_id
    -- LEFT, not JOIN: a deleted listing must not make its return vanish from the queue.
    LEFT JOIN products prod ON prod.id = oi.product_id
    LEFT JOIN refunds f ON f.return_request_id = r.id`

export async function listReturns({ page = 1, pageSize = 50, status } = {}) {
  const size = Math.min(pageSize, PAGE_MAX)
  const where = status ? 'WHERE r.status = ?' : ''
  const params = status ? [status] : []

  const rows = await query(
    `${RETURN_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size],
  )
  const { total } = await queryOne(
    `SELECT COUNT(*) AS total FROM return_requests r ${status ? 'WHERE r.status = ?' : ''}`,
    params,
  )
  const stats = await queryOne(
    `SELECT COUNT(*) AS total,
            SUM(status = 'requested') AS requested,
            SUM(status = 'approved')  AS approved,
            SUM(status = 'rejected')  AS rejected
       FROM return_requests`,
  )

  return {
    items: rows.map(mapReturn),
    total: Number(total),
    stats: {
      total: Number(stats.total),
      requested: Number(stats.requested ?? 0),
      approved: Number(stats.approved ?? 0),
      rejected: Number(stats.rejected ?? 0),
    },
  }
}

export async function getReturn(publicId) {
  const row = await queryOne(`${RETURN_SELECT} WHERE r.public_id = ?`, [publicId])
  if (!row) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  return mapReturn(row)
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

const mapRefund = (row) => ({
  id: row.public_id,
  orderNumber: row.order_number,
  orderId: row.order_public_id,
  amount: formatMoney(row.amount, row.currency_code),
  provider: row.provider,
  providerRef: row.provider_ref || null,
  status: row.status,
  failureReason: row.failure_reason || null,
  buyer: { id: row.buyer_public_id ?? null, name: row.buyer_name, email: row.buyer_email },
  returnId: row.return_public_id ?? null,
  settledBy: row.settled_by_name ?? null,
  settledAt: row.settled_at,
  createdAt: row.created_at,
})

const REFUND_SELECT = `
  SELECT f.public_id, f.amount, f.currency_code, f.provider, f.provider_ref, f.status,
         f.failure_reason, f.settled_at, f.created_at,
         o.order_number, o.public_id AS order_public_id,
         buyer.public_id AS buyer_public_id, buyer.full_name AS buyer_name, buyer.email AS buyer_email,
         r.public_id AS return_public_id,
         settler.full_name AS settled_by_name
    FROM refunds f
    JOIN orders o    ON o.id = f.order_id
    JOIN users buyer ON buyer.id = o.buyer_id
    LEFT JOIN return_requests r ON r.id = f.return_request_id
    LEFT JOIN users settler     ON settler.id = f.settled_by_user_id`

export async function listRefunds({ page = 1, pageSize = 50, status } = {}) {
  const size = Math.min(pageSize, PAGE_MAX)
  const where = status ? 'WHERE f.status = ?' : ''
  const params = status ? [status] : []

  const rows = await query(
    `${REFUND_SELECT} ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size],
  )
  const { total } = await queryOne(
    `SELECT COUNT(*) AS total FROM refunds f ${status ? 'WHERE f.status = ?' : ''}`,
    params,
  )
  const stats = await queryOne(
    `SELECT COUNT(*) AS total,
            SUM(status = 'pending')          AS pending,
            SUM(status = 'manual_required')  AS manual,
            SUM(status = 'succeeded')        AS succeeded,
            SUM(status = 'failed')           AS failed,
            COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END), 0) AS refunded,
            COALESCE(SUM(CASE WHEN status IN ('pending','manual_required') THEN amount ELSE 0 END), 0) AS outstanding
       FROM refunds`,
  )

  return {
    items: rows.map(mapRefund),
    total: Number(total),
    stats: {
      total: Number(stats.total),
      pending: Number(stats.pending ?? 0),
      // The queue that needs a person: a cash-on-delivery order cannot be reversed through a
      // provider, so someone has to send the money back and say so here.
      manualRequired: Number(stats.manual ?? 0),
      succeeded: Number(stats.succeeded ?? 0),
      failed: Number(stats.failed ?? 0),
      refunded: formatMoney(stats.refunded),
      outstanding: formatMoney(stats.outstanding),
    },
  }
}

export async function getRefund(publicId) {
  const row = await queryOne(`${REFUND_SELECT} WHERE f.public_id = ?`, [publicId])
  if (!row) throw notFound('Refund not found.', 'REFUND_NOT_FOUND')
  return mapRefund(row)
}

/**
 * Record that a manual refund has been paid, or that it could not be.
 *
 * Only `manual_required` refunds can be settled here. A refund the provider owns is settled
 * by the provider's webhook; letting an admin mark that one "succeeded" would put the
 * platform's record permanently out of step with the money, and nothing would ever correct it.
 */
export async function settleRefund(publicId, { status, reference, note }, userId) {
  const refund = await queryOne(
    `SELECT f.*, o.order_number, o.buyer_id, u.email AS buyer_email, u.full_name AS buyer_name
       FROM refunds f
       JOIN orders o ON o.id = f.order_id
       JOIN users u  ON u.id = o.buyer_id
      WHERE f.public_id = ?`,
    [publicId],
  )
  if (!refund) throw notFound('Refund not found.', 'REFUND_NOT_FOUND')

  if (refund.status !== 'manual_required') {
    throw conflict(
      refund.status === 'succeeded'
        ? 'That refund has already been settled.'
        : 'Only refunds marked "needs manual action" can be settled here — the payment provider settles the rest.',
      'REFUND_NOT_MANUAL',
    )
  }
  if (status === 'failed' && !note?.trim()) {
    throw badRequest('Say why the refund could not be paid, so the buyer can be told.', 'REASON_REQUIRED')
  }

  await query(
    `UPDATE refunds
        SET status = ?, provider_ref = ?, failure_reason = ?,
            settled_by_user_id = ?, settled_at = NOW(3)
      WHERE id = ?`,
    [status, reference?.trim() ?? '', status === 'failed' ? note.trim().slice(0, 255) : '', userId ?? null, refund.id],
  )

  if (status === 'succeeded') {
    // Never throws; a mail outage must not roll back a refund that has actually been paid.
    messaging.sendInBackground('order.refunded', {
      channel: 'email',
      to: refund.buyer_email,
      variables: {
        name: refund.buyer_name,
        orderNumber: refund.order_number,
        amount: formatMoney(refund.amount, refund.currency_code),
        reference: reference?.trim() || 'not provided',
      },
    })
  }

  return getRefund(publicId)
}

// ---------------------------------------------------------------------------
// Dispute detail
// ---------------------------------------------------------------------------

/**
 * One dispute in full: the return, the order line it came from, the refund it caused, and
 * every other return the same buyer has filed.
 *
 * That last part is the reason this page is worth having. A single return tells you nothing;
 * a buyer's fifth return this month tells you what to look at.
 */
export async function getDispute(publicId) {
  const request = await getReturn(publicId)

  const history = await query(
    `SELECT r.public_id, r.status, r.reason, r.created_at, oi.product_name
       FROM return_requests r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN users buyer    ON buyer.id = r.buyer_id
      WHERE buyer.email = ? AND r.public_id <> ?
      ORDER BY r.created_at DESC LIMIT 20`,
    [request.buyer.email, publicId],
  )

  const order = await queryOne(
    `SELECT o.public_id, o.order_number, o.status, o.payment_status, o.payment_method,
            o.total, o.currency_code, o.created_at,
            o.shipping_city, o.shipping_region
       FROM orders o WHERE o.public_id = ?`,
    [request.orderId],
  )

  return {
    ...request,
    order: order && {
      id: order.public_id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      total: formatMoney(order.total, order.currency_code),
      placedAt: order.created_at,
      destination: [order.shipping_city, order.shipping_region].filter(Boolean).join(', '),
    },
    buyerHistory: history.map((row) => ({
      id: row.public_id,
      productName: row.product_name,
      reason: row.reason,
      status: row.status,
      requestedAt: row.created_at,
    })),
  }
}
