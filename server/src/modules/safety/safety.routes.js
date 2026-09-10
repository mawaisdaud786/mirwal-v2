import { Router } from 'express'
import { optionalAuth, requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { reportLimiter } from '../../middleware/rateLimit.js'
import * as controller from './safety.controller.js'

/**
 * Public reporting.
 *
 * Mounted outside every authenticated namespace, because the most valuable report is often
 * from someone who has not signed in — a shopper who spots a counterfeit while browsing. That
 * is the same judgement `product_reports` already made, extended to every subject.
 *
 * The trade is that an open write endpoint can be stuffed, so it carries the shared report
 * limiter, which keys on the account when there is one and on the address when there is not.
 */
export const safetyRouter = Router()

/** File a report about anything. Signed in or not. */
safetyRouter.post(
  '/reports',
  optionalAuth,
  reportLimiter,
  validate(controller.createCaseSchema),
  controller.report,
)

/** What I have reported, and what came of it. */
safetyRouter.get('/reports/mine', requireAuth, validate(controller.listCasesSchema, 'query'), controller.myReports)

/**
 * Report a review, and vote one helpful.
 *
 * Reporting is open to signed-out visitors for the same reason the rest of this router is;
 * voting is not, because an anonymous vote count is trivially inflated and worth nothing.
 */
safetyRouter.post(
  '/reviews/:id/report',
  optionalAuth,
  reportLimiter,
  validate(controller.caseIdSchema, 'params'),
  validate(controller.reportReviewSchema),
  controller.reportReview,
)

safetyRouter.post(
  '/reviews/:id/helpful',
  requireAuth,
  validate(controller.caseIdSchema, 'params'),
  controller.voteHelpful,
)
