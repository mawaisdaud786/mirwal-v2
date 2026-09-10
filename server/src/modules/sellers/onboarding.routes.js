import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './applications.controller.js'
import { submitApplicationSchema, resubmitApplicationSchema } from './applications.schemas.js'

/**
 * Becoming a seller.
 *
 * Mounted outside `/seller`, which is scoped to people who already have a store: an applicant
 * is a signed-in customer and `requireSeller` would refuse them at the door. That is why the
 * application form previously had nowhere to post to — the only seller-shaped router in the
 * system was one an applicant could not reach.
 *
 * The write routes carry their own limiter. The global one allows 300 requests a minute, which
 * is right for browsing and far too generous for submitting identity documents: a form that
 * accepts CNICs is a form worth stuffing, and a per-account cap makes that pointless without
 * getting in the way of anyone applying once.
 */
const applicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Per account rather than per IP: a shared office or a mobile carrier NAT puts many genuine
  // applicants behind one address, and rate-limiting them collectively would block real
  // sellers to inconvenience one attacker.
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
  },
})

export const onboardingRouter = Router()

onboardingRouter.use(requireAuth)

/** What this account still has to do before it can apply. Drives the storefront checklist. */
onboardingRouter.get('/requirements', controller.requirements)

/** The applicant's own application, including their identity details — it is their data. */
onboardingRouter.get('/application', controller.mine)

onboardingRouter.post(
  '/application',
  applicationLimiter,
  validate(submitApplicationSchema),
  controller.submit,
)

/** Supply what a reviewer asked for. Only valid from `more_info_required`. */
onboardingRouter.put(
  '/application',
  applicationLimiter,
  validate(resubmitApplicationSchema),
  controller.resubmit,
)

onboardingRouter.post('/application/withdraw', controller.withdraw)
