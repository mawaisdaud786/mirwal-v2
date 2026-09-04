import { createHash, randomBytes, randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

/**
 * Token handling.
 *
 * Access token: short-lived JWT, sent in the Authorization header. It carries the user's
 *   id, roles and permissions so most requests need no database round trip. Because it is
 *   self-contained it CANNOT be revoked before expiry — hence the short TTL.
 *
 * Refresh token: long-lived opaque random string, delivered in an httpOnly cookie so
 *   JavaScript (and therefore XSS) cannot read it. Only a SHA-256 hash is stored, so a
 *   database leak yields nothing usable. Rotated on every use.
 *
 * Note the deliberate difference from the current frontend, where `localStorage` holds a
 * role that the client asserts about itself. Nothing the client sends is trusted here:
 * the access token is signed, and every permission in it was written by this server.
 */

export function signAccessToken({ userId, publicId, email, roles, permissions }) {
  return jwt.sign(
    {
      sub: String(userId),
      pid: publicId,
      email,
      roles,
      perms: permissions,
    },
    env.auth.accessSecret,
    {
      expiresIn: env.auth.accessTtl,
      issuer: 'mirwal',
      audience: 'mirwal-api',
      jwtid: randomUUID(),
    },
  )
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.auth.accessSecret, {
    issuer: 'mirwal',
    audience: 'mirwal-api',
    // Pinned explicitly rather than left to the library default. Without this, a token
    // header claiming a different algorithm is what decides how the signature is checked —
    // the classic alg-confusion bug. Only HS256 is ever issued (signAccessToken above), so
    // only HS256 is ever accepted.
    algorithms: ['HS256'],
  })
}

/** Opaque refresh token. Returned once in plaintext; only the hash is ever persisted. */
export function createRefreshToken() {
  const token = randomBytes(48).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

export const hashRefreshToken = (token) => createHash('sha256').update(token).digest('hex')

export function refreshExpiry() {
  const expires = new Date(Date.now() + env.auth.refreshTtlDays * 24 * 60 * 60 * 1000)
  return expires
}

/** MariaDB DATETIME(3) wants 'YYYY-MM-DD HH:MM:SS.mmm' in UTC. */
export const toSqlDateTime = (date = new Date()) =>
  date.toISOString().slice(0, 23).replace('T', ' ')

/**
 * Refresh-cookie scopes, one per Mirwal application.
 *
 * The three frontends are separate applications on separate origins, and their sessions are
 * separated here too rather than sharing one site-wide cookie. Each scope has:
 *
 *   - its own cookie NAME, so the browser keeps them as distinct entries; and
 *   - its own cookie PATH, so the browser only ever sends a scope's cookie to that scope's
 *     refresh endpoint.
 *
 * That is what makes "a customer session can never be exchanged for an admin session" true
 * at the transport level as well as in the authorization checks: a customer's cookie is
 * never even transmitted to `/admin/auth/refresh`, so there is nothing there to escalate.
 * Signing out of the seller portal likewise cannot sign you out of the storefront.
 */
export const COOKIE_SCOPES = {
  customer: { name: env.auth.cookieName, path: `${env.apiPrefix}/auth` },
  admin: { name: `${env.auth.cookieName}_admin`, path: `${env.apiPrefix}/admin/auth` },
  seller: { name: `${env.auth.cookieName}_seller`, path: `${env.apiPrefix}/seller/auth` },
}

function cookieOptions(scope) {
  return {
    httpOnly: true,
    secure: env.auth.cookieSecure,
    sameSite: env.auth.cookieSameSite,
    domain: env.auth.cookieDomain,
    path: scope.path,
  }
}

export function setRefreshCookie(res, token, expires, scopeName = 'customer') {
  const scope = COOKIE_SCOPES[scopeName]
  res.cookie(scope.name, token, { ...cookieOptions(scope), expires })
}

export function clearRefreshCookie(res, scopeName = 'customer') {
  const scope = COOKIE_SCOPES[scopeName]
  res.clearCookie(scope.name, cookieOptions(scope))
}

/** The raw refresh token for one application scope, or undefined. */
export const readRefreshCookie = (req, scopeName = 'customer') =>
  req.cookies?.[COOKIE_SCOPES[scopeName].name]
