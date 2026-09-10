import { randomUUID } from 'node:crypto'
import { pool, query, queryOne, withTransaction } from '../../db/pool.js'
import { hashPassword, needsRehash, verifyPassword } from '../../lib/password.js'
import { createRefreshToken, hashRefreshToken, refreshExpiry, signAccessToken, toSqlDateTime } from '../../lib/tokens.js'
import { conflict, forbidden, unauthorized } from '../../lib/errors.js'
import { verifySecondFactor } from '../admin/security.service.js'
import * as messaging from '../messaging/messaging.service.js'
import { parseJsonColumn } from '../../lib/json.js'

/** Exported so the admin Security page states the lockout policy actually in force. */
export const MAX_FAILED_LOGINS = 8
export const LOCK_MINUTES = 15

/** Roles and permissions for a user, flattened for the access token. */
export async function loadAuthorization(userId) {
  const rows = await query(
    `SELECT r.slug AS role, p.slug AS permission
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?`,
    [userId],
  )
  return {
    roles: [...new Set(rows.map((row) => row.role))],
    permissions: [...new Set(rows.map((row) => row.permission).filter(Boolean))],
  }
}

const publicUser = (user, authorization) => ({
  id: user.public_id,
  email: user.email,
  fullName: user.full_name,
  phone: user.phone,
  city: user.city,
  country: user.country,
  language: user.preferred_language,
  address: user.default_address,
  paymentMethod: user.default_payment_method,
  // `parseJsonColumn`, not `JSON.parse`. mysql2 hands JSON columns back already parsed on some
  // paths and as a string on others, and a raw parse on an object throws — which happened here
  // the moment anything started writing these columns: it is on the login path, so the failure
  // is not a missing preference but an account that can no longer sign in.
  notificationChannels: parseJsonColumn(user.notification_channels, {}),
  notificationPreferences: parseJsonColumn(user.notification_preferences, {}),
  status: user.status,
  emailVerified: Boolean(user.email_verified_at),
  roles: authorization.roles,
  permissions: authorization.permissions,
  createdAt: user.created_at,
})

/**
 * Register a customer.
 *
 * Only ever assigns the `customer` role. Seller and admin access is granted through
 * separate, reviewed flows — self-service registration must never be able to mint
 * privilege, which is exactly the hole the old localStorage model had.
 */
