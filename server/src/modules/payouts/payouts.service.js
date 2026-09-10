import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { getNumericSetting } from '../settings/settings.service.js'
import { defaultAccountId, payoutEligibility } from '../sellers/bank.service.js'
import { getBalance, record as recordLedger } from './ledger.service.js'

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
    // The public id is what makes the store column a link rather than a dead string.
    seller: row.seller_slug ? { id: row.seller_public_id, slug: row.seller_slug, name: row.seller_store_name } : null,
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
         s.public_id AS seller_public_id, s.slug AS seller_slug, s.store_name AS seller_store_name,
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
/**
 * What this seller could be paid right now.
 *
 * Reads the ledger. It used to derive "delivered items not attached to a payout", which could
 * not express a hold, a reserve against an open return, a refund that landed after a payout,
 * an adjustment or tax — and gave a seller a number nobody could explain line by line.
 *
 * The eligibility check is folded in so the caller gets one answer to "can I withdraw, and if
 * not, why not" rather than a number and a separate silent refusal.
 */
export async function getAvailableBalance(sellerId) {
  const [balance, eligibility] = await Promise.all([
    getBalance(sellerId),
    payoutEligibility(sellerId),
  ])

  return {
    ...balance,
    grossAmount: balance.lifetime,
    commissionPercent: (await commissionBps()) / 100,
    canRequest: balance.canRequest && eligibility.eligible,
    blockedReason: eligibility.eligible ? balance.blockedReason : eligibility.reason,
    blockedCode: eligibility.eligible ? null : eligibility.code,
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
    "SELECT id FROM payouts WHERE seller_id = ? AND status IN ('requested','on_hold','approved','processing')",
    [sellerId],
  )
  if (existing) {
    throw conflict('You already have a withdrawal in progress. It must complete before requesting another.', 'PAYOUT_IN_PROGRESS')
  }

  /**
   * Can this seller be paid at all?
   *
   * Checked before anything is assembled, and it answers with a reason rather than a boolean:
   * a store that is suspended, has no verified payout account, or is inside the cooling-off
   * window after changing its bank details must be told which of those it is. A refused
   * withdrawal with no explanation is the seller-support ticket this exists to prevent.
   */
  const eligibility = await payoutEligibility(sellerId)
  if (!eligibility.eligible) {
    throw conflict(eligibility.reason, eligibility.code)
  }

  const balance = await getBalance(sellerId)
  if (!balance.canRequest) {
    throw badRequest(balance.blockedReason ?? 'There is nothing available to withdraw.', 'NOTHING_TO_PAY')
  }

  const bankAccountId = await defaultAccountId(sellerId)
  const bps = await commissionBps()

  return withTransaction(async (connection) => {
    /**
     * Which earnings this withdrawal pays for.
     *
     * Three conditions, and the last two are new:
     *
     *   - delivered and not already attached to a payout, as before;
     *   - **matured** — past the hold window, so money is not paid out before the buyer's
     *     return window closes and it becomes recoverable;
     *   - **not reserved** — no open return against the item, so Mirwal does not hand over
     *     money it is about to owe back.
     *
     * Driven off the ledger rather than off `order_items` directly, because the ledger is
     * where the hold and the reversals live. `FOR UPDATE` locks the rows so two simultaneous
     * withdrawal requests cannot both claim the same earnings.
     */
    const [entries] = await connection.execute(
      `SELECT e.order_item_id, e.amount
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
              )
        FOR UPDATE`,
      [sellerId],
    )
    /**
     * What this withdrawal is worth.
     *
     * The available balance, not the sum of the claimable order items. Those are usually the
     * same number, and deliberately are not required to be: an adjustment, a reversed penalty
     * or a returned commission is money Mirwal owes with no order item behind it, and paying
     * only what maps to a line would strand it permanently.
     *
     * `entries` is still collected and linked through `payout_items`, because that is what
     * makes a payout explainable — and what `uq_payout_items_item` uses to guarantee no order
     * item is ever paid twice.
     */
    const gross = balance.availableAmount
    /**
     * Commission was already taken.
     *
     * Every `sale` entry is posted alongside its own negative `commission` entry, so the
     * available balance is net of commission before this function sees it. Deducting again
     * here would charge the seller the marketplace's cut twice — the figure below is recorded
     * for the statement, not subtracted from the payout.
     */
    const commission = entries.reduce(
      (sum, entry) => sum + Math.round(Number(entry.amount) * bps) / 10000, 0,
    )

    /**
     * Withholding tax.
     *
     * Deducted at source because Pakistani sellers are taxed at source; recording it as its
     * own ledger entry rather than folding it into the commission is what lets a seller's
     * statement — and eventually their tax certificate — show the two separately.
     */
    const withholdingBps = await getNumericSetting('finance.withholding_tax_bps', { fallback: 0, max: 10_000 })
    // Levied on what the seller actually receives, which `gross` already is.
    const tax = Math.round(gross * withholdingBps) / 10000

    const net = gross - tax
    /**
     * The pre-deduction figure, reconstructed for the statement.
     *
     * A seller reading "you were paid Rs. 45,000" needs to see the Rs. 50,000 it came from and
     * the two deductions between them; storing only the net would make the payout row
     * unexplainable on its own.
     */
    const grossBeforeDeductions = Math.round((net + commission + tax) * 100) / 100
    const minimum = await getNumericSetting('finance.payout_minimum', { fallback: 1000, max: 1_000_000 })
    if (net < minimum) {
      throw badRequest(`The minimum withdrawal is Rs. ${minimum.toLocaleString('en-PK')}.`, 'BELOW_MINIMUM')
    }

    const [[{ next }]] = await connection.execute('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM payouts')
    const reference = `MW-P-${String(next).padStart(6, '0')}`

    const [result] = await connection.execute(
      `INSERT INTO payouts
         (public_id, reference, seller_id, gross_amount, commission_amount, tax_withheld, net_amount,
          currency_code, status, method, bank_account_id, destination_hint,
          requested_at, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'PKR', 'requested', ?, ?, ?, NOW(3), NOW(3), NOW(3))`,
      [
        reference, sellerId, grossBeforeDeductions.toFixed(2), commission.toFixed(2), tax.toFixed(2), net.toFixed(2),
        input.method ?? 'bank_transfer', bankAccountId, input.destinationHint ?? null,
      ],
    )

    for (const entry of entries) {
      await connection.execute(
        'INSERT INTO payout_items (payout_id, order_item_id, amount, created_at) VALUES (?, ?, ?, NOW(3))',
        [result.insertId, entry.order_item_id, Number(entry.amount).toFixed(2)],
      )
    }

    // The money leaving is itself a ledger entry, so the balance drops the moment a
    // withdrawal is requested rather than when it is eventually paid. Without that a seller
    // could request, see the same balance, and request again.
    await recordLedger(connection, {
      sellerId,
      entryType: 'payout',
      amount: -net,
      payoutId: result.insertId,
      description: `Withdrawal ${reference}`,
    })
    if (tax > 0) {
      await recordLedger(connection, {
        sellerId,
        entryType: 'tax_withheld',
        amount: -tax,
        payoutId: result.insertId,
        description: `Withholding tax on ${reference}`,
      })
    }

    const [[row]] = await connection.execute('SELECT public_id FROM payouts WHERE id = ?', [result.insertId])
    return { publicId: row.public_id, reference, itemCount: entries.length, netAmount: net.toFixed(2) }
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
