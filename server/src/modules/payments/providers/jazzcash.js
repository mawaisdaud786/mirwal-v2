import { createHmac } from 'node:crypto'
import { env } from '../../../config/env.js'

/**
 * JazzCash — hosted-checkout ("Page Redirection") integration.
 *
 * Flow: Mirwal builds a signed form post, the shopper's browser submits it to JazzCash, they
 * authorise on JazzCash's own page, and JazzCash both redirects the browser back and (for a
 * correctly configured merchant) posts a server-to-server callback. Mirwal marks the order
 * paid ONLY from a signature-verified callback, never from the browser's return.
 *
 * Signing: every request and response carries `pp_SecureHash`, an HMAC-SHA256 over the
 * ampersand-joined values of all non-empty `pp_*` fields sorted by field name, keyed by the
 * merchant integrity salt. Verifying it on the way back in is what makes a forged "payment
 * succeeded" callback useless to an attacker.
 *
 * ACCURACY CAVEAT: field names and the exact hash recipe here follow JazzCash's publicly
 * documented v2.0 Page Redirection spec as I understand it, built without access to your
 * merchant documentation. Sandbox-verify a real transaction end to end before going live; if
 * JazzCash rejects the hash, the ordering/inclusion rule in `signature()` is the first thing
 * to check against their integration sheet.
 */

const AMOUNT_MULTIPLIER = 100 // JazzCash amounts are in the minor unit (paisa)

/** `YYYYMMDDHHmmss` in Pakistan Standard Time (UTC+5), which is what JazzCash expects. */
function pktTimestamp(date = new Date(), offsetMinutes = 0) {
  const pkt = new Date(date.getTime() + (5 * 60 + offsetMinutes) * 60 * 1000)
  return pkt.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/**
 * HMAC-SHA256 over every non-empty pp_* field, sorted by key, joined with '&', prefixed by
 * the salt. Excludes pp_SecureHash itself.
 */
export function signature(fields) {
  const salt = env.payments.jazzcash.integritySalt
  const ordered = Object.keys(fields)
    .filter((key) => key !== 'pp_SecureHash')
    .filter((key) => fields[key] !== undefined && fields[key] !== null && String(fields[key]) !== '')
    .sort()
    .map((key) => String(fields[key]))
  const message = [salt, ...ordered].join('&')
  return createHmac('sha256', salt).update(message).digest('hex').toUpperCase()
}

/**
 * Build the signed field set the browser posts to JazzCash.
 * @returns {{ postUrl: string, fields: object, providerRef: string }}
 */
export function buildCheckout({ orderNumber, amount, description, returnUrl }) {
  const now = new Date()
  // Transaction reference must be unique per attempt, not per order — a retried payment on
  // the same order needs its own reference or JazzCash rejects it as a duplicate.
  const providerRef = `T${pktTimestamp(now)}${Math.floor(Math.random() * 900 + 100)}`

  const fields = {
    pp_Version: '2.0',
    pp_TxnType: 'MWALLET',
    pp_Language: 'EN',
    pp_MerchantID: env.payments.jazzcash.merchantId,
    pp_Password: env.payments.jazzcash.password,
    pp_TxnRefNo: providerRef,
    pp_Amount: String(Math.round(Number(amount) * AMOUNT_MULTIPLIER)),
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: pktTimestamp(now),
    // JazzCash requires an expiry window; one hour is comfortably longer than a checkout.
    pp_TxnExpiryDateTime: pktTimestamp(now, 60),
    pp_BillReference: orderNumber,
    pp_Description: description,
    pp_ReturnURL: returnUrl,
    ppmpf_1: orderNumber,
  }
  fields.pp_SecureHash = signature(fields)

  return {
    postUrl: `${env.payments.jazzcash.baseUrl}/CustomerPortal/transactionmanagement/merchantform`,
    fields,
    providerRef,
  }
}

/**
 * Verify an inbound JazzCash callback and normalise it.
 *
 * `pp_ResponseCode === '000'` is JazzCash's success code; anything else is a real failure
 * with `pp_ResponseMessage` explaining why.
 */
export function parseCallback(body) {
  const received = body?.pp_SecureHash
  const expected = signature(body ?? {})
  const verified = Boolean(received) && String(received).toUpperCase() === expected

  return {
    verified,
    providerRef: body?.pp_TxnRefNo ?? '',
    // JazzCash does not send a separate event id, so the transaction reference doubles as
    // the idempotency key for payment_webhook_events.
    eventId: body?.pp_TxnRefNo ?? '',
    eventType: `jazzcash.${body?.pp_ResponseCode ?? 'unknown'}`,
    succeeded: body?.pp_ResponseCode === '000',
    failureReason: body?.pp_ResponseCode === '000' ? '' : (body?.pp_ResponseMessage ?? 'Payment was not completed.'),
    // Amount comes back in paisa; convert to the major unit so it can be compared against the
    // order total the server itself computed.
    amount: body?.pp_Amount ? Number(body.pp_Amount) / AMOUNT_MULTIPLIER : null,
  }
}
