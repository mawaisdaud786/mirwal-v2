import { randomUUID } from 'node:crypto'
import { query, queryOne } from '../../db/pool.js'
import { badRequest } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { getNumericSetting } from '../settings/settings.service.js'

/**
 * The seller ledger — the single source of truth for what Mirwal owes a seller.
 *
 * `getAvailableBalance()` used to derive a balance as "delivered items not yet attached to a
 * payout". That is a query, not a record, and it cannot express any of the things a real
 * marketplace balance has to:
 *
 *   * a **hold**, so money is not withdrawable the instant an item is delivered and before the
 *     return window closes;
 *   * a **reserve** against an open return, so a refund that is coming is not offered to the
 *     seller first;
 *   * a **clawback**, when an item is delivered, paid out, then returned and refunded — under
 *     the old model that money was simply gone;
 *   * an **adjustment**, a **penalty**, or **tax withheld**;
 *   * an explanation. A seller asking "why is my balance this number" could only be told
 *     "because of a query", and a support agent could not answer at all.
 *
 * The design is an ordinary append-only ledger. Every event that changes what Mirwal owes
 * writes one immutable row; a correction is a new row with the opposite sign, never an edit.
 *
 *   amount > 0   Mirwal owes the seller more
 *   amount < 0   Mirwal owes the seller less
 *
 * `available_at` is the hold: an earning is *recorded* at delivery and becomes *withdrawable*
 * once the window has passed. Deductions are available immediately, because a debt is
 * immediate — deferring one would let a seller withdraw money they already owe back.
 */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

/**
 * Commission for one seller, in basis points.
 *
 * A per-seller override beats the platform rate, which is how a negotiated deal is honoured
 * without editing a global setting that affects everyone.
 */
export async function commissionBpsFor(sellerId) {
  const seller = await queryOne('SELECT commission_bps_override FROM sellers WHERE id = ?', [sellerId])
  if (seller?.commission_bps_override != null) return Number(seller.commission_bps_override)
  return getNumericSetting('finance.commission_bps', { fallback: 1000, max: 10_000 })
}

/**
 * Write one entry.
 *
 * Takes an optional transaction connection so a ledger row and the thing it records — an item
 * being delivered, a refund being issued — commit together. A balance that can disagree with
 * the orders behind it is worse than no balance.
 */
export async function record(connection, {
  sellerId, entryType, amount, orderItemId = null, orderId = null,
  payoutId = null, refundId = null, availableAt = null, description = '',
  reversesId = null, createdBy = null, currencyCode = 'PKR',
}) {
  const executor = connection ?? { execute: (sql, params) => query(sql, params) }
  const publicId = randomUUID()

  await executor.execute(
    `INSERT INTO seller_ledger_entries
       (public_id, seller_id, entry_type, amount, currency_code, order_item_id, order_id,
        payout_id, refund_id, available_at, description, reverses_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW(3)), ?, ?, ?)`,
    [
      publicId, sellerId, entryType, round2(amount), currencyCode, orderItemId, orderId,
      payoutId, refundId, availableAt, String(description).slice(0, 255), reversesId, createdBy,
    ],
  )
  return publicId
}

/**
 * Post the earning for a delivered item.
 *
 * Called from the fulfilment path the moment an item reaches `delivered`, and idempotent by
 * construction: `uq_seller_ledger_sale_once` allows exactly one `sale` row per order item
 * ever, so a retried job or a double-fired event cannot pay a seller twice. That is the same
 * guarantee `uq_payout_items_item` already gives on the payout side, applied one step earlier.
 *
 * Three rows, not one, because a seller's statement has to show the gross, the commission and
 * the tax separately — a single net figure is exactly what sellers dispute.
 */
