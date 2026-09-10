import { randomUUID } from 'node:crypto'
import { pool, query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { env } from '../../config/env.js'
import { createNotification } from '../notifications/notifications.service.js'
import * as stripeProvider from './providers/stripe.js'
import * as easypaisaProvider from './providers/easypaisa.js'
import * as jazzcashProvider from './providers/jazzcash.js'
import { issueForOrder } from '../orders/invoices.service.js'

/**
 * Payment orchestration.
 *
 * Three rules run through all of this:
 *
 *  1. **The amount is always the server's own.** Every charge is created from the order total
 *     re-read from the database, never from anything the client sent — the same rule
 *     `createOrder` already enforces for prices and stock.
 *
 *  2. **Only a verified provider callback marks an order paid.** The browser returning to a
 *     success URL proves nothing; a shopper can navigate there directly. `settleAttempt` is
 *     the single place `payment_status` becomes 'paid', and it is only ever reached from a
 *     signature-verified webhook/callback.
 *
 *  3. **Settlement is idempotent.** Providers retry callbacks on any non-2xx, and all three
 *     do. `payment_webhook_events` has a unique key on (provider, event_id) and the order
 *     update is a no-op once already paid, so a replayed callback cannot double-apply.
 */

const PROVIDER_FOR_METHOD = { card: 'stripe', easypaisa: 'easypaisa', jazzcash: 'jazzcash' }

/** What the checkout UI is allowed to offer — driven by which secrets are actually present. */
export function availablePaymentMethods() {
  return [
    {
      method: 'cod',
      label: 'Cash on Delivery',
      description: 'Pay in cash when your order arrives.',
      available: true,
    },
    {
      method: 'card',
      label: 'Debit / Credit Card',
      description: 'Visa or Mastercard, processed securely by Stripe.',
      available: env.payments.stripe.enabled,
    },
    {
      method: 'easypaisa',
      label: 'EasyPaisa',
      description: 'Pay from your EasyPaisa mobile wallet.',
      available: env.payments.easypaisa.enabled,
    },
    {
      method: 'jazzcash',
      label: 'JazzCash',
      description: 'Pay from your JazzCash mobile wallet.',
      available: env.payments.jazzcash.enabled,
    },
  ]
}

export function assertMethodAvailable(method) {
  const entry = availablePaymentMethods().find((option) => option.method === method)
  if (!entry) throw badRequest(`Unknown payment method "${method}".`, 'UNKNOWN_PAYMENT_METHOD')
  if (!entry.available) {
    throw badRequest(
      `${entry.label} isn't available right now. Please choose another payment method.`,
      'PAYMENT_METHOD_UNAVAILABLE',
    )
  }
}

async function loadOwnedOrder(buyerId, orderPublicId) {
  const order = await queryOne('SELECT * FROM orders WHERE public_id = ?', [orderPublicId])
  if (!order) throw notFound('Order not found.', 'ORDER_NOT_FOUND')
  if (order.buyer_id !== buyerId) throw forbidden('This order does not belong to you.')
  return order
}

/**
 * Begin paying for an order. Returns whatever the chosen provider needs the browser to do
 * next: a Stripe client secret to confirm in-page, or a signed form to POST to a wallet's
 * hosted checkout.
 */
export async function startPayment(buyerId, orderPublicId, method) {
  assertMethodAvailable(method)
  if (method === 'cod') throw badRequest('Cash on Delivery does not require a payment step.', 'COD_NEEDS_NO_PAYMENT')

  const order = await loadOwnedOrder(buyerId, orderPublicId)
  if (order.payment_status === 'paid') throw conflict('This order is already paid.', 'ORDER_ALREADY_PAID')

  const provider = PROVIDER_FOR_METHOD[method]
  // The amount the provider is asked for is always the order's own stored total.
  const amount = order.total
  const returnUrl = `${env.payments.returnUrlBase}/order-success/${order.public_id}`

  let providerRef
  let clientPayload

  if (provider === 'stripe') {
    const intent = await stripeProvider.createPaymentIntent({
      orderNumber: order.order_number,
      orderPublicId: order.public_id,
      amount,
      currency: order.currency_code,
    })
    providerRef = intent.providerRef
    clientPayload = { kind: 'stripe', clientSecret: intent.clientSecret, publishableKey: intent.publishableKey }
  } else {
    const builder = provider === 'easypaisa' ? easypaisaProvider : jazzcashProvider
    const checkout = builder.buildCheckout({
      orderNumber: order.order_number,
      amount,
      description: `Mirwal order ${order.order_number}`,
      returnUrl,
    })
    providerRef = checkout.providerRef
    // The browser posts these fields to the wallet's hosted page. They are signed
    // server-side; nothing here is a secret the shopper shouldn't see.
    clientPayload = { kind: 'redirect_form', postUrl: checkout.postUrl, fields: checkout.fields }
  }

  await pool.execute(
    `INSERT INTO payment_attempts (public_id, order_id, provider, provider_ref, currency_code, amount, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [randomUUID(), order.id, provider, providerRef, order.currency_code, amount],
  )

  await pool.execute(
    "UPDATE orders SET payment_method = ?, payment_status = 'processing' WHERE id = ?",
    [method, order.id],
  )

  return { orderId: order.public_id, method, ...clientPayload }
}

/**
 * Apply a verified provider result to an order. The ONLY path that sets payment_status
 * to 'paid'.
 *
 * @param {object} result normalised provider result: { providerRef, succeeded, failureReason, amount, cardBrand, cardLast4 }
 */
export async function settleAttempt(provider, result) {
  const attempt = await queryOne(
    'SELECT * FROM payment_attempts WHERE provider = ? AND provider_ref = ?',
    [provider, result.providerRef],
  )
  // A callback for a reference Mirwal never created is either a misdirected webhook or an
  // attack; either way there is nothing to settle.
  if (!attempt) return { applied: false, reason: 'UNKNOWN_ATTEMPT' }
  if (attempt.status === 'succeeded') return { applied: false, reason: 'ALREADY_SETTLED' }

  const order = await queryOne('SELECT * FROM orders WHERE id = ?', [attempt.order_id])

  // Guard against a provider reporting a different amount than Mirwal asked to charge.
  // Compared in minor units so 0.1 + 0.2 style float drift can't cause a false mismatch.
  if (result.succeeded && result.amount != null) {
    const expected = Math.round(Number(attempt.amount) * 100)
    const actual = Math.round(Number(result.amount) * 100)
    if (expected !== actual) {
      await pool.execute(
        "UPDATE payment_attempts SET status = 'failed', failure_reason = ? WHERE id = ?",
        [`Amount mismatch: charged ${actual}, expected ${expected}`, attempt.id],
      )
      return { applied: false, reason: 'AMOUNT_MISMATCH' }
    }
  }

  if (!result.succeeded) {
    await pool.execute(
      "UPDATE payment_attempts SET status = 'failed', failure_reason = ? WHERE id = ?",
      [String(result.failureReason ?? '').slice(0, 255), attempt.id],
    )
    // The order stays unpaid and remains payable — a failed attempt is not a dead order.
    await pool.execute("UPDATE orders SET payment_status = 'pending' WHERE id = ? AND payment_status <> 'paid'", [order.id])
    return { applied: true, succeeded: false }
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE payment_attempts
          SET status = 'succeeded', card_brand = ?, card_last4 = ?, wallet_msisdn_masked = ?
        WHERE id = ?`,
      [result.cardBrand ?? '', result.cardLast4 ?? null, result.walletMsisdnMasked ?? '', attempt.id],
    )
    await connection.execute(
      "UPDATE orders SET payment_status = 'paid', paid_at = NOW(3) WHERE id = ? AND payment_status <> 'paid'",
      [order.id],
    )
    await createNotification(order.buyer_id, {
      type: 'payment_received',
      title: `Payment received for ${order.order_number}`,
      body: `We've received your payment of ${order.total} ${order.currency_code}.`,
      link: `/order-success/${order.public_id}`,
    }, connection)
  })

  /**
   * Issue the tax invoice.
   *
   * After the transaction, not inside it: the invoice number is taken under its own row lock,
   * and holding that lock inside the payment transaction would serialise every checkout behind
   * one counter. Failure is swallowed because the payment has already succeeded — a buyer whose
   * money was taken must not see an error, and the invoice is issued on first request anyway.
   */
  try {
    await issueForOrder(order.id)
  } catch (error) {
    console.error('[payments] invoice could not be issued', { orderId: order.id, error: error.message })
  }

  return { applied: true, succeeded: true }
}

