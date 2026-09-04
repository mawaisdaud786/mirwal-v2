import { ok } from '../../lib/errors.js'
import * as service from './payments.service.js'
import * as refundsService from './refunds.service.js'
import * as stripeProvider from './providers/stripe.js'
import * as easypaisaProvider from './providers/easypaisa.js'
import * as jazzcashProvider from './providers/jazzcash.js'

export async function listMethods(req, res, next) {
  try { return ok(res, service.availablePaymentMethods()) }
  catch (error) { return next(error) }
}

export async function start(req, res, next) {
  try { return ok(res, await service.startPayment(req.user.id, req.params.id, req.body.method)) }
  catch (error) { return next(error) }
}

export async function status(req, res, next) {
  try { return ok(res, await service.getPaymentStatusForOrder(req.user.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function listMyRefunds(req, res, next) {
  try { return ok(res, await refundsService.listRefundsForBuyer(req.user.id)) }
  catch (error) { return next(error) }
}

export async function listSellerManualRefunds(req, res, next) {
  try { return ok(res, await refundsService.listManualRefundsForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function settleSellerRefund(req, res, next) {
  try {
    const settled = await refundsService.markRefundSettledBySeller(req.seller.id, req.user.id, req.params.id)
    return ok(res, settled, 'Refund marked settled.')
  } catch (error) { return next(error) }
}

/**
 * Stripe webhook. Mounted with express.raw() — Stripe signs the exact bytes, so the body must
 * not be JSON-parsed before the signature is checked.
 *
 * Always answers 200 once the signature verifies, even for events Mirwal ignores: a non-2xx
 * makes Stripe retry indefinitely, and "I received this and chose not to act" is a success
 * from the delivery system's point of view.
 */
export async function stripeWebhook(req, res, next) {
  try {
    const parsed = stripeProvider.parseWebhook(req.body, req.get('stripe-signature'))
    if (!parsed.verified) {
      // Deliberately terse: an unverified caller learns nothing about why.
      return res.status(400).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } })
    }

    const fresh = await service.recordWebhookEvent('stripe', parsed.eventId, parsed.eventType, req.body.toString('utf8'))
    if (!fresh) return res.status(200).json({ received: true, duplicate: true })

    if (parsed.succeeded || parsed.failed) {
      await service.settleAttempt('stripe', parsed)
    }
    await service.markWebhookProcessed('stripe', parsed.eventId)
    return res.status(200).json({ received: true })
  } catch (error) { return next(error) }
}

/**
 * Wallet callbacks (EasyPaisa / JazzCash). Both post form-encoded fields back to Mirwal and
 * separately redirect the shopper's browser. The signature check is what makes a forged
 * "payment succeeded" post useless.
 */
function walletCallback(providerName, provider) {
  return async (req, res, next) => {
    try {
      const parsed = provider.parseCallback(req.body)
      if (!parsed.verified) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } })
      }

      const fresh = await service.recordWebhookEvent(providerName, parsed.eventId, parsed.eventType, req.body)
      if (fresh) {
        await service.settleAttempt(providerName, parsed)
        await service.markWebhookProcessed(providerName, parsed.eventId)
      }
      return res.status(200).json({ received: true })
    } catch (error) { return next(error) }
  }
}

export const easypaisaCallback = walletCallback('easypaisa', easypaisaProvider)
export const jazzcashCallback = walletCallback('jazzcash', jazzcashProvider)