export async function register({ email, password, fullName, phone }) {
  const normalisedEmail = email.trim().toLowerCase()

  const existing = await queryOne('SELECT id FROM users WHERE email = ?', [normalisedEmail])
  if (existing) throw conflict('An account with that email already exists.', 'EMAIL_TAKEN')

  const passwordHash = await hashPassword(password)
  const publicId = randomUUID()

  const userId = await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO users (public_id, email, phone, password_hash, full_name, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [publicId, normalisedEmail, phone ?? null, passwordHash, fullName.trim()],
    )
    await connection.execute(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT ?, id FROM roles WHERE slug = 'customer'`,
      [result.insertId],
    )
    return result.insertId
  })

  const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId])
  const authorization = await loadAuthorization(userId)
  return { user, authorization, publicUser: publicUser(user, authorization) }
}

/**
 * Verify credentials.
 *
 * The same generic message is returned for "no such user" and "wrong password", so the
 * endpoint cannot be used to enumerate which email addresses have accounts.
 */
export async function authenticate({ email, password, totpCode }) {
  const normalisedEmail = email.trim().toLowerCase()
  const user = await queryOne('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [normalisedEmail])

  const invalid = unauthorized('Email or password is incorrect.', 'INVALID_CREDENTIALS')

  if (!user) {
    // Spend comparable time so response timing does not reveal account existence.
    await verifyPassword(password, 'scrypt$32768$8$1$AAAA$AAAA')
    throw invalid
  }

  if (user.locked_until && new Date(`${user.locked_until}Z`) > new Date()) {
    throw forbidden('Too many failed attempts. Please try again shortly.', 'ACCOUNT_LOCKED')
  }

  const valid = await verifyPassword(password, user.password_hash)

  if (!valid) {
    const failed = user.failed_login_count + 1
    const lockUntil = failed >= MAX_FAILED_LOGINS
      ? toSqlDateTime(new Date(Date.now() + LOCK_MINUTES * 60 * 1000))
      : null
    await pool.execute(
      'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?',
      [failed, lockUntil, user.id],
    )
    throw invalid
  }

  if (user.status === 'suspended') throw forbidden('This account is suspended.', 'ACCOUNT_SUSPENDED')
  if (user.status === 'deleted') throw invalid

  /**
   * Second factor, checked only once the password is known to be right.
   *
   * Doing it in this order matters: prompting for a code before the password is verified
   * would tell an attacker which accounts have two-factor enrolled, which is a map of the
   * accounts worth attacking directly.
   *
   * A missing code is a distinct 401 (`TWO_FACTOR_REQUIRED`) rather than a failure, so the
   * sign-in form can ask for one; a wrong code counts towards lockout, because six digits is
   * a small enough space to be worth guessing at otherwise.
   */
  if (user.totp_enabled_at) {
    if (!totpCode) {
      throw unauthorized('Enter the code from your authenticator app.', 'TWO_FACTOR_REQUIRED')
    }
    if (!await verifySecondFactor(user, totpCode)) {
      const failed = user.failed_login_count + 1
      const lockUntil = failed >= MAX_FAILED_LOGINS
        ? toSqlDateTime(new Date(Date.now() + LOCK_MINUTES * 60 * 1000))
        : null
      await pool.execute(
        'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?',
        [failed, lockUntil, user.id],
      )
      throw unauthorized('That code is not right. Try the current code from your app.', 'INVALID_TWO_FACTOR')
    }
  }

  // Transparently upgrade the hash if the cost parameters have since been raised.
  const updates = ['failed_login_count = 0', 'locked_until = NULL', 'last_login_at = ?']
  const params = [toSqlDateTime()]
  if (needsRehash(user.password_hash)) {
    updates.push('password_hash = ?')
    params.push(await hashPassword(password))
  }
  params.push(user.id)
  await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)

  const authorization = await loadAuthorization(user.id)
  return { user, authorization, publicUser: publicUser(user, authorization) }
}

/** Issue an access token plus a fresh refresh token, recording the latter by hash. */
export async function issueTokens(user, authorization, context = {}) {
  const accessToken = signAccessToken({
    userId: user.id,
    publicId: user.public_id,
    email: user.email,
    roles: authorization.roles,
    permissions: authorization.permissions,
  })

  const { token, hash } = createRefreshToken()
  const expires = refreshExpiry()

  const userAgent = (context.userAgent ?? '').slice(0, 255)

  /**
   * Has this account been seen on this device before?
   *
   * Asked *before* the new row is inserted, or the session being created would match itself.
   *
   * Matching on the user agent alone is coarse — it does not distinguish two Chrome installs
   * on the same version, and it produces a false alert whenever a browser updates. That is the
   * right trade in this direction: a spurious "was this you?" costs a moment's attention, and
   * a missed one costs the account. A real device fingerprint would be better and is a much
   * larger change; this is the signal available from data already being stored.
   *
   * Deliberately not gated on IP. Pakistani mobile carriers rotate addresses constantly, so an
   * IP-based check would alert on almost every sign-in and be ignored within a week.
   */
  const [[seen]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM refresh_tokens
      WHERE user_id = ? AND user_agent = ? AND user_agent <> ''`,
    [user.id, userAgent],
  )
  const isNewDevice = Number(seen.n) === 0

  await pool.execute(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, hash, toSqlDateTime(expires), userAgent, context.ip ?? null],
  )

  /**
   * Tell them.
   *
   * An account takeover is silent by design: the attacker changes nothing the owner would
   * notice until the money moves. This message is frequently the only thing that reaches the
   * real owner while it still matters.
   *
   * Skipped for an account's very first session — everyone's first sign-in is from a device
   * they have never used before, and alerting on it teaches people to ignore the alert.
   *
   * Not awaited: `send()` never throws, but it does talk to an SMTP server, and a sign-in must
   * not wait on that. A dropped alert is a worse outcome than a slow one only if it is common,
   * and the delivery ledger records every attempt either way.
   */
  if (isNewDevice && userAgent) {
    const [[priorSessions]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?',
      [user.id],
    )
    if (Number(priorSessions.n) > 1) {
      messaging.send('security.new_device_login', {
        to: user.email,
        userId: user.id,
        variables: {
          name: user.full_name ?? '',
          device: userAgent,
          when: new Date().toUTCString(),
        },
      }).catch(() => {})
    }
  }

  return { accessToken, refreshToken: token, refreshExpires: expires }
}

