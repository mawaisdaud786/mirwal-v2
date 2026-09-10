import { ok } from '../../lib/errors.js'
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie, hashRefreshToken } from '../../lib/tokens.js'
import * as service from './auth.service.js'
import * as security from '../admin/security.service.js'
import * as messaging from '../messaging/messaging.service.js'
import { env } from '../../config/env.js'

const context = (req) => ({ userAgent: req.get('user-agent'), ip: null })

export async function register(req, res, next) {
  try {
    const { user, authorization, publicUser } = await service.register(req.body)
    const tokens = await service.issueTokens(user, authorization, context(req))
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpires)
    return ok(res, { user: publicUser, accessToken: tokens.accessToken }, 'Your Mirwal account is ready.', 201)
  } catch (error) { return next(error) }
}

export async function login(req, res, next) {
  try {
    const { user, authorization, publicUser } = await service.authenticate(req.body)
    const tokens = await service.issueTokens(user, authorization, context(req))
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpires)
    return ok(res, { user: publicUser, accessToken: tokens.accessToken }, 'Signed in.')
  } catch (error) { return next(error) }
}

export async function refresh(req, res, next) {
  try {
    const result = await service.rotateRefreshToken(readRefreshCookie(req, 'customer'), context(req))
    setRefreshCookie(res, result.refreshToken, result.refreshExpires)
    return ok(res, { user: result.publicUser, accessToken: result.accessToken })
  } catch (error) { return next(error) }
}

export async function logout(req, res, next) {
  try {
    await service.revokeRefreshToken(readRefreshCookie(req, 'customer'))
    clearRefreshCookie(res)
    return ok(res, null, 'Signed out.')
  } catch (error) { return next(error) }
}

export async function me(req, res, next) {
  try {
    return ok(res, { user: await service.getCurrentUser(req.user.id) })
  } catch (error) { return next(error) }
}

export async function updateMe(req, res, next) {
  try {
    return ok(res, { user: await service.updateProfile(req.user.id, req.body) }, 'Profile updated.')
  } catch (error) { return next(error) }
}

// ---------------------------------------------------------------------------
// Account security
// ---------------------------------------------------------------------------

/**
 * The caller's own refresh token, hashed.
 *
 * Used to spare the current session when a password change ends the others, and to label it
 * in the session list. Reading the cookie here rather than trusting anything the client sends
 * is the point: a client-supplied "this is my session" value would let one session protect
 * another.
 */
const ownTokenHash = (req) => {
  // All three scopes are checked because these routes are shared: an admin or seller signed in
  // through their own namespace carries a differently-named cookie, and looking only for the
  // customer one would make a password change revoke the caller's own session as well as the
  // others — signing them out of the page they are standing on.
  for (const scope of ['customer', 'admin', 'seller']) {
    const raw = readRefreshCookie(req, scope)
    if (raw) return hashRefreshToken(raw)
  }
  return null
}

export async function changePassword(req, res, next) {
  try {
    const result = await service.changePassword(req.user.id, req.body, ownTokenHash(req))
    return ok(res, result, result.otherSessionsEnded > 0
      ? `Password changed, and ${result.otherSessionsEnded} other session${result.otherSessionsEnded === 1 ? ' was' : 's were'} signed out.`
      : 'Password changed.')
  } catch (error) { return next(error) }
}

export async function listSessions(req, res, next) {
  try { return ok(res, await service.listOwnSessions(req.user.id, ownTokenHash(req))) }
  catch (error) { return next(error) }
}

export async function revokeSession(req, res, next) {
  try {
    await service.revokeOwnSession(req.user.id, req.params.id)
    return ok(res, null, 'That device has been signed out.')
  } catch (error) { return next(error) }
}

// --- Two-factor, for the caller's own account -------------------------------
//
// The same service the admin panel uses. Two-factor is an account feature, not a staff
// feature — a shopper with saved addresses and an order history has something worth
// protecting too.

export async function twoFactorStatus(req, res, next) {
  try { return ok(res, await security.twoFactorStatus(req.user.id)) }
  catch (error) { return next(error) }
}

export async function beginTwoFactor(req, res, next) {
  try {
    return ok(res, await security.beginTwoFactor(req.user.id),
      'Scan this in your authenticator app, then enter the code it shows.')
  } catch (error) { return next(error) }
}

export async function confirmTwoFactor(req, res, next) {
  try {
    const result = await security.confirmTwoFactor(req.user.id, req.body.code)
    return ok(res, result, 'Two-factor is on. Save these recovery codes — they are shown once.')
  } catch (error) { return next(error) }
}

export async function disableTwoFactor(req, res, next) {
  try {
    await security.disableTwoFactor(req.user.id, req.body.password)
    return ok(res, null, 'Two-factor is off.')
  } catch (error) { return next(error) }
}

export async function regenerateBackupCodes(req, res, next) {
  try {
    const result = await security.regenerateBackupCodes(req.user.id, req.body.password)
    return ok(res, result, 'New recovery codes issued. The previous ones no longer work.')
  } catch (error) { return next(error) }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Ask for a reset link.
 *
 * Replies identically whether or not the address has an account. Saying "no such user" would
 * turn this into a way to find out who shops on Mirwal — the same reason the login path gives
 * one generic error for a wrong email and a wrong password.
 */
export async function requestPasswordReset(req, res, next) {
  try {
    const result = await service.requestPasswordReset(req.body.email, { ip: req.ip })

    if (result.sent) {
      // The link is built from configured environment, never from a request header: a reset
      // URL taken from Host would point wherever the caller chose.
      const resetUrl = `${env.storefrontUrl}/reset-password?token=${encodeURIComponent(result.token)}`
      messaging.sendInBackground('account.password_reset', {
        channel: 'email',
        to: result.user.email,
        variables: {
          name: result.user.full_name,
          resetUrl,
          minutes: String(result.expiresInMinutes),
        },
        // Not escaped: this is a URL Mirwal built, and escaping "&" would break the link.
        // Every other value here stays escaped.
        rawVariables: ['resetUrl'],
      })
    }

    return ok(res, null, 'If that email address has a Mirwal account, a reset link is on its way.')
  } catch (error) { return next(error) }
}

export async function resetPassword(req, res, next) {
  try {
    const account = await service.completePasswordReset(req.body.token, req.body.password)
    // Told after the fact, so a reset the account holder did not ask for is noticed.
    messaging.sendInBackground('account.password_changed', {
      channel: 'email', to: account.email, variables: { name: account.name },
    })
    return ok(res, null, 'Your password has been changed. Sign in with the new one.')
  } catch (error) { return next(error) }
}
