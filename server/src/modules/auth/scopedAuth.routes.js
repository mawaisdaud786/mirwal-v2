import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../../config/env.js'
import { ok } from '../../lib/errors.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../../lib/tokens.js'
import { loginSchema } from './auth.schemas.js'
import * as service from './auth.service.js'
import { authenticateForScope, rotateForScope } from './scopedAuth.js'

/**
 * Builds the `/admin/auth/*` or `/seller/auth/*` namespace.
 *
 * Each application gets its own login, refresh, logout and session route, its own
 * path-scoped refresh cookie, and its own brute-force limiter. Sharing one login endpoint
 * across all three applications would mean a single leaked customer password is one role
 * check away from the admin panel; here the admin endpoint refuses to issue a session to a
 * non-admin at all.
 *
 * @param {'admin'|'seller'} scope
 * @param {string[]} sessionRoles roles allowed to read the session endpoint
 */
export function createScopedAuthRouter(scope, sessionRoles) {
  const router = Router()

  // Tighter than the storefront's limiter: these endpoints are a much higher-value target,
  // and legitimate staff/seller sign-ins are far rarer than shopper sign-ins.
  const limiter = rateLimit({
    windowMs: env.rateLimit.windowMs,
    limit: Math.max(5, Math.floor(env.rateLimit.authMax / 2)),
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
  })

  const context = (req) => ({ userAgent: req.get('user-agent'), ip: null })

  router.post('/login', limiter, validate(loginSchema), async (req, res, next) => {
    try {
      const { user, authorization, publicUser } = await authenticateForScope(scope, req.body)
      const tokens = await service.issueTokens(user, authorization, context(req))
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpires, scope)
      return ok(res, { user: publicUser, accessToken: tokens.accessToken }, 'Signed in.')
    } catch (error) { return next(error) }
  })

  router.post('/refresh', async (req, res, next) => {
    try {
      const result = await rotateForScope(scope, readRefreshCookie(req, scope), context(req))
      setRefreshCookie(res, result.refreshToken, result.refreshExpires, scope)
      return ok(res, { user: result.publicUser, accessToken: result.accessToken })
    } catch (error) { return next(error) }
  })

  router.post('/logout', async (req, res, next) => {
    try {
      await service.revokeRefreshToken(readRefreshCookie(req, scope))
      clearRefreshCookie(res, scope)
      return ok(res, null, 'Signed out.')
    } catch (error) { return next(error) }
  })

  router.get('/session', requireAuth, requireRole(...sessionRoles), async (req, res, next) => {
    try {
      return ok(res, { user: await service.getCurrentUser(req.user.id) })
    } catch (error) { return next(error) }
  })

  return router
}