/**
 * Exchange a refresh token for a new pair, rotating the old one.
 *
 * Reuse detection: presenting an already-rotated token means it leaked, so every session
 * for that user is revoked rather than just the one token.
 */
export async function rotateRefreshToken(rawToken, context = {}) {
  const invalid = unauthorized('Your session has expired. Please sign in again.', 'REFRESH_INVALID')

  // A visitor with no cookie at all — the common case, since the frontend calls this
  // unconditionally on every boot to find out whether anyone is signed in — has no rawToken.
  // hashRefreshToken() calls createHash().update(rawToken), which throws on undefined; that
  // crashed this into a generic 500 instead of the plain "not signed in" this actually is.
  if (!rawToken) throw invalid

  const hash = hashRefreshToken(rawToken)
  const record = await queryOne('SELECT * FROM refresh_tokens WHERE token_hash = ?', [hash])

  if (!record) throw invalid

  if (record.revoked_at || record.replaced_by_id) {
    await pool.execute(
      'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [toSqlDateTime(), record.user_id],
    )
    throw unauthorized('This session is no longer valid. Please sign in again.', 'REFRESH_REUSED')
  }

  if (new Date(`${record.expires_at}Z`) < new Date()) throw invalid

  const user = await queryOne('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [record.user_id])
  if (!user || user.status !== 'active') throw invalid

  const authorization = await loadAuthorization(user.id)
  const issued = await issueTokens(user, authorization, context)

  const replacement = await queryOne('SELECT id FROM refresh_tokens WHERE token_hash = ?', [
    hashRefreshToken(issued.refreshToken),
  ])
  await pool.execute(
    'UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE id = ?',
    [toSqlDateTime(), replacement.id, record.id],
  )

  return { ...issued, user, authorization, publicUser: publicUser(user, authorization) }
}

export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return
  await pool.execute(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [toSqlDateTime(), hashRefreshToken(rawToken)],
  )
}

export async function getCurrentUser(userId) {
  const user = await queryOne('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [userId])
  if (!user) throw unauthorized()
  const authorization = await loadAuthorization(userId)
  return publicUser(user, authorization)
}

/**
 * Update the signed-in shopper's own profile.
 *
 * Deliberately narrow: name and phone only. Email is the account identity and changing it
 * needs a verification flow that does not exist; `status`, `roles` and `password_hash` are
 * not editable here at all, so a crafted body cannot escalate anything. The user id comes
 * from the verified token, never from the request.
 */
export async function updateProfile(userId, { fullName, phone, city, country, language, address, paymentMethod, notificationChannels, notificationPreferences }) {
  await pool.execute(
    `UPDATE users
        SET full_name = ?, phone = ?, city = ?, country = ?, preferred_language = ?, default_address = ?, default_payment_method = COALESCE(?, default_payment_method), notification_channels = COALESCE(?, notification_channels), notification_preferences = COALESCE(?, notification_preferences)
      WHERE id = ? AND deleted_at IS NULL`,
    [fullName, phone || null, city || null, country || null, language || null, address || null, paymentMethod || null, notificationChannels ? JSON.stringify(notificationChannels) : null, notificationPreferences ? JSON.stringify(notificationPreferences) : null, userId],
  )
  return getCurrentUser(userId)
}

// ---------------------------------------------------------------------------
// Account security
// ---------------------------------------------------------------------------

/**
 * Change a password and end every other session.
 *
 * Ending the other sessions is the point of the operation as often as the new password is:
 * someone changing their password because they think it was stolen expects that to log the
 * thief out. The caller's own session is kept, so they are not bounced to sign-in.
 */
export async function changePassword(userId, { currentPassword, newPassword }, keepTokenHash = null) {
  const user = await queryOne('SELECT id, password_hash FROM users WHERE id = ? AND deleted_at IS NULL', [userId])
  if (!user) throw unauthorized('Account not found.', 'USER_NOT_FOUND')

  if (!await verifyPassword(currentPassword, user.password_hash)) {
    throw unauthorized('Your current password is not correct.', 'INVALID_CREDENTIALS')
  }

  const hash = await hashPassword(newPassword)
  const revoked = await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId])
    const [result] = await connection.query(
      `UPDATE refresh_tokens SET revoked_at = NOW(3)
        WHERE user_id = ? AND revoked_at IS NULL
          AND (? IS NULL OR token_hash <> ?)`,
      [userId, keepTokenHash, keepTokenHash],
    )
    return result.affectedRows
  })

  return { otherSessionsEnded: revoked }
}