export async function postSaleEarning(connection, { sellerId, orderItemId, orderId, lineTotal, discountAmount, discountFundedBy, currencyCode = 'PKR' }) {
  const holdDays = await getNumericSetting('finance.payout_hold_days', { fallback: 7, max: 180 })
  const bps = await commissionBpsFor(sellerId)

  // A platform-funded discount is Mirwal's cost, not the seller's: they are paid on the full
  // line. A seller-funded one comes out of their earnings, which is what they signed up for
  // when they created the coupon. Getting this backwards is the fastest way to lose a seller.
  const sellerGross = discountFundedBy === 'seller'
    ? round2(Number(lineTotal) - Number(discountAmount ?? 0))
    : round2(Number(lineTotal))

  const commission = round2((sellerGross * bps) / 10_000)

  const availableAt = holdDays > 0
    ? new Date(Date.now() + holdDays * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    : null

  const saleId = await record(connection, {
    sellerId,
    entryType: 'sale',
    amount: sellerGross,
    orderItemId,
    orderId,
    availableAt,
    currencyCode,
    description: 'Delivered order item',
  })

  if (commission > 0) {
    await record(connection, {
      sellerId,
      entryType: 'commission',
      amount: -commission,
      orderItemId,
      orderId,
      // Deductions mature immediately: a debt does not wait for a hold to expire.
      availableAt: null,
      currencyCode,
      description: `Marketplace commission (${(bps / 100).toFixed(2)}%)`,
    })
  }

  // Snapshotted onto the item so a historical payout keeps the rate actually applied, even if
  // the platform rate changes afterwards.
  if (connection) {
    await connection.execute(
      'UPDATE order_items SET commission_amount = ? WHERE id = ?',
      [commission, orderItemId],
    )
  } else {
    await query('UPDATE order_items SET commission_amount = ? WHERE id = ?', [commission, orderItemId])
  }

  return { saleId, gross: sellerGross, commission, availableAt }
}

/**
 * Reverse an earning when the buyer is refunded.
 *
 * This is the case the old derived balance could not survive. If the item was already paid
 * out, the reversal simply drives the balance negative — which is correct, and is why the
 * balance is a sum of rows rather than a filter over unpaid items. The commission is returned
 * to the seller at the same time: Mirwal does not keep a cut of a sale that did not happen.
 */
export async function reverseSaleForRefund(connection, { sellerId, orderItemId, orderId, refundId, amount, currencyCode = 'PKR' }) {
  const sale = await lookupSale(connection, orderItemId)

  /**
   * Nothing to reverse means nothing to post.
   *
   * Refunds no longer arrive only from returns: a cancellation before dispatch now refunds the
   * buyer too, and that item never earned the seller anything — the sale entry is written on
   * delivery. Posting a negative entry against an earning that was never credited would drive
   * the balance negative for a sale the seller never made, and the seller would be funding a
   * cancellation they may not even have caused.
   */
  if (!sale) return { reversed: 0, skipped: 'nothing was credited for this item' }

  // Never reverse more than was earned. A partial refund reverses its own amount; a full one
  // is capped at the sale so a rounding difference cannot manufacture a debt.
  const reversal = round2(Math.min(Number(amount), Number(sale.amount)))

  await record(connection, {
    sellerId,
    entryType: 'refund',
    amount: -reversal,
    orderItemId,
    orderId,
    refundId,
    currencyCode,
    reversesId: sale?.id ?? null,
    description: 'Buyer refunded',
  })

  // Mirwal does not keep a cut of a sale that did not happen.
  const bps = await commissionBpsFor(sellerId)
  const commissionBack = round2((reversal * bps) / 10_000)
  if (commissionBack > 0) {
    await record(connection, {
      sellerId,
      entryType: 'commission_refund',
      amount: commissionBack,
      orderItemId,
      orderId,
      refundId,
      currencyCode,
      description: 'Commission returned on refund',
    })
  }

  return { reversed: reversal }
}

async function lookupSale(connection, orderItemId) {
  const sql = "SELECT id, amount FROM seller_ledger_entries WHERE entry_type = 'sale' AND order_item_id = ?"
  if (connection) {
    const [rows] = await connection.execute(sql, [orderItemId])
    return rows[0] ?? null
  }
  return queryOne(sql, [orderItemId])
}

/**
 * What a seller can actually withdraw right now.
 *
 * Four different numbers, because they answer four different questions and showing only the
 * last one is what makes a seller think money has gone missing:
 *
 *   lifetime   everything ever earned and deducted
 *   pending    earned but still inside the hold window
 *   reserved   held back against returns that are still open
 *   available  what a withdrawal may be requested for
 */
export async function getBalance(sellerId) {
  const [totals] = await query(
    `SELECT
       COALESCE(SUM(amount), 0)                                              AS lifetime,
       COALESCE(SUM(CASE WHEN available_at <= NOW(3) THEN amount END), 0)    AS matured,
       COALESCE(SUM(CASE WHEN available_at > NOW(3)  THEN amount END), 0)    AS pending
     FROM seller_ledger_entries
     WHERE seller_id = ?`,
    [sellerId],
  )

  /**
   * Money held against returns that have not been decided.
   *
   * An item whose return is still open may be refunded tomorrow. Paying its earnings out
   * today means chasing the seller for it afterwards, which is the situation this whole module
   * exists to avoid. The reserve is released automatically when the return closes, because the
   * query simply stops matching it — no job has to remember.
   */
  const [reserve] = await query(
    `SELECT COALESCE(SUM(e.amount), 0) AS reserved
       FROM seller_ledger_entries e
       JOIN return_requests r ON r.order_item_id = e.order_item_id
      WHERE e.seller_id = ?
        AND e.entry_type = 'sale'
        -- Matured entries only. Anything still inside the hold window is already excluded
        -- from the matured total below, so reserving it as well would subtract the same money
        -- twice and drive the available balance to zero for a seller who owes nothing.
        AND e.available_at <= NOW(3)
        AND r.status IN ('requested','more_info_required','approved','in_transit','received','escalated')`,
    [sellerId],
  )

  /**
   * How many earnings are actually claimable right now.
   *
   * The same three conditions `requestPayout` uses to assemble a withdrawal — matured, not
   * already paid, not reserved against an open return. Computed here so the balance the seller
   * is shown and the payout they can request cannot disagree about what is included.
   */
  const [{ item_count: itemCount }] = await query(
    `SELECT COUNT(*) AS item_count
       FROM seller_ledger_entries e
      WHERE e.seller_id = ?
        AND e.entry_type = 'sale'
        AND e.available_at <= NOW(3)
        AND e.order_item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM payout_items pi WHERE pi.order_item_id = e.order_item_id)
        AND NOT EXISTS (
              SELECT 1 FROM return_requests r
               WHERE r.order_item_id = e.order_item_id
                 AND r.status IN ('requested','more_info_required','approved','in_transit','received','escalated')
            )`,
    [sellerId],
  )

  const matured = Number(totals.matured)
  const reserved = Math.max(Number(reserve.reserved), 0)
  const available = round2(Math.max(matured - reserved, 0))

  const minimum = await getNumericSetting('finance.payout_minimum', { fallback: 1000, max: 1_000_000 })

  return {
    lifetime: formatMoney(round2(totals.lifetime).toFixed(2), 'PKR'),
    // Deliberately signed and exposed: a negative balance is a real state after a refund
    // lands post-payout, and hiding it behind a floor of zero would make the next payout
    // silently wrong.
    availableAmount: available,
    available: formatMoney(available.toFixed(2), 'PKR'),
    pending: formatMoney(round2(totals.pending).toFixed(2), 'PKR'),
    reserved: formatMoney(reserved.toFixed(2), 'PKR'),
    itemCount: Number(itemCount),
    negative: Number(totals.lifetime) < 0,
    minimumAmount: formatMoney(round2(minimum).toFixed(2), 'PKR'),
    /**
     * Withdrawable is a question about money, not about order items.
     *
     * This briefly required at least one claimable order item, which meant a seller holding a
     * goodwill adjustment or a reversed penalty — real money Mirwal owes them, with no order
     * behind it — could never withdraw it.
     */
    canRequest: available >= minimum,
    // Why they cannot, when they cannot. A disabled button with no explanation is a support
    // ticket.
    blockedReason: available >= minimum
      ? null
      : reserved > 0
        ? `${formatMoney(reserved.toFixed(2), 'PKR').display} is held against open returns.`
        : Number(totals.pending) > 0
          ? 'Recent earnings are still inside the payout hold window.'
          : `You need at least ${formatMoney(round2(minimum).toFixed(2), 'PKR').display} to withdraw.`,
  }
}

/** The statement: every entry, newest first, with a running explanation. */
export async function listEntries(sellerId, { page = 1, pageSize = 50, entryType, from, to } = {}) {
  const where = ['e.seller_id = ?']
  const params = [sellerId]
  if (entryType) { where.push('e.entry_type = ?'); params.push(entryType) }
  if (from) { where.push('e.created_at >= ?'); params.push(from) }
  if (to) { where.push('e.created_at < ?'); params.push(to) }
  const clause = `WHERE ${where.join(' AND ')}`

  const rows = await query(
    `SELECT e.public_id, e.entry_type, e.amount, e.currency_code, e.description,
            e.available_at, e.created_at,
            o.order_number, oi.product_name, p.reference AS payout_reference
       FROM seller_ledger_entries e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN order_items oi ON oi.id = e.order_item_id
       LEFT JOIN payouts p ON p.id = e.payout_id
       ${clause}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM seller_ledger_entries e ${clause}`,
    params,
  )

  return {
    items: rows.map((row) => ({
      id: row.public_id,
      type: row.entry_type,
      amount: formatMoney(row.amount, row.currency_code),
      // Signed separately from the display string, so a client can colour a deduction without
      // parsing a formatted amount.
      direction: Number(row.amount) < 0 ? 'debit' : 'credit',
      description: row.description,
      orderNumber: row.order_number ?? null,
      productName: row.product_name ?? null,
      payoutReference: row.payout_reference ?? null,
      availableAt: row.available_at,
      matured: row.available_at ? new Date(`${row.available_at}Z`) <= new Date() : true,
      at: row.created_at,
    })),
    total: Number(total),
  }
}

/**
 * A manual correction by finance.
 *
 * Requires a description, because an unexplained adjustment is indistinguishable from an
 * error — and this is the one entry type with no automatic origin to point back at.
 */
export async function adjust({ sellerId, amount, description, createdBy, entryType = 'adjustment' }) {
  if (!description || String(description).trim().length < 5) {
    throw badRequest('An adjustment needs an explanation.', 'DESCRIPTION_REQUIRED')
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) === 0) {
    throw badRequest('Enter a non-zero amount.', 'INVALID_AMOUNT')
  }
  const id = await record(null, {
    sellerId, entryType, amount: Number(amount), description, createdBy,
  })
  return { id, amount: round2(amount) }
}

export { round2 }
