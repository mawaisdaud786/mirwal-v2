import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../../config/env.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import {
  loginSchema, registerSchema, updateProfileSchema, changePasswordSchema, sessionIdSchema,
  requestResetSchema, resetPasswordSchema,
} from './auth.schemas.js'
import { twoFactorCodeSchema, passwordConfirmSchema } from '../admin/platform.schemas.js'
import { messagingLimiter } from '../../middleware/rateLimit.js'
import * as controller from './auth.controller.js'
import * as verificationController from './verification.controller.js'

// Credential endpoints get a much tighter limit than the rest of the API — this is the
// brute-force surface. Successful requests are not counted against the limit.
const credentialLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.authMax,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
})

export const authRouter = Router()

authRouter.post('/register', credentialLimiter, validate(registerSchema), controller.register)
authRouter.post('/login',    credentialLimiter, validate(loginSchema),    controller.login)
/**
 * Password reset.
 *
 * Both carry the credential limiter: the request route because it sends email and would
 * otherwise be a way to flood someone's inbox, and the reset route because it compares a
 * secret. The request route always replies the same way whether or not the address has an
 * account, so it cannot be used to discover who shops on Mirwal.
 */
authRouter.post('/forgot-password', credentialLimiter, validate(requestResetSchema), controller.requestPasswordReset)
authRouter.post('/reset-password',  credentialLimiter, validate(resetPasswordSchema), controller.resetPassword)

authRouter.post('/refresh',  controller.refresh)
authRouter.post('/logout',   controller.logout)
authRouter.get ('/me',       requireAuth, controller.me)
authRouter.patch('/me',     requireAuth, validate(updateProfileSchema), controller.updateMe)

/**
 * Account security, for the signed-in customer.
 *
 * Every route here acts on the caller's own account and takes no user id — enrolling a second
 * factor or ending a session for somebody else is not a coherent operation, and an endpoint
 * that accepted an id would be one authorisation slip away from an account takeover.
 *
 * The password and code routes carry the credential limiter: they compare secrets, so they
 * belong on the brute-force surface with login rather than on the general limit.
 */
authRouter.patch('/me/password', requireAuth, credentialLimiter, validate(changePasswordSchema), controller.changePassword)
authRouter.get('/me/sessions', requireAuth, controller.listSessions)
authRouter.delete('/me/sessions/:id', requireAuth, validate(sessionIdSchema, 'params'), controller.revokeSession)

authRouter.get('/me/two-factor', requireAuth, controller.twoFactorStatus)
authRouter.post('/me/two-factor/setup', requireAuth, controller.beginTwoFactor)
authRouter.post('/me/two-factor/confirm', requireAuth, credentialLimiter, validate(twoFactorCodeSchema), controller.confirmTwoFactor)
authRouter.post('/me/two-factor/disable', requireAuth, credentialLimiter, validate(passwordConfirmSchema), controller.disableTwoFactor)
authRouter.post('/me/two-factor/backup-codes', requireAuth, credentialLimiter, validate(passwordConfirmSchema), controller.regenerateBackupCodes)

/**
 * Email and phone verification.
 *
 * `users.email_verified_at` and `phone_verified_at` have existed since migration 001 and were
 * written only by the seeder — there was no endpoint that could set them, so every account was
 * formally unverified and the seller-application gate had nothing to check.
 *
 * `confirm-email` is the only one outside `requireAuth`: the link is clicked from an inbox,
 * frequently in a browser with no Mirwal session, and the single-use token is the proof.
 */
authRouter.post('/verify/confirm-email', credentialLimiter, validate(verificationController.confirmLinkSchema), verificationController.confirmLink)

authRouter.get('/me/verification', requireAuth, verificationController.status)
/**
 * `messagingLimiter` sits alongside the credential limiter rather than replacing it: the
 * credential one skips successful requests, so on its own a script could send a hundred real
 * emails an hour as long as every one of them worked. This is the ceiling on sends.
 */
authRouter.post('/me/verification/request', requireAuth, credentialLimiter, messagingLimiter, validate(verificationController.purposeSchema), verificationController.request)
authRouter.post('/me/verification/confirm', requireAuth, credentialLimiter, validate(verificationController.confirmSchema), verificationController.confirm)
