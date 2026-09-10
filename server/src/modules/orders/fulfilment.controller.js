import { z } from 'zod'
import { notFound, ok } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import * as cancellation from './cancellation.service.js'
import * as invoices from './invoices.service.js'
import * as messages from './messages.service.js'
import { createDiscretionaryRefund } from '../payments/refunds.service.js'
import { queryOne } from '../../db/pool.js'

/**
 * Partial cancellation, invoices, and the buyer-seller conversation.
 *
 * One controller for three features because they are three views of the same object — the order
 * after it has been placed — and splitting them across three files would mean three copies of
 * the same id resolution and the same ownership checks.
 */

// --- schemas -----------------------------------------------------------------

// The id shapes live in `orders.schemas.js`; re-exported here so a route file needs one import
// for the whole feature rather than two that must agree.
export { orderItemIdSchema, orderIdSchema } from './orders.schemas.js'

export const threadParamsSchema = z.object({
  id: z.string().trim().uuid(),
  sellerId: z.string().trim().uuid(),
})

/**
 * Cancelling.
 *
 * `quantity` is optional and means "all of it" when absent, so the existing full-cancel callers
 * keep working unchanged and the partial case is the addition rather than a migration.
 */
export const buyerCancelSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(1000).optional(),
  reason: z.string().trim().max(255).optional().nullable(),
})

// A seller must say why. The buyer is shown it, and "cancelled" with no explanation is the
// single most complained-about experience on any marketplace.
export const sellerCancelSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(1000).optional(),
  reason: z.string().trim().min(3, 'Tell the buyer why you cannot supply this.').max(255),
})

export const adminCancelSchema = sellerCancelSchema.extend({
  // Whose record carries it. An operator cancelling for a seller who telephoned is still the
  // seller's failure; attributing it to Mirwal would launder a bad seller's statistics.
  onBehalfOf: z.enum(['buyer', 'seller', 'admin']).optional().default('admin'),
})

export const manualRefundSchema = z.object({
  amount: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 500 or 500.00'),
  reason: z.string().trim().min(3, 'Say what this refund is for — it goes on the record.').max(255),
  kind: z.enum(['goodwill', 'chargeback']).optional().default('goodwill'),
})

export const messageSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(4000),
})

export const adminMessageSchema = messageSchema.extend({
  isInternal: z.boolean().optional().default(false),
})

export const threadListSchema = z.object({
  unreadOnly: z.coerce.boolean().optional().default(false),
})

// --- cancellation ------------------------------------------------------------

export async function cancelAsBuyer(req, res, next) {
  try {
    const result = await cancellation.cancelByBuyer(req.user.id, Number(req.params.id), req.body)
    return ok(res, result, result.remainingQuantity > 0
      ? `Cancelled ${result.cancelledQuantity}. ${result.remainingQuantity} still on the way.`
      : 'That item has been cancelled.')
  } catch (error) { return next(error) }
}

export async function cancelAsSeller(req, res, next) {
  try {
    const result = await cancellation.cancelBySeller(
      req.seller.id, req.user.id, Number(req.params.id), req.body,
    )
    return ok(res, result, 'The buyer has been told and refunded where anything was paid.')
  } catch (error) { return next(error) }
}

export async function cancelAsAdmin(req, res, next) {
  try {
    const result = await cancellation.cancelByAdmin(req.user.id, Number(req.params.id), req.body)
    await recordAudit(req, {
      action: AUDIT.ORDER_ITEM_CANCELLED,
      entityType: 'order_item',
      entityId: String(req.params.id),
      metadata: { quantity: result.cancelledQuantity, attributedTo: result.attributedTo, reason: req.body.reason },
    })
    return ok(res, result, 'Cancelled, and both parties have been told.')
  } catch (error) { return next(error) }
}

// --- discretionary refund ----------------------------------------------------

export async function refundManually(req, res, next) {
  try {
    const order = await queryOne('SELECT id FROM orders WHERE public_id = ?', [req.params.id])
    if (!order) throw notFound('Order not found.')

    const refund = await createDiscretionaryRefund({
      orderId: order.id,
      amount: req.body.amount,
      kind: req.body.kind,
      reason: req.body.reason,
      createdByUserId: req.user.id,
    })
    await recordAudit(req, {
      action: AUDIT.REFUND_ISSUED,
      entityType: 'order',
      entityId: req.params.id,
      metadata: { amount: req.body.amount, kind: req.body.kind, reason: req.body.reason },
    })
    return ok(res, refund, refund.status === 'manual_required'
      ? 'Recorded. This one has to be paid by hand — it is in the manual refunds queue.'
      : 'Refund issued.')
  } catch (error) { return next(error) }
}

// --- invoices ----------------------------------------------------------------

export async function invoiceForBuyer(req, res, next) {
  try { return ok(res, await invoices.forBuyer(req.user.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function invoiceForAdmin(req, res, next) {
  try {
    const invoice = await invoices.forAdmin(req.params.id)
    const order = await queryOne('SELECT id FROM orders WHERE public_id = ?', [req.params.id])
    // Credit notes sit against the invoice rather than inside it: the invoice stands, and a
    // refund does not rewrite what was charged.
    return ok(res, { ...invoice, credits: await invoices.creditsForOrder(order.id) })
  } catch (error) { return next(error) }
}

// --- conversation ------------------------------------------------------------

export async function buyerThreads(req, res, next) {
  try { return ok(res, await messages.threadsForBuyer(req.user.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function buyerRead(req, res, next) {
  try { return ok(res, await messages.readAsBuyer(req.user.id, req.params.id, req.params.sellerId)) }
  catch (error) { return next(error) }
}

export async function buyerWrite(req, res, next) {
  try {
    await messages.writeAsBuyer(req.user.id, req.params.id, req.params.sellerId, req.body)
    return ok(res, { sent: true }, 'Sent to the store.', 201)
  } catch (error) { return next(error) }
}

export async function sellerThreads(req, res, next) {
  try { return ok(res, await messages.threadsForSeller(req.seller.id, req.validatedQuery)) }
  catch (error) { return next(error) }
}

export async function sellerUnread(req, res, next) {
  try { return ok(res, await messages.unreadCountForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function sellerRead(req, res, next) {
  try { return ok(res, await messages.readAsSeller(req.seller.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function sellerWrite(req, res, next) {
  try {
    await messages.writeAsSeller(req.seller.id, req.user.id, req.params.id, req.body)
    return ok(res, { sent: true }, 'Sent to the buyer.', 201)
  } catch (error) { return next(error) }
}

export async function adminRead(req, res, next) {
  try { return ok(res, await messages.readAsAdmin(req.params.id, req.params.sellerId)) }
  catch (error) { return next(error) }
}

export async function adminWrite(req, res, next) {
  try {
    await messages.writeAsAdmin(req.user.id, req.params.id, req.params.sellerId, req.body)
    return ok(res, { sent: true }, req.body.isInternal
      ? 'Note saved. Neither party can see it.'
      : 'Sent to both the buyer and the store.', 201)
  } catch (error) { return next(error) }
}
