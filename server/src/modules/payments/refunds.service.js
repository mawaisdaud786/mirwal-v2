import { randomUUID } from 'node:crypto'
import { pool, query, queryOne } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { createNotification } from '../notifications/notifications.service.js'
import { reverseSaleForRefund } from '../payouts/ledger.service.js'
import * as stripeProvider from './providers/stripe.js'

/**
 * Refunds.
 *
 * Only card refunds are automated. EasyPaisa and JazzCash both expose refund APIs, but they
 * require merchant-portal-enabled permissions and their exact contracts weren't available
 * when this was built — and a money-OUT call I can't verify risks double-refunding or failing
 * silently. COD has no gateway to reverse at all; the cash was collected by the courier.
 *
 * So those cases land in `manual_required`: Mirwal records exactly what is owed to whom and
 * surfaces it for a human to action in the merchant portal, then mark settled. That is a
 * truthful state a person resolves — not a euphemism for a failure, and not a fake success.
 */

const AUTOMATED_PROVIDERS = new Set(['stripe'])

function shapeRefund(row) {
  return {
    id: row.public_id,
    orderNumber: row.order_number ?? null,
    provider: row.provider,
    amount: formatMoney(row.amount, row.currency_code),
    status: row.status,
    failureReason: row.failure_reason,
    // What a human must actually do, when the answer is "something".
    manualInstruction: row.status === 'manual_required' ? manualInstructionFor(row.provider) : null,
    settledAt: row.settled_at,
    createdAt: row.created_at,
  }
}

function manualInstructionFor(provider) {
  if (provider === 'cod') {
    return 'This order was paid in cash on delivery, so there is no online payment to reverse. Refund the buyer directly and mark this settled.'
  }
  return `Issue this refund from your ${provider === 'easypaisa' ? 'EasyPaisa' : 'JazzCash'} merchant portal, then mark it settled here.`
}

/**
 * Create the refund owed for an approved return.
 *
 * Called from inside the return-approval transaction so a refund record can never go missing
 * for an approved return. The gateway call itself happens after commit — an external API call
 * must not hold a database transaction open, and a failed call leaves a 'pending' row that is
 * safe to retry rather than losing the return approval alongside it.
 *
 * @returns {number|null} the new refund's id, or null if one already existed
 */
