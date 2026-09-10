import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import * as cases from './cases.service.js'
import * as enforcement from './enforcement.service.js'
import * as reviewModeration from '../reviews/moderation.service.js'
import * as scoring from './scoring.service.js'

/**
 * Trust and safety endpoints.
 *
 * The public report route uses `optionalAuth`, not `requireAuth`, matching the decision
 * `product_reports` already made: a shopper who has not signed in can still be looking at a
 * counterfeit, and refusing their report loses the signal entirely.
 */

export const createCaseSchema = z.object({
  caseType: z.enum(['product', 'seller', 'store', 'review', 'order', 'payment', 'fraud', 'counterfeit', 'policy', 'other']),
  subjectType: z.enum(['product', 'seller', 'store', 'review', 'order', 'payment', 'none']).optional().default('none'),
  subjectId: z.string().trim().max(64).optional().nullable(),
  reasonCode: z.string().trim().max(60).optional().nullable(),
  details: z.string().trim().min(10, 'Tell us what is wrong, in a sentence or two.').max(4000),
  // For an anonymous reporter who wants to hear the outcome. Optional: requiring it would
  // suppress exactly the reports from people who do not want to be identified.
  reporterEmail: z.string().trim().toLowerCase().email().max(255).optional().nullable(),
})

export const listCasesSchema = z.object({
  status: z.enum(['reported', 'under_review', 'more_info_required', 'action_taken', 'resolved', 'rejected', 'appealed', 'closed']).optional(),
  caseType: z.string().trim().max(30).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedToMe: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  sellerId: z.string().trim().max(36).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})

export const caseIdSchema = z.object({ id: z.string().trim().min(1).max(36) })

export const caseMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().optional().default(false),
})

export const resolveCaseSchema = z.object({
  status: z.enum(['action_taken', 'resolved', 'rejected']),
  resolutionCode: z.string().trim().min(1).max(60),
  note: z.string().trim().max(2000).optional().nullable(),
})

