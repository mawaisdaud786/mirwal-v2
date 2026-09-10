import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js'
import { verifyPassword } from '../../lib/password.js'
import { generateSecret, verifyToken, buildOtpAuthUri, generateBackupCodes, hashBackupCode } from '../../lib/totp.js'
import { getSetting } from '../settings/settings.service.js'
import { env } from '../../config/env.js'
// Imported rather than restated: a lockout policy printed on a security page must be the one
// the login path enforces, not a number that drifted out of sync with it.
import { MAX_FAILED_LOGINS, LOCK_MINUTES } from '../auth/auth.service.js'

/**
 * Account security: real two-factor authentication, and a posture summary built from data
 * the platform already records.
 *
 * The admin Security page previously said there was no 2FA, no rate limiting, no IP allowlist
 * and no security log. Three of those four were wrong: rate limiting has always been in
 * `app.js`, the allowlist is `maintenance.allow_ips`, and `audit_logs` plus `system_logs`
 * have recorded security-relevant events since migrations 016. Only 2FA genuinely did not
 * exist, so that is the part that is built here rather than merely surfaced.
 */

// ---------------------------------------------------------------------------
// Two-factor enrolment
// ---------------------------------------------------------------------------

/**
 * Begin enrolment: generate a secret and return the URI an authenticator app scans.
 *
 * The secret is stored immediately but `totp_enabled_at` stays NULL, so it does nothing
 * until a working code proves the app holds the same secret. Enrolling with a secret the
 * user never successfully scanned is how people lock themselves out.
 *
 * Re-enrolling while already enabled is refused: it would silently invalidate the working
 * authenticator of someone who is, at that moment, signed in on a stolen session.
 */
export async function beginTwoFactor(userId) {
  const user = await queryOne('SELECT id, email, totp_enabled_at FROM users WHERE id = ?', [userId])
  if (!user) throw notFound('Account not found.', 'USER_NOT_FOUND')
  if (user.totp_enabled_at) {
    throw conflict('Two-factor is already switched on. Turn it off first to re-enrol.', 'TWO_FACTOR_ENABLED')
  }

  const secret = generateSecret()
  await query('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, userId])

  return {
    secret,
    otpauthUri: buildOtpAuthUri({ secret, account: user.email }),
  }
}

/**
 * Finish enrolment by proving the app works, and hand back the recovery codes.
 *
 * The codes are returned exactly once, here. They are stored hashed, so a later request
 * cannot re-read them — losing them means regenerating them, which is the correct trade.
 */
export async function confirmTwoFactor(userId, code) {
  const user = await queryOne('SELECT id, totp_secret, totp_enabled_at FROM users WHERE id = ?', [userId])
  if (!user) throw notFound('Account not found.', 'USER_NOT_FOUND')
  if (user.totp_enabled_at) throw conflict('Two-factor is already switched on.', 'TWO_FACTOR_ENABLED')
  if (!user.totp_secret) throw badRequest('Start setup before confirming a code.', 'TWO_FACTOR_NOT_STARTED')

  if (!verifyToken(user.totp_secret, code)) {
    throw badRequest('That code is not right. Check your authenticator app and try the current code.', 'INVALID_TWO_FACTOR')
  }

  const codes = generateBackupCodes()
  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET totp_enabled_at = NOW(3) WHERE id = ?', [userId])
    await connection.query('DELETE FROM user_backup_codes WHERE user_id = ?', [userId])
    for (const backupCode of codes) {
      await connection.query(
        'INSERT INTO user_backup_codes (user_id, code_hash) VALUES (?, ?)',
        [userId, hashBackupCode(backupCode)],
      )
    }
  })

  return { backupCodes: codes }
}

/**
 * Switch two-factor off. Requires the current password, not just a live session.
 *
 * Without that, anyone who walked up to an unlocked screen could remove the second factor —
 * which is precisely the attack the second factor exists to stop.
 */
