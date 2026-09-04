import { forbidden, unauthorized } from '../lib/errors.js'
import { verifyAccessToken } from '../lib/tokens.js'
import { queryOne } from '../db/pool.js'

/**
 * Authentication and authorization middleware.
 *
 * This is the layer the Phase 0 audit found missing. Previously `RequireRole` in App.jsx
 * read a role out of localStorage, so any visitor could grant themselves admin by typing
 * one line into the console. Nothing here trusts the client: the access token is verified
 * against a server-held secret, and the roles inside it were written by this server.
 */

/** Attach `req.user` when a valid bearer token is present. Does not reject. */
export function optionalAuth(req, _res, next) {
  const header = req.get('authorization') ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return next()

  try {
    const payload = verifyAccessToken(token)
    req.user = {
      id: Number(payload.sub),
      publicId: payload.pid,
      email: payload.email,
      roles: payload.roles ?? [],
      permissions: payload.perms ?? [],
    }
  } catch {
    // An invalid or expired token is treated as "not signed in" for optional routes.
  }
  return next()
}

/** Require a signed-in user. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized())
  return next()
}

/**
 * Require at least one of the listed roles.
 * `requireRole('admin', 'super_admin')`
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    const allowed = roles.some((role) => req.user.roles.includes(role))
    if (!allowed) return next(forbidden())
    return next()
  }
}

/**
 * Require a specific permission.
 * Preferred over requireRole for anything granular, so permissions can be re-assigned
 * between roles without touching route definitions.
 */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    const allowed = permissions.some((permission) => req.user.permissions.includes(permission))
    if (!allowed) return next(forbidden(`Missing permission: ${permissions.join(' or ')}`))
    return next()
  }
}

/**
 * Resolve the authenticated user's seller record and attach it as `req.seller`.
 *
 * Every seller-scoped route uses this, and every seller query filters on
 * `req.seller.id`. Holding the `seller` role is never sufficient on its own — it means
 * "may manage my own store", never "may manage any store". This is the mechanism that
 * makes Seller A -> Seller B access impossible rather than merely hidden.
 *
 * Admins are deliberately NOT auto-granted a seller context; admin routes act on sellers
 * explicitly and are audited.
 */
export async function requireSeller(req, _res, next) {
  try {
    if (!req.user) return next(unauthorized())

    const seller = await queryOne(
      `SELECT id, public_id, slug, store_name, status, seller_type, verification_level,
              payout_hold, vacation_mode, restricted_until, restricted_reason, verified_badge
         FROM sellers
        WHERE user_id = ? AND deleted_at IS NULL`,
      [req.user.id],
    )

    if (!seller) return next(forbidden('This account is not registered as a Mirwal seller.'))

    /**
     * A restricted store may still sign in.
     *
     * This is the difference between a restriction and a suspension, and getting it wrong is
     * how a marketplace turns an enforcement action into a customer-service disaster: a seller
     * who is locked out cannot ship the orders they already owe buyers, so the punishment
     * lands on the buyers. Restricted means "you may keep your promises but not make new
     * ones"; the write routes check `req.seller.restricted` and refuse there.
     */
    const restricted = seller.status === 'restricted'
      && (!seller.restricted_until || new Date(`${seller.restricted_until}Z`) > new Date())

    if (seller.status !== 'approved' && !restricted) {
      return next(forbidden(
        seller.status === 'pending' || seller.status === 'submitted' || seller.status === 'in_review'
          ? 'Your seller application is still under review.'
          : `Your seller account is ${seller.status}.`,
        'SELLER_NOT_ACTIVE',
      ))
    }

    req.seller = { ...seller, restricted }
    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Refuse a write from a restricted store.
 *
 * Mounted on the routes that create new obligations — listing a product, running a promotion,
 * requesting a payout — and deliberately NOT on the ones that discharge existing ones, such as
 * shipping an order or answering a return. See the note in `requireSeller`: a restriction that
 * stops a seller fulfilling orders punishes the buyers instead of the seller.
 */
export function denyRestrictedSeller(req, _res, next) {
  if (!req.seller?.restricted) return next()
  return next(forbidden(
    req.seller.restricted_reason
      ? `Your store is restricted: ${req.seller.restricted_reason}`
      : 'Your store is currently restricted. You can still complete existing orders.',
    'SELLER_RESTRICTED',
  ))
}