export const enforcementSchema = z.object({
  actionType: z.enum([
    'warning', 'product_removed', 'listing_restricted', 'payout_held',
    'store_restricted', 'store_suspended', 'store_banned', 'review_removed',
    'penalty', 'reinstated',
  ]),
  reasonCode: z.string().trim().min(1).max(60),
  note: z.string().trim().max(2000).optional().nullable(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  expiresAt: z.string().trim().datetime({ offset: true }).optional().nullable(),
  /**
   * The case this action came out of, by public id.
   *
   * Was a positive integer — the row's auto-increment id. Every other identifier this API
   * accepts is a `public_id`, for two reasons that apply here too: an auto-increment id is
   * guessable, and it is not stable across a restore. Resolving the public id to the internal
   * one is the service's job, not the caller's.
   */
  caseId: z.string().trim().max(36).optional().nullable(),
})

export const appealDecisionSchema = z.object({
  upheld: z.boolean(),
  note: z.string().trim().max(2000).optional().nullable(),
})

export const moderateReviewSchema = z.object({
  status: z.enum(['published', 'hidden', 'removed']),
  code: z.string().trim().max(60).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
})

export const reportReviewSchema = z.object({
  reason: z.enum(['spam', 'offensive', 'fake', 'off_topic', 'personal_information', 'incentivised', 'competitor', 'other']),
  details: z.string().trim().max(1000).optional().nullable(),
})

export const reviewQueueSchema = z.object({
  status: z.enum(['published', 'pending', 'hidden', 'removed']).optional(),
  reportedOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})

// --- scoring -----------------------------------------------------------------

export async function sellerScores(req, res, next) {
  try { return ok(res, await scoring.scoresForAdmin(req.params.id)) }
  catch (error) { return next(error) }
}

export async function riskQueue(req, res, next) {
  try { return ok(res, await scoring.riskiestSellers({ limit: 50 })) }
  catch (error) { return next(error) }
}

/** A seller's own standing. Trust only — see the note in scoring.service.js. */
export async function myTrust(req, res, next) {
  try { return ok(res, await scoring.trustForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

// --- public / reporter -------------------------------------------------------

export async function report(req, res, next) {
  try {
    const result = await cases.createCase({
      ...req.body,
      subjectType: req.body.subjectType === 'none' ? null : req.body.subjectType,
      reporterId: req.user?.id ?? null,
      reporterEmail: req.body.reporterEmail ?? null,
      reporterSide: req.user ? 'buyer' : 'anonymous',
    })
    return ok(res, result, 'Thank you — Mirwal will look into this.', 201)
  } catch (error) { return next(error) }
}

export async function myReports(req, res, next) {
  try {
    const { items, total } = await cases.listMine(req.user.id, req.validatedQuery ?? {})
    return okPage(res, items, {
      page: req.validatedQuery?.page ?? 1,
      pageSize: req.validatedQuery?.pageSize ?? 25,
      total,
    })
  } catch (error) { return next(error) }
}

export async function reportReview(req, res, next) {
  try {
    const result = await reviewModeration.reportReview(req.params.id, req.body, {
      userId: req.user?.id ?? null,
      side: req.seller ? 'seller' : 'buyer',
    })
    return ok(res, result, 'Thank you — Mirwal will review this.', 201)
  } catch (error) { return next(error) }
}

export async function voteHelpful(req, res, next) {
  try { return ok(res, await reviewModeration.voteHelpful(req.params.id, req.user.id)) }
  catch (error) { return next(error) }
}

// --- staff: cases ------------------------------------------------------------

export async function list(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await cases.listCases({ page, pageSize, ...filters, userId: req.user.id })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function stats(_req, res, next) {
  try { return ok(res, await cases.caseStats()) }
  catch (error) { return next(error) }
}

export async function detail(req, res, next) {
  try { return ok(res, await cases.getCase(req.params.id)) }
  catch (error) { return next(error) }
}

export async function assign(req, res, next) {
  try {
    const result = await cases.assignCase(req.params.id, req.user.id)
    await recordAudit(req, { action: AUDIT.CASE_ASSIGNED, entityType: 'case', entityId: req.params.id })
    return ok(res, result, 'Case assigned to you.')
  } catch (error) { return next(error) }
}

export async function message(req, res, next) {
  try {
    const result = await cases.addMessage(req.params.id, req.body, { userId: req.user.id, side: 'staff' })
    return ok(res, result, req.body.isInternal ? 'Internal note added.' : 'Reply sent.')
  } catch (error) { return next(error) }
}

export async function resolve(req, res, next) {
  try {
    const result = await cases.resolveCase(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.CASE_RESOLVED, entityType: 'case', entityId: req.params.id,
      metadata: { status: req.body.status, code: req.body.resolutionCode },
    })
    return ok(res, result, `Case ${result.reference} ${result.status.replace('_', ' ')}.`)
  } catch (error) { return next(error) }
}

// --- staff: enforcement ------------------------------------------------------

export async function enforce(req, res, next) {
  try {
    const result = await enforcement.act(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: req.body.actionType === 'store_banned' ? AUDIT.SELLER_BANNED : AUDIT.SELLER_RESTRICTED,
      entityType: 'seller',
      entityId: req.params.id,
      metadata: {
        actionType: req.body.actionType,
        reasonCode: req.body.reasonCode,
        productsAffected: result.productsAffected,
      },
    })
    return ok(res, result, `${result.storeName}: ${req.body.actionType.replace('_', ' ')} recorded and the seller notified.`)
  } catch (error) { return next(error) }
}

export async function sellerHistory(req, res, next) {
  try {
    const { items, total } = await enforcement.history(req.params.id, req.validatedQuery ?? {})
    return okPage(res, items, {
      page: req.validatedQuery?.page ?? 1,
      pageSize: req.validatedQuery?.pageSize ?? 50,
      total,
    })
  } catch (error) { return next(error) }
}

export async function decideAppeal(req, res, next) {
  try {
    const result = await enforcement.decideAppeal(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.CASE_ACTIONED, entityType: 'enforcement_action', entityId: req.params.id,
      metadata: { appeal: result.status },
    })
    return ok(res, result, `Appeal ${result.status}.`)
  } catch (error) { return next(error) }
}

// --- staff: review moderation ------------------------------------------------

export async function reviewQueue(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await reviewModeration.listForModeration({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function moderateReview(req, res, next) {
  try {
    const result = await reviewModeration.moderateReview(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.REVIEW_MODERATED, entityType: 'review', entityId: req.params.id,
      metadata: { status: req.body.status, code: req.body.code ?? null },
    })
    return ok(res, result, `Review ${result.status}.`)
  } catch (error) { return next(error) }
}

export async function reviewPatterns(_req, res, next) {
  try { return ok(res, await reviewModeration.suspiciousPatterns({ days: 30 })) }
  catch (error) { return next(error) }
}

// --- seller ------------------------------------------------------------------

export async function myCompliance(req, res, next) {
  try {
    const [active, past] = await Promise.all([
      enforcement.activeActions(req.seller.id),
      enforcement.history(req.seller.id, { pageSize: 50 }),
    ])
    return ok(res, {
      status: req.seller.status,
      restricted: Boolean(req.seller.restricted),
      restrictedUntil: req.seller.restricted_until ?? null,
      payoutHold: Boolean(req.seller.payout_hold),
      active,
      history: past.items,
    })
  } catch (error) { return next(error) }
}

export async function appeal(req, res, next) {
  try {
    const result = await enforcement.appeal(req.seller.id, req.params.id, req.body)
    return ok(res, result, 'Your appeal has been submitted. Mirwal will review it.')
  } catch (error) { return next(error) }
}

export async function respondToReview(req, res, next) {
  try {
    const result = await reviewModeration.respondToReview(req.seller.id, req.params.id, req.body)
    return ok(res, result, result.updated ? 'Your response was updated.' : 'Your response is now public.')
  } catch (error) { return next(error) }
}
