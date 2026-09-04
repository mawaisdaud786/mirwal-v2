import { randomUUID } from 'node:crypto'
import { pool, query, queryOne } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { createNotification } from '../notifications/notifications.service.js'
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
  // a multi-item order leaves the order itself still paid.
  const fullyRefunded = Math.round(Number(refund.amount) * 100) >= Math.round(Number(refund.total) * 100)
  if (fullyRefunded) {
    await pool.execute("UPDATE orders SET payment_status = 'refunded' WHERE id = ?", [refund.order_id])
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
