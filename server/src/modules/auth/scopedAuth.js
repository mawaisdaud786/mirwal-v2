import { forbidden } from '../../lib/errors.js'
import { queryOne } from '../../db/pool.js'
import * as service from './auth.service.js'

/**
 * Per-application authentication.
 *
 * Mirwal serves three separate frontend applications (storefront, admin.mirwal.pk,
 * seller.mirwal.pk) and each authenticates through its own namespace rather than a single
 * shared login that branches on a role after the fact. The difference matters:
 *
 *   - `/admin/auth/login` verifies the password AND requires an admin role before it issues
 *     anything at all. A customer submitting correct customer credentials to the admin
 *     endpoint receives an authorization failure, not a session. There is no window in which
 *     an admin-scoped token exists for a non-admin account.
 *   - Each namespace's refresh cookie is scoped to that namespace's path (see COOKIE_SCOPES),
 *     so the browser never even sends a customer refresh cookie to the admin refresh route.
 *
 * None of this replaces per-request authorization: every admin route still runs
 * requireRole/requirePermission, and every seller route still filters on `req.seller.id`.
 * This is the outer gate, not the only one.
 */

/** Roles that may authenticate through the admin application. */
const ADMIN_ROLES = ['admin', 'super_admin']

/**
 * A deliberately generic failure. Telling a caller "correct password, wrong application"
 * would turn these endpoints into an oracle for which accounts hold admin access.
 */
const notAuthorized = (application) =>
  forbidden(`This account is not authorized for the Mirwal ${application}.`, 'NOT_AUTHORIZED_FOR_APPLICATION')

async function assertAdmin(authorization) {
  if (!authorization.roles.some((role) => ADMIN_ROLES.includes(role))) {
    throw notAuthorized('admin panel')
  }
}

/**
 * A seller needs more than the role: the role without an approved `sellers` row would let a
 * half-finished application into the portal, and every seller-scoped query keys off that row.
 */
async function assertSeller(authorization, userId) {
  if (!authorization.roles.includes('seller')) throw notAuthorized('seller portal')
  const store = await queryOne(
    "SELECT id FROM sellers WHERE user_id = ? AND status = 'approved'",
    [userId],
  )
  if (!store) throw notAuthorized('seller portal')
}

const GUARDS = {
  admin: (authorization, userId) => assertAdmin(authorization, userId),
  seller: (authorization, userId) => assertSeller(authorization, userId),
}

/**
 * Authenticate for one application scope. Password verification (including lockout and the
 * timing-equalising path for unknown accounts) is unchanged — this only adds the
 * application-membership gate on top.
 */
export async function authenticateForScope(scope, credentials) {
  const result = await service.authenticate(credentials)
  await GUARDS[scope](result.authorization, result.user.id)
  return result
}

/**
 * Rotate a refresh token for one application scope, re-checking membership on every rotation.
 * Without this a session issued before an account lost its admin role would keep refreshing
 * itself indefinitely.
 */
export async function rotateForScope(scope, rawToken, context) {
  const result = await service.rotateRefreshToken(rawToken, context)
  await GUARDS[scope](result.authorization, result.user.id)
  return result
}
