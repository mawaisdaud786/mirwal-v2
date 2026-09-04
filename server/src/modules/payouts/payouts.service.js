import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'

/**
 * Seller payouts.
 *
 * This records that Mirwal intends to pay, and later did pay, a seller. It deliberately does
 * NOT move money — there is no bank integration behind it. The transfer happens outside the
 * system and is recorded here against an external reference. Building something that looked
 * like automated disbursement would be worse than the honest not-connected page this replaces.
 *
 * The important invariant is that an order item is paid out at most once, ever. That is
 * enforced by a unique key on `payout_items.order_item_id` rather than by the assembling
 * query being careful — a bug in the query then fails loudly instead of double-paying.
 *
 * Status flow: requested → approved → processing → paid, with rejected/failed as terminal
 * branches. Transitions are checked here so a payout cannot be marked paid without having
 * been approved.
 */

const TRANSITIONS = {
  requested: ['approved', 'rejected'],
  approved: ['processing', 'paid', 'rejected'],
  processing: ['paid', 'failed'],
  paid: [],
  rejected: [],
  failed: ['processing', 'rejected'],
}

/** Commission Mirwal retains, in basis points. Read from settings, with a documented default. */
const DEFAULT_COMMISSION_BPS = 1000 // 10%

async function commissionBps() {
  const row = await queryOne("SELECT value_json FROM platform_settings WHERE `key` = 'finance.commission_bps'")
  if (!row) return DEFAULT_COMMISSION_BPS
  const parsed = typeof row.value_json === 'object' ? row.value_json : JSON.parse(row.value_json)
  const value = Number(parsed?.v)
  return Number.isFinite(value) && value >= 0 && value <= 10000 ? value : DEFAULT_COMMISSION_BPS
}

function shapePayout(row) {
  return {
    id: row.public_id,
    reference: row.reference,
    status: row.status,
    grossAmount: formatMoney(row.gross_amount, row.currency_code),
    commissionAmount: formatMoney(row.commission_amount, row.currency_code),
    netAmount: formatMoney(row.net_amount, row.currency_code),
    method: row.method,
    destinationHint: row.destination_hint,
    externalReference: row.external_reference,
    failureReason: row.failure_reason,
    notes: row.notes,
    itemCount: row.item_count == null ? undefined : Number(row.item_count),
    seller: row.seller_slug ? { slug: row.seller_slug, name: row.seller_store_name } : null,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
    approvedBy: row.approver_name ?? null,
  }
}

const PAYOUT_SELECT = `
  SELECT p.id, p.public_id, p.reference, p.seller_id, p.status,
         p.gross_amount, p.commission_amount, p.net_amount, p.currency_code,
         p.method, p.destination_hint, p.external_reference, p.failure_reason, p.notes,
         p.requested_at, p.approved_at, p.paid_at,
         s.slug AS seller_slug, s.store_name AS seller_store_name,
         a.full_name AS approver_name,
         (SELECT COUNT(*) FROM payout_items pi WHERE pi.payout_id = p.id) AS item_count
    FROM payouts p
    JOIN sellers s ON s.id = p.seller_id
    LEFT JOIN users a ON a.id = p.approved_by`

export async function listPayouts(scope, { page = 1, pageSize = 25, status } = {}) {
  const where = []
  const params = []
  if (scope.sellerId != null) { where.push('p.seller_id = ?'); params.push(scope.sellerId) }
  if (status) { where.push('p.status = ?'); params.push(status) }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = await query(
    `${PAYOUT_SELECT} ${clause} ORDER BY p.requested_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM payouts p ${clause}`, params)
  return { items: rows.map(shapePayout), total: Number(total) }
}

/**
 * What this seller could be paid right now.
 *
 * Delivered items only — money is not owed on something that has not reached the buyer — and
 * excluding anything already attached to a payout. That NOT EXISTS is what stops the same
 * earnings appearing in two withdrawal requests.
 */
export async function getAvailableBalance(sellerId) {
  const [row] = await query(
    `SELECT COALESCE(SUM(oi.line_total), 0) AS gross, COUNT(*) AS item_count
       FROM order_items oi
      WHERE oi.seller_id = ?
        AND oi.status = 'delivered'
        AND NOT EXISTS (SELECT 1 FROM payout_items pi WHERE pi.order_item_id = oi.id)`,
    [sellerId],
  )
  const bps = await commissionBps()
  const gross = Number(row.gross)
  const commission = Math.round(gross * bps) / 10000
  return {
    grossAmount: formatMoney(gross.toFixed(2), 'PKR'),
    commissionAmount: formatMoney(commission.toFixed(2), 'PKR'),
    netAmount: formatMoney((gross - commission).toFixed(2), 'PKR'),
    commissionPercent: bps / 100,
    itemCount: Number(row.item_count),
    // Below this a transfer costs more in fees than it moves.
    minimumAmount: formatMoney('1000.00', 'PKR'),
    canRequest: gross - commission >= 1000,
  }
}

export async function getPayout(scope, publicId) {
  const row = await queryOne(`${PAYOUT_SELECT} WHERE p.public_id = ?`, [publicId])
  if (!row) throw notFound('Payout not found.')
  if (scope.sellerId != null && row.seller_id !== scope.sellerId) throw notFound('Payout not found.')

  const items = await query(
    `SELECT pi.amount, oi.product_name, oi.sku, oi.quantity, o.order_number
       FROM payout_items pi
       JOIN order_items oi ON oi.id = pi.order_item_id
       JOIN orders o ON o.id = oi.order_id
      WHERE pi.payout_id = ? ORDER BY o.order_number LIMIT 200`,
    [row.id],
  )
  return {
    ...shapePayout(row),
    items: items.map((item) => ({
      orderNumber: item.order_number,
      product: item.product_name,
      sku: item.sku,
      quantity: Number(item.quantity),
      amount: formatMoney(item.amount, row.currency_code),
    })),
  }
}