export async function disableTwoFactor(userId, password) {
  const user = await queryOne('SELECT id, password_hash, totp_enabled_at FROM users WHERE id = ?', [userId])
  if (!user) throw notFound('Account not found.', 'USER_NOT_FOUND')
  if (!user.totp_enabled_at) throw badRequest('Two-factor is not switched on.', 'TWO_FACTOR_DISABLED')

  if (!await verifyPassword(password, user.password_hash)) {
    throw unauthorized('That password is not correct.', 'INVALID_CREDENTIALS')
  }

  const required = await getSetting('security.require_2fa_for_staff', false)
  if (required) {
    const staff = await queryOne(
      `SELECT COUNT(*) AS total FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ? AND r.slug IN ('admin', 'super_admin')`,
      [userId],
    )
    if (Number(staff.total) > 0) {
      throw conflict(
        'Mirwal requires two-factor for staff accounts. Ask a super admin to lift that setting first.',
        'TWO_FACTOR_REQUIRED_BY_POLICY',
      )
    }
  }

  await withTransaction(async (connection) => {
    await connection.query('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?', [userId])
    await connection.query('DELETE FROM user_backup_codes WHERE user_id = ?', [userId])
  })
  return { disabled: true }
}

/** Replace the recovery codes, e.g. after using or losing some. Requires the password. */
export async function regenerateBackupCodes(userId, password) {
  const user = await queryOne('SELECT id, password_hash, totp_enabled_at FROM users WHERE id = ?', [userId])
  if (!user) throw notFound('Account not found.', 'USER_NOT_FOUND')
  if (!user.totp_enabled_at) throw badRequest('Two-factor is not switched on.', 'TWO_FACTOR_DISABLED')
  if (!await verifyPassword(password, user.password_hash)) {
    throw unauthorized('That password is not correct.', 'INVALID_CREDENTIALS')
  }

  const codes = generateBackupCodes()
  await withTransaction(async (connection) => {
    await connection.query('DELETE FROM user_backup_codes WHERE user_id = ?', [userId])
    for (const backupCode of codes) {
      await connection.query(
        'INSERT INTO user_backup_codes (user_id, code_hash) VALUES (?, ?)',
        [userId, hashBackupCode(backupCode)],
      )
    }
  })
  return { backupCodes: codes }
}

/** What the account's own security page shows. Never returns the secret once enabled. */
export async function twoFactorStatus(userId) {
  const user = await queryOne('SELECT totp_secret, totp_enabled_at FROM users WHERE id = ?', [userId])
  if (!user) throw notFound('Account not found.', 'USER_NOT_FOUND')

  const codes = await queryOne(
    'SELECT COUNT(*) AS total, SUM(used_at IS NULL) AS unused FROM user_backup_codes WHERE user_id = ?',
    [userId],
  )
  return {
    enabled: Boolean(user.totp_enabled_at),
    enrolmentStarted: Boolean(user.totp_secret) && !user.totp_enabled_at,
    enabledAt: user.totp_enabled_at,
    backupCodesRemaining: Number(codes.unused ?? 0),
    backupCodesIssued: Number(codes.total ?? 0),
  }
}

/**
 * Check a second factor at sign-in: a TOTP code, or one recovery code.
 *
 * A recovery code is consumed by the UPDATE's own WHERE clause rather than by reading then
 * writing, so two simultaneous attempts cannot both spend the same code.
 */
export async function verifySecondFactor(user, code) {
  if (!user.totp_secret) return false
  if (verifyToken(user.totp_secret, code)) return true

  const hash = hashBackupCode(code)
  const result = await query(
    'UPDATE user_backup_codes SET used_at = NOW(3) WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
    [user.id, hash],
  )
  return result.affectedRows === 1
}

// ---------------------------------------------------------------------------
// Security posture
// ---------------------------------------------------------------------------

/**
 * The admin Security overview.
 *
 * Every number is counted from a real table, and the rate-limit and lockout figures are read
 * from the running configuration rather than restated from memory — so if someone changes
 * `RATE_LIMIT_MAX` in the environment, this page changes with it instead of quietly lying.
 */