/**
 * Record a webhook event before acting on it. Returns false if this exact event was already
 * recorded, which is how a provider's retry is prevented from double-applying.
 */
export async function recordWebhookEvent(provider, eventId, eventType, payload) {
  if (!eventId) return true // Nothing to dedupe on; the attempt-level guards still apply.
  try {
    await pool.execute(
      'INSERT INTO payment_webhook_events (provider, event_id, event_type, payload) VALUES (?, ?, ?, ?)',
      [provider, eventId, eventType ?? '', typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})],
    )
    return true
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return false
    throw error
  }
}

export async function markWebhookProcessed(provider, eventId) {
  if (!eventId) return
  await query('UPDATE payment_webhook_events SET processed_at = NOW(3) WHERE provider = ? AND event_id = ?', [provider, eventId])
}

/** A buyer's own view of what happened when they tried to pay. */
export async function getPaymentStatusForOrder(buyerId, orderPublicId) {
  const order = await loadOwnedOrder(buyerId, orderPublicId)
  const attempts = await query(
    `SELECT provider, status, failure_reason, card_brand, card_last4, created_at
       FROM payment_attempts WHERE order_id = ? ORDER BY created_at DESC`,
    [order.id],
  )
  return {
    orderId: order.public_id,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    paidAt: order.paid_at,
    attempts: attempts.map((attempt) => ({
      provider: attempt.provider,
      status: attempt.status,
      failureReason: attempt.failure_reason,
      card: attempt.card_last4 ? { brand: attempt.card_brand, last4: attempt.card_last4 } : null,
      createdAt: attempt.created_at,
    })),
  }
}