/**
 * Assemble a payout from everything currently owed to this seller.
 *
 * The eligible items are selected and locked inside the transaction, so two concurrent
 * withdrawal requests cannot both claim the same earnings — the second finds them gone.
 */
export async function requestPayout(sellerId, input = {}) {
  const existing = await queryOne(
    "SELECT id FROM payouts WHERE seller_id = ? AND status IN ('requested','approved','processing')",
    [sellerId],
  )
  if (existing) {
    throw conflict('You already have a withdrawal in progress. It must complete before requesting another.', 'PAYOUT_IN_PROGRESS')
  }

  const bps = await commissionBps()

  return withTransaction(async (connection) => {
    const [items] = await connection.execute(
      `SELECT oi.id, oi.line_total
         FROM order_items oi
        WHERE oi.seller_id = ?
          AND oi.status = 'delivered'
          AND NOT EXISTS (SELECT 1 FROM payout_items pi WHERE pi.order_item_id = oi.id)
        FOR UPDATE`,
      [sellerId],
    )
    if (!items.length) throw badRequest('There are no delivered orders awaiting payout.', 'NOTHING_TO_PAY')

    const gross = items.reduce((sum, item) => sum + Number(item.line_total), 0)
    const commission = Math.round(gross * bps) / 10000
    const net = gross - commission
    if (net < 1000) {
      throw badRequest('The minimum withdrawal is Rs. 1,000.', 'BELOW_MINIMUM')
    }

    const [[{ next }]] = await connection.execute('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM payouts')
    const reference = `MW-P-${String(next).padStart(6, '0')}`

    const [result] = await connection.execute(
      `INSERT INTO payouts
         (public_id, reference, seller_id, gross_amount, commission_amount, net_amount,
          currency_code, status, method, destination_hint, requested_at, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'PKR', 'requested', ?, ?, NOW(3), NOW(3), NOW(3))`,
      [
        reference, sellerId, gross.toFixed(2), commission.toFixed(2), net.toFixed(2),
        input.method ?? 'bank_transfer', input.destinationHint ?? null,
      ],
    )

    for (const item of items) {
      await connection.execute(
        'INSERT INTO payout_items (payout_id, order_item_id, amount, created_at) VALUES (?, ?, ?, NOW(3))',
        [result.insertId, item.id, Number(item.line_total).toFixed(2)],
      )
    }

    const [[row]] = await connection.execute('SELECT public_id FROM payouts WHERE id = ?', [result.insertId])
    return { publicId: row.public_id, reference, itemCount: items.length }
  })
}

/** Admin: move a payout along its status flow. */
export async function updatePayoutStatus(publicId, status, { adminUserId, externalReference, failureReason, notes } = {}) {
  const payout = await queryOne(
    'SELECT id, status, reference, seller_id FROM payouts WHERE public_id = ?',
    [publicId],
  )
  if (!payout) throw notFound('Payout not found.')
  if (payout.status === status) throw conflict(`This payout is already ${status}.`, 'NO_STATUS_CHANGE')
  if (!TRANSITIONS[payout.status]?.includes(status)) {
    throw conflict(`A ${payout.status} payout cannot be moved to ${status}.`, 'INVALID_STATUS_TRANSITION')
  }
  // Marking money as sent without a reference leaves nothing to reconcile against the bank.
  if (status === 'paid' && !externalReference) {
    throw badRequest('A transfer reference is required when marking a payout as paid.', 'REFERENCE_REQUIRED')
  }
  if ((status === 'rejected' || status === 'failed') && !failureReason) {
    throw badRequest('A reason is required.', 'REASON_REQUIRED')
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE payouts
          SET status = ?,
              approved_at = CASE WHEN ? = 'approved' THEN NOW(3) ELSE approved_at END,
              approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
              paid_at = CASE WHEN ? = 'paid' THEN NOW(3) ELSE paid_at END,
              external_reference = COALESCE(?, external_reference),
              failure_reason = ?,
              notes = COALESCE(?, notes),
              updated_at = NOW(3)
        WHERE id = ?`,
      [
        status, status, status, adminUserId ?? null, status,
        externalReference ?? null, failureReason ?? null, notes ?? null, payout.id,
      ],
    )
    // A rejected payout must release its items, or those earnings are stranded forever —
    // the unique key on order_item_id would block them from ever joining another payout.
    if (status === 'rejected') {
      await connection.execute('DELETE FROM payout_items WHERE payout_id = ?', [payout.id])
    }
  })

  return { reference: payout.reference, previousStatus: payout.status, status }
}

/** Totals for the admin payouts page. */
export async function getPayoutStats() {
  const [row] = await query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'requested') AS requested,
            SUM(status = 'approved') AS approved,
            SUM(status = 'paid') AS paid,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN net_amount ELSE 0 END), 0) AS paid_amount,
            COALESCE(SUM(CASE WHEN status IN ('requested','approved','processing') THEN net_amount ELSE 0 END), 0) AS pending_amount
       FROM payouts`,
  )
  return {
    total: Number(row.total),
    requested: Number(row.requested ?? 0),
    approved: Number(row.approved ?? 0),
    paid: Number(row.paid ?? 0),
    paidAmount: formatMoney(row.paid_amount, 'PKR'),
    pendingAmount: formatMoney(row.pending_amount, 'PKR'),
  }
}
