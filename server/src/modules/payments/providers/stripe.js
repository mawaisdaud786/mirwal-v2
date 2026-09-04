import Stripe from 'stripe'
import { env } from '../../../config/env.js'

/**
 * Card payments (Visa/Mastercard) via Stripe PaymentIntents.
 *
 * Mirwal's server never sees a card number. It creates a PaymentIntent, hands the frontend
 * only the client secret, and Stripe.js collects the card directly from the shopper's browser
 * — which is what keeps Mirwal out of PCI-DSS scope. The only card data stored is the brand
 * and last four digits, for display, read back off the confirmed PaymentIntent.
 *
 * The order is marked paid strictly from the `payment_intent.succeeded` webhook, verified
 * with Stripe's signature. The browser returning to a success URL proves nothing — a shopper
 * can visit that URL directly — and 3-D Secure means the browser can be redirected away
 * mid-payment anyway.
 */

let client = null
function stripe() {
  if (!env.payments.stripe.enabled) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY).')
  }
  client ??= new Stripe(env.payments.stripe.secretKey, { apiVersion: '2024-06-20' })
  return client
}

// Stripe works in the minor unit. PKR is a two-decimal currency, so paisa.
const toMinorUnit = (amount) => Math.round(Number(amount) * 100)

/**
 * Create a PaymentIntent for an order.
 * @returns {{ providerRef: string, clientSecret: string, publishableKey: string }}
 */
export async function createPaymentIntent({ orderNumber, orderPublicId, amount, currency = 'PKR' }) {
  const intent = await stripe().paymentIntents.create({
    amount: toMinorUnit(amount),
    currency: currency.toLowerCase(),
    // Lets Stripe offer whatever card methods the account supports, without Mirwal
    // hard-coding a list that could drift from what's actually enabled.
    automatic_payment_methods: { enabled: true },
    description: `Mirwal order ${orderNumber}`,
    // Echoed back on the webhook, so a callback can be matched to an order without trusting
    // anything the browser sends.
    metadata: { orderNumber, orderPublicId },
  })

  return {
    providerRef: intent.id,
    clientSecret: intent.client_secret,
    publishableKey: env.payments.stripe.publishableKey,
  }
}

/**
 * Verify an inbound Stripe webhook and normalise it.
 *
 * `rawBody` must be the exact unparsed request body — Stripe signs the raw bytes, so any
 * JSON round-trip before this point invalidates the signature. See the express.raw() mount
 * in payments.routes.js.
 */
export function parseWebhook(rawBody, signatureHeader) {
  let event
  try {
    event = stripe().webhooks.constructEvent(rawBody, signatureHeader, env.payments.stripe.webhookSecret)
  } catch (error) {
    return { verified: false, failureReason: error.message }
  }

  const intent = event.data?.object ?? {}
  const card = intent.charges?.data?.[0]?.payment_method_details?.card
    ?? intent.latest_charge?.payment_method_details?.card
    ?? null

  return {
    verified: true,
    eventId: event.id,
    eventType: event.type,
    providerRef: intent.id ?? '',
    succeeded: event.type === 'payment_intent.succeeded',
    failed: event.type === 'payment_intent.payment_failed',
    failureReason: intent.last_payment_error?.message ?? '',
    amount: intent.amount != null ? intent.amount / 100 : null,
    cardBrand: card?.brand ?? '',
    cardLast4: card?.last4 ?? null,
  }
}

/**
 * Refund a captured PaymentIntent, in whole or in part.
 *
 * `idempotencyKey` is passed to Stripe so a retry of this exact refund — a network timeout
 * where Mirwal never learned the outcome, say — cannot pay the buyer twice. Mirwal uses the
 * refund's own public_id, which is unique per return request by database constraint.
 */
export async function createRefund({ paymentIntentId, amount, idempotencyKey, reason = 'requested_by_customer' }) {
  const refund = await stripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: toMinorUnit(amount),
      reason,
    },
    { idempotencyKey },
  )
  return {
    providerRef: refund.id,
    // 'succeeded' is immediate for most cards; 'pending' happens on some methods and is
    // resolved later by a charge.refunded webhook.
    succeeded: refund.status === 'succeeded',
    status: refund.status,
    failureReason: refund.failure_reason ?? '',
  }
}

/** Read a PaymentIntent back, used to reconcile an attempt whose webhook hasn't arrived. */
export async function retrievePaymentIntent(providerRef) {
  const intent = await stripe().paymentIntents.retrieve(providerRef)
  return {
    providerRef: intent.id,
    succeeded: intent.status === 'succeeded',
    status: intent.status,
    amount: intent.amount != null ? intent.amount / 100 : null,
  }
}