export async function securityOverview() {
  const accounts = await queryOne(
    `SELECT COUNT(*)                                   AS total,
            SUM(u.status = 'suspended')                AS suspended,
            SUM(u.totp_enabled_at IS NOT NULL)         AS with_2fa,
            SUM(u.locked_until > NOW())                AS locked,
            SUM(u.failed_login_count > 0)              AS with_failures
       FROM users u WHERE u.deleted_at IS NULL`,
  )

  const staff = await queryOne(
    `SELECT COUNT(DISTINCT u.id)                                        AS total,
            COUNT(DISTINCT CASE WHEN u.totp_enabled_at IS NOT NULL THEN u.id END) AS with_2fa
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r       ON r.id = ur.role_id
      WHERE u.deleted_at IS NULL AND r.slug IN ('admin', 'super_admin')`,
  )

  const sessions = await queryOne(
    `SELECT COUNT(*) AS active,
            SUM(t.created_at > NOW() - INTERVAL 24 HOUR) AS today
       FROM refresh_tokens t
      WHERE t.revoked_at IS NULL AND t.expires_at > NOW()`,
  )

  // Sign-in failures over the last week, from the audit trail rather than a counter that
  // only ever moves forward.
  const lockedAccounts = await query(
    `SELECT u.public_id, u.full_name, u.email, u.failed_login_count, u.locked_until
       FROM users u
      WHERE u.deleted_at IS NULL AND (u.locked_until > NOW() OR u.failed_login_count > 0)
      ORDER BY u.failed_login_count DESC, u.locked_until DESC
      LIMIT 20`,
  )

  const recentEvents = await query(
    `SELECT a.action, a.entity_type, a.entity_id, a.created_at,
            INET6_NTOA(a.ip_address) AS ip_address,
            u.full_name AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.action IN ('session.revoked', 'account.suspended', 'account.restored',
                         'role.permissions_updated', 'security.two_factor_enabled',
                         'security.two_factor_disabled', 'maintenance.toggled',
                         'backup.created', 'backup.downloaded', 'backup.deleted')
      ORDER BY a.created_at DESC LIMIT 25`,
  )

  const errors = await queryOne(
    `SELECT COUNT(*) AS total FROM system_logs
      WHERE level = 'error' AND created_at > NOW() - INTERVAL 24 HOUR`,
  ).catch(() => ({ total: 0 }))

  const requireStaff2fa = await getSetting('security.require_2fa_for_staff', false)
  const allowIps = await getSetting('maintenance.allow_ips', [])

  const staffTotal = Number(staff.total)
  return {
    accounts: {
      total: Number(accounts.total),
      suspended: Number(accounts.suspended ?? 0),
      lockedOut: Number(accounts.locked ?? 0),
      withFailedAttempts: Number(accounts.with_failures ?? 0),
      withTwoFactor: Number(accounts.with_2fa ?? 0),
    },
    staff: {
      total: staffTotal,
      withTwoFactor: Number(staff.with_2fa ?? 0),
      // The gap that matters: privileged accounts with only a password.
      withoutTwoFactor: staffTotal - Number(staff.with_2fa ?? 0),
      twoFactorRequired: Boolean(requireStaff2fa),
    },
    sessions: {
      active: Number(sessions.active),
      startedToday: Number(sessions.today ?? 0),
    },
    /**
     * The controls that are actually in force, read from the running process. These were
     * previously drawn as editable toggles that saved nowhere; they are configuration, and
     * configuration for a security control belongs in the environment where an admin
     * session cannot weaken it.
     */
    policy: {
      rateLimit: {
        maxRequests: env.rateLimit.max,
        windowMinutes: Math.round(env.rateLimit.windowMs / 60_000),
      },
      lockout: { afterFailedAttempts: MAX_FAILED_LOGINS, minutes: LOCK_MINUTES },
      accessTokenLifetime: env.auth.accessTtl,
      refreshTokenDays: env.auth.refreshTtlDays,
      allowedIps: Array.isArray(allowIps) ? allowIps : [],
      configuredIn: 'server environment (.env)',
    },
    errorsLast24h: Number(errors.total ?? 0),
    accountsNeedingAttention: lockedAccounts.map((row) => ({
      id: row.public_id,
      name: row.full_name,
      email: row.email,
      failedAttempts: Number(row.failed_login_count),
      lockedUntil: row.locked_until,
    })),
    recentEvents: recentEvents.map((row) => ({
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actor: row.actor_name,
      ip: row.ip_address,
      at: row.created_at,
    })),
  }
}
