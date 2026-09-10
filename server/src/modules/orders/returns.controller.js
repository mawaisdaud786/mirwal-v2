import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import * as returns from './returns.service.js'
import { findOwnedOrderItem } from './orders.service.js'

/**
 * Returns, from all three sides.
 *
 * The reasons are a closed list rather than free text. It was a `VARCHAR(100)` the storefront
 * filled with a sentence — "No longer needed" — which is unusable for the two things a reason
 * is actually for: deciding who pays return carriage, and measuring whether a store's returns
 * are its own fault. A sentence cannot be counted.
 */

/** Faults are separated from preferences, because only the first kind is the seller's problem. */
export const RETURN_REASONS = [
  'damaged', 'faulty', 'wrong_item', 'not_as_described', 'counterfeit', 'missing_parts',
  'changed_mind', 'size_or_fit', 'found_cheaper', 'arrived_late', 'other',
]

export const createSchema = z.object({
  reason: z.enum(RETURN_REASONS),
  description: z.string().trim().max(1000).optional().default(''),
  returnType: z.enum(['refund', 'replacement', 'repair']).optional().default('refund'),
})

export const idSchema = z.object({ id: z.string().trim().min(1).max(36) })

export const postedSchema = z.object({
  carrierId: z.coerce.number().int().positive().optional().nullable(),
  tracking: z.string().trim().min(3).max(80),
})

export const escalateSchema = z.object({
  note: z.string().trim().min(20, 'Tell Mirwal what happened, in a sentence or two.').max(4000),
})

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().optional().default(false),
})

/**
 * The seller's move.
 *
 * `refundAmount` is a string for the same reason every other money field in this codebase is:
 * a decimal that has been through a float is a decimal that has been rounded by something
 * other than us.
 */
export const advanceSchema = z.object({
  status: z.enum(['more_info_required', 'approved', 'rejected', 'received', 'refunded', 'replaced']),
  note: z.string().trim().max(1000).optional().nullable(),
  refundAmount: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 1499 or 1499.00').optional().nullable(),
  returnShippingPaidBy: z.enum(['buyer', 'seller', 'platform']).optional().nullable(),
})

export const listSchema = z.object({
  status: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})

export const decideSchema = z.object({
  outcome: z.enum(['upheld_buyer', 'upheld_seller', 'partial']),
  note: z.string().trim().max(1000).optional().nullable(),
  refundAmount: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/).optional().nullable(),
}).refine(
  // The seller is told this, and "your decision was overturned" with no reason attached is how
  // a seller learns nothing and disputes the next one identically.
  (value) => value.outcome !== 'upheld_seller' || (value.note && value.note.length >= 5),
  { message: 'Say why the seller’s decision stands — both sides are shown this.', path: ['note'] },
)

// --- buyer -------------------------------------------------------------------

export async function create(req, res, next) {
  try {
    const item = await findOwnedOrderItem(req.user.id, req.params.id)
    const result = await returns.createReturn(req.user.id, item, req.body)
    return ok(res, result, 'Your return request is with the seller.', 201)
  } catch (error) { return next(error) }
}

export async function mine(req, res, next) {
  try { return ok(res, await returns.listForBuyer(req.user.id)) }
  catch (error) { return next(error) }
}

export async function get(req, res, next) {
  try { return ok(res, await returns.getForBuyer(req.user.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function cancel(req, res, next) {
  try { return ok(res, await returns.cancelByBuyer(req.user.id, req.params.id), 'Return withdrawn.') }
  catch (error) { return next(error) }
}

export async function markPosted(req, res, next) {
  try {
    const result = await returns.markPosted(req.user.id, req.params.id, req.body)
    return ok(res, result, 'Thanks — the seller has been told it is on its way.')
  } catch (error) { return next(error) }
}

export async function escalate(req, res, next) {
  try {
    const result = await returns.escalate(req.user.id, req.params.id, req.body)
    return ok(res, result, 'Mirwal will look at this and come back to you.')
  } catch (error) { return next(error) }
}

/**
 * Buyers and sellers write to the same thread.
 *
 * Which side the author is on is worked out by the service from the return's own buyer and
 * seller ids, never from what the caller claims — a body field naming your own side is a
 * request to be impersonated.
 */
export async function reply(req, res, next) {
  try {
    await returns.postMessage(req.params.id, {
      userId: req.user.id,
      sellerId: req.seller?.id ?? null,
      body: req.body.body,
    })
    return ok(res, { added: true }, 'Sent.', 201)
  } catch (error) { return next(error) }
}

// --- seller ------------------------------------------------------------------

export async function sellerList(req, res, next) {
  try { return ok(res, await returns.listForSeller(req.seller.id, req.validatedQuery ?? {})) }
  catch (error) { return next(error) }
}

export async function sellerGet(req, res, next) {
  try { return ok(res, await returns.getForSeller(req.seller.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function advance(req, res, next) {
  try {
    const result = await returns.advanceBySeller(req.seller.id, req.user.id, req.params.id, req.body)
    return ok(res, result, `Return marked ${String(req.body.status).replace(/_/g, ' ')}.`)
  } catch (error) { return next(error) }
}

// --- Mirwal ------------------------------------------------------------------

export async function adminList(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total } = await returns.listEscalated({ page, pageSize, status: status || 'escalated' })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function adminGet(req, res, next) {
  try { return ok(res, await returns.getForAdmin(req.params.id)) }
  catch (error) { return next(error) }
}

export async function adminDecide(req, res, next) {
  try {
    const result = await returns.decide(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.RETURN_ADJUDICATED,
      entityType: 'return_request',
      entityId: req.params.id,
      metadata: { outcome: req.body.outcome, refundAmount: result.refundAmount?.amount ?? null },
    })
    return ok(res, result, 'Decision recorded and both sides told.')
  } catch (error) { return next(error) }
}

export async function adminNote(req, res, next) {
  try {
    await returns.postMessage(req.params.id, {
      userId: req.user.id,
      isAdmin: true,
      body: req.body.body,
      isInternal: req.body.isInternal,
    })
    return ok(res, { added: true }, req.body.isInternal ? 'Internal note added.' : 'Sent to both sides.', 201)
  } catch (error) { return next(error) }
}
