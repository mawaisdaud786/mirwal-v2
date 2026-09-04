import { createHmac } from 'node:crypto'
import { env } from '../../../config/env.js'

/**
 * EasyPaisa — hosted-checkout ("Merchant Payment Gateway") integration.
 *
 * Flow mirrors JazzCash: Mirwal builds a signed form post, the shopper authorises on
 * EasyPaisa's page, and EasyPaisa returns them via `postBackURL`. The order is marked paid
 * only after the returned signature verifies, never on the browser's arrival alone.
 *
 * Signing: EasyPaisa's spec hashes an ampersand-joined `key=value` string of the request
 * fields in a documented order, keyed by the merchant hash key. Unlike JazzCash it is
 * key=value rather than values-only, and the field order is fixed by the spec rather than
 * sorted — an easy detail to get wrong, and the first thing to check if the gateway rejects
 * a request.
 *
 * ACCURACY CAVEAT: built from EasyPaisa's publicly documented gateway spec as I understand
 * it, without access to your merchant integration sheet. Verify a real sandbox transaction
 * before going live.
 */

/** `YYYY-MM-DD HH:mm:ss` in Pakistan Standard Time (UTC+5). */
function pktDateTime(date = new Date(), offsetMinutes = 0) {
  const pkt = new Date(date.getTime() + (5 * 60 + offsetMinutes) * 60 * 1000)
  return pkt.toISOString().replace('T', ' ').slice(0, 19)
}

// The order EasyPaisa's spec hashes these in. Not alphabetical — do not "tidy" this.
const SIGNED_FIELD_ORDER = [
  'amount',
  'autoRedirect',
  'orderRefNum',
  'paymentMethod',
  'postBackURL',
  'storeId',
  'timeStamp',
]

export function signature(fields) {
  const hashKey = env.payments.easypaisa.hashKey
  const message = SIGNED_FIELD_ORDER
    .filter((key) => fields[key] !== undefined && fields[key] !== null && String(fields[key]) !== '')
    .map((key) => `${key}=${fields[key]}`)
    .join('&')
  return createHmac('sha256', hashKey).update(message).digest('base64')
}

/**
 * Build the signed field set the browser posts to EasyPaisa.
 * @returns {{ postUrl: string, fields: object, providerRef: string }}
 */
export function buildCheckout({ orderNumber, amount, returnUrl }) {
  // Unique per attempt, not per order — a retry after a failure needs its own reference.
  const providerRef = `${orderNumber}-${Date.now().toString(36).toUpperCase()}`

  const fields = {
    storeId: env.payments.easypaisa.storeId,
    orderRefNum: providerRef,
    // EasyPaisa expects the major unit with two decimals, unlike JazzCash's paisa integer.
    amount: Number(amount).toFixed(2),
    postBackURL: returnUrl,
    timeStamp: pktDateTime(),
    paymentMethod: 'MA_PAYMENT_METHOD',
    autoRedirect: '1',
  }
  fields.merchantHashedReq = signature(fields)

  return {
    postUrl: `${env.payments.easypaisa.baseUrl}/easypay/Index.jsf`,
    fields,
    providerRef,
  }
}

/**
 * Verify an inbound EasyPaisa callback and normalise it.
 * `status`/`respCode` of '0000' is EasyPaisa's success code.
 */
export function parseCallback(body) {
  const received = body?.merchantHashedResp ?? body?.merchantHashedReq
  const expected = signature(body ?? {})
  const verified = Boolean(received) && String(received) === expected

  const code = body?.respCode ?? body?.status ?? ''
  return {
    verified,
    providerRef: body?.orderRefNum ?? '',
    // EasyPaisa sends no distinct event id; the order reference is the idempotency key.
    eventId: body?.orderRefNum ?? '',
    eventType: `easypaisa.${code || 'unknown'}`,
    succeeded: code === '0000',
    failureReason: code === '0000' ? '' : (body?.respDesc ?? 'Payment was not completed.'),
    amount: body?.amount ? Number(body.amount) : null,
  }
}