/**
 * The caller's own live sessions.
 *
 * Only the current ones: a revoked or expired row is history, not a device someone can still
 * be signed in on, and listing it would make the page look alarming for no reason. The token
 * itself is never returned — only its hash is stored, and even that stays server-side.
 */
export async function listOwnSessions(userId, currentTokenHash = null) {
  const rows = await query(
    `SELECT id, user_agent, INET6_NTOA(ip_address) AS ip_address,
            created_at, expires_at, token_hash
       FROM refresh_tokens
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    id: String(row.id),
    // The raw user agent, not a guessed "Chrome on Windows". Parsing it would be a guess
    // presented as fact, and the raw string is what actually identifies the client.
    device: row.user_agent || 'Unknown device',
    ip: row.ip_address,
    startedAt: row.created_at,
    expiresAt: row.expires_at,
    // Marked so the UI can label it rather than offer a button that signs you out mid-click.
    isCurrent: Boolean(currentTokenHash) && row.token_hash === currentTokenHash,
  }))
}

/** End one of the caller's own sessions. Scoped by user id, so ids cannot be probed. */
export async function revokeOwnSession(userId, sessionId) {
  const result = await pool.execute(
    'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [sessionId, userId],
  )
  if (result[0].affectedRows === 0) throw unauthorized('That session is not yours or has already ended.', 'SESSION_NOT_FOUND')
  return { ended: true }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** How long a reset link works for. Short: it is a bearer credential sitting in an inbox. */
const RESET_TTL_MINUTES = 30

/**
 * Start a reset.
 *
 * Always resolves the same way whether or not the address belongs to an account. Replying
 * "no such user" would turn this endpoint into a way to discover who shops on Mirwal, which
 * is exactly the enumeration the login path is careful to avoid.
 *
 * Any earlier outstanding token is invalidated, so requesting a second link cannot leave a
 * first one usable.
 */
export async function requestPasswordReset(email, { ip = null } = {}) {
  const normalisedEmail = String(email).trim().toLowerCase()
  const user = await queryOne(
    "SELECT id, full_name, email, status FROM users WHERE email = ? AND deleted_at IS NULL AND status <> 'suspended'",
    [normalisedEmail],
  )
  if (!user) return { sent: false }

  // Same generator as a refresh token: 256 bits of CSPRNG output, stored only as its hash.
  const { token, hash: tokenHash } = createRefreshToken()

  await withTransaction(async (connection) => {
    await connection.query(
      'UPDATE password_resets SET used_at = NOW(3) WHERE user_id = ? AND used_at IS NULL',
      [user.id],
    )
    await connection.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
       VALUES (?, ?, ?, INET6_ATON(?))`,
      [user.id, tokenHash, toSqlDateTime(new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000)), ip],
    )
  })

  return { sent: true, user, token, expiresInMinutes: RESET_TTL_MINUTES }
}

/**
 * Finish a reset.
 *
 * Consuming the token, setting the password and revoking every session happen together: a
 * reset that changed the password but left the old sessions alive would leave whoever
 * prompted the reset still signed in.
 *
 * Two-factor is deliberately NOT cleared. Someone who can read the inbox must not be able to
 * strip the second factor by resetting the password — that is the whole point of having one.
 */
export async function completePasswordReset(token, newPassword) {
  const tokenHash = hashRefreshToken(String(token ?? ''))
  const reset = await queryOne(
    `SELECT r.id, r.user_id, u.email, u.full_name
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW(3)
        AND u.deleted_at IS NULL`,
    [tokenHash],
  )
  if (!reset) {
    throw unauthorized('That reset link has expired or has already been used. Request a new one.', 'INVALID_RESET_TOKEN')
  }

  const hash = await hashPassword(newPassword)
  await withTransaction(async (connection) => {
    await connection.query(
      'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [hash, reset.user_id],
    )
    await connection.query('UPDATE password_resets SET used_at = NOW(3) WHERE id = ?', [reset.id])
    // Every session, including any the attacker started.
    await connection.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
      [reset.user_id],
    )
  })

  return { email: reset.email, name: reset.full_name }
}