export async function createRefundForReturn(connection, { returnRequestId, orderId, amount }) {
  const [orderRows] = await connection.execute('SELECT * FROM orders WHERE id = ?', [orderId])
  const order = orderRows[0]

  // The successful attempt being reversed, if there was one. COD has none.
  const [attemptRows] = await connection.execute(
    "SELECT * FROM payment_attempts WHERE order_id = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1",
    [orderId],
  )
  const attempt = attemptRows[0] ?? null

  const provider = attempt?.provider ?? 'cod'
  // Nothing to reverse if the order was never actually paid — an unpaid order that gets
  // returned owes the buyer nothing.
  const wasPaid = order.payment_status === 'paid'
  const status = !wasPaid || !AUTOMATED_PROVIDERS.has(provider) ? 'manual_required' : 'pending'

  const publicId = randomUUID()
  try {
    const [result] = await connection.execute(
      `INSERT INTO refunds (public_id, order_id, return_request_id, payment_attempt_id,
                            provider, currency_code, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [publicId, orderId, returnRequestId, attempt?.id ?? null,
        provider, order.currency_code, amount, wasPaid ? status : 'succeeded'],
    )
    return result.insertId
  } catch (error) {
    // The unique key on return_request_id means an approved return can only ever owe one
    // refund, even if approval were somehow retried.
    if (error?.code === 'ER_DUP_ENTRY') return null
    throw error
  }
}

/**
 * A refund that no return produced.
 *
 * Two things create one: a cancellation on an order that was already paid, and an operator
 * deciding Mirwal owes a buyer something — a courier that lost a parcel, a delivery three weeks
 * late, an apology. Both were impossible before: `refunds.return_request_id` was effectively
 * mandatory, so the only way to refund a buyer was to invent a return they had not filed, which
 * corrupted the return statistics that seller performance is scored on.
 *
 * `kind` keeps them apart afterwards, because a tax statement that cannot distinguish a
 * returned sale from a goodwill payment is not a tax statement.
 *
 * Runs outside a transaction and is safe to call after one: the gateway call happens later, and
 * a refund row that exists but has not been attempted is the recoverable state.
 */
export async function createDiscretionaryRefund({
  orderId, orderItemId = null, amount, kind = 'goodwill', reason = null, createdByUserId = null,
}) {
  const order = await queryOne('SELECT * FROM orders WHERE id = ?', [orderId])
  if (!order) throw notFound('Order not found.')

  const value = Math.round(Number(amount) * 100) / 100
  if (!(value > 0)) throw conflict('A refund has to be for something.', 'INVALID_AMOUNT')

  /**
   * Nothing may be refunded twice.
   *
   * The ceiling is the order total minus what has already gone back. Without this an operator
   * issuing three goodwill refunds of the full amount would simply pay out three times, and
   * nothing downstream would notice.
   */
  const [{ already }] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS already FROM refunds
      WHERE order_id = ? AND status IN ('pending', 'manual_required', 'succeeded')`,
    [orderId],
  )
  const headroom = Math.round((Number(order.total) - Number(already)) * 100) / 100
  if (value > headroom) {
    throw conflict(
      headroom <= 0
        ? 'This order has already been refunded in full.'
        : `Only ${formatMoney(headroom, order.currency_code).display} of this order is left to refund.`,
      'REFUND_EXCEEDS_ORDER',
    )
  }

  const attempt = await queryOne(
    "SELECT * FROM payment_attempts WHERE order_id = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1",
    [orderId],
  )
  const provider = attempt?.provider ?? 'cod'
  const wasPaid = order.payment_status === 'paid' || order.payment_status === 'partially_refunded'
  const status = !wasPaid || !AUTOMATED_PROVIDERS.has(provider) ? 'manual_required' : 'pending'

  const publicId = randomUUID()
  const [result] = await pool.execute(
    `INSERT INTO refunds (public_id, order_id, return_request_id, order_item_id, kind, reason,
                          created_by_user_id, payment_attempt_id, provider, currency_code, amount, status)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [publicId, orderId, orderItemId, kind, reason ? String(reason).slice(0, 255) : null,
      createdByUserId, attempt?.id ?? null, provider, order.currency_code, value.toFixed(2), status],
  )

  // Attempt it straight away when it can be automated; a manual one waits for a person.
  if (status === 'pending') await processRefund(result.insertId)

  const saved = await queryOne(
    'SELECT r.*, o.order_number FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = ?',
    [result.insertId],
  )
  return shapeRefund(saved)
}

/**
 * Attempt the actual gateway call for a pending refund. Safe to call more than once: a
 * refund that is not 'pending' is left alone, and Stripe is given an idempotency key so a
 * retry after an ambiguous failure cannot pay twice.
 */
export async function processRefund(refundId) {
  const refund = await queryOne('SELECT * FROM refunds WHERE id = ?', [refundId])
  if (!refund || refund.status !== 'pending') return

  const attempt = refund.payment_attempt_id
    ? await queryOne('SELECT * FROM payment_attempts WHERE id = ?', [refund.payment_attempt_id])
    : null

  if (!attempt) {
    await pool.execute(
      "UPDATE refunds SET status = 'manual_required', failure_reason = ? WHERE id = ?",
      ['No completed online payment was found to reverse.', refundId],
    )
    return
  }

  try {
    const result = await stripeProvider.createRefund({
      paymentIntentId: attempt.provider_ref,
      amount: refund.amount,
      idempotencyKey: `refund_${refund.public_id}`,
    })
    await pool.execute(
      'UPDATE refunds SET status = ?, provider_ref = ?, failure_reason = ? WHERE id = ?',
      [result.succeeded ? 'succeeded' : 'pending', result.providerRef, result.failureReason ?? '', refundId],
    )
    if (result.succeeded) await afterRefundSucceeded(refundId)
  } catch (error) {
    // A gateway failure is recorded honestly and left for a human, rather than retried
    // blindly — repeated automatic money-out attempts against an unclear failure is exactly
    // how double refunds happen.
    await pool.execute(
      "UPDATE refunds SET status = 'manual_required', failure_reason = ? WHERE id = ?",
      [String(error?.message ?? 'Refund could not be completed automatically.').slice(0, 255), refundId],
    )
  }
}

async function afterRefundSucceeded(refundId) {
  const refund = await queryOne(
    `SELECT r.*, o.public_id AS order_public_id, o.order_number, o.buyer_id, o.total, o.currency_code AS order_currency
       FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = ?`,
    [refundId],
  )
  if (!refund) return

  // Mark the order refunded only when the refund covers its whole total; a partial refund on
  // a multi-item order leaves the order itself `partially_refunded` rather than paid, which
  // previously had nowhere to be recorded at all.
  const fullyRefunded = Math.round(Number(refund.amount) * 100) >= Math.round(Number(refund.total) * 100)
  await pool.execute(
    'UPDATE orders SET payment_status = ? WHERE id = ?',
    [fullyRefunded ? 'refunded' : 'partially_refunded', refund.order_id],
  )

  /**
   * Take the money back out of the seller's ledger.
   *
   * This is the case the old derived balance could not survive: an item delivered, paid out,
   * then returned and refunded left Mirwal out of pocket with no mechanism to recover it,
   * because the balance was a filter over unpaid order items rather than a record. Reversing
   * here drives the balance negative when it has to, and the commission goes back to the
   * seller at the same time — Mirwal does not keep a cut of a sale that did not happen.
   *
   * Best-effort on purpose. The buyer's money has already left; a ledger problem must not make
   * this function throw and leave the refund looking unfinished.
   */
  try {
    // A refund can now arrive without a return behind it — a cancellation or a goodwill
    // gesture — so the line is taken from the refund itself when it names one, and only
    // resolved through the return when it does not.
    const item = refund.order_item_id
      ? await queryOne(
        'SELECT id, seller_id, order_id FROM order_items WHERE id = ?',
        [refund.order_item_id],
      )
      : refund.return_request_id
        ? await queryOne(
          `SELECT oi.id, oi.seller_id, oi.order_id
             FROM return_requests rr JOIN order_items oi ON oi.id = rr.order_item_id
            WHERE rr.id = ?`,
          [refund.return_request_id],
        )
        : null
    if (item) {
      await reverseSaleForRefund(null, {
        sellerId: item.seller_id,
        orderItemId: item.id,
        orderId: item.order_id,
        refundId: refund.id,
        amount: refund.amount,
        currencyCode: refund.currency_code,
      })
    }
  } catch (error) {
    console.error('[refunds] ledger reversal failed', { refundId: refund.id, error: error.message })
  }

  await createNotification(refund.buyer_id, {
    type: 'refund_issued',
    title: `Refund issued for ${refund.order_number}`,
    body: `${formatMoney(refund.amount, refund.currency_code).display} has been refunded. It may take a few working days to appear.`,
    link: `/order-success/${refund.order_public_id}`,
  })
}

/** Refunds a seller needs to action by hand, scoped to their own store's returns. */
export async function listManualRefundsForSeller(sellerId) {
  const rows = await query(
    `SELECT r.*, o.order_number
       FROM refunds r
       JOIN orders o ON o.id = r.order_id
       JOIN return_requests rr ON rr.id = r.return_request_id
      WHERE rr.seller_id = ? AND r.status = 'manual_required'
      ORDER BY r.created_at DESC`,
    [sellerId],
  )
  return rows.map(shapeRefund)
}

/** A seller confirming they have refunded a buyer out-of-band. */
export async function markRefundSettledBySeller(sellerId, userId, refundPublicId) {
  const refund = await queryOne(
    `SELECT r.*, rr.seller_id
       FROM refunds r
       LEFT JOIN return_requests rr ON rr.id = r.return_request_id
      WHERE r.public_id = ?`,
    [refundPublicId],
  )
  if (!refund) throw notFound('Refund not found.', 'REFUND_NOT_FOUND')
  if (refund.seller_id !== sellerId) throw forbidden('This refund does not belong to your store.')
  if (refund.status !== 'manual_required') {
    throw conflict(`This refund is already ${refund.status}.`, 'REFUND_NOT_MANUAL')
  }

  await query(
    "UPDATE refunds SET status = 'succeeded', settled_by_user_id = ?, settled_at = NOW(3) WHERE id = ?",
    [userId, refund.id],
  )
  await afterRefundSucceeded(refund.id)

  return shapeRefund(await queryOne(
    'SELECT r.*, o.order_number FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = ?',
    [refund.id],
  ))
}

/** A buyer's own view of refunds owed or paid on their orders. */
export async function listRefundsForBuyer(buyerId) {
  const rows = await query(
    `SELECT r.*, o.order_number
       FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE o.buyer_id = ?
      ORDER BY r.created_at DESC`,
    [buyerId],
  )
  return rows.map(shapeRefund)
}
