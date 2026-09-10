import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { query, queryOne } from '../../db/pool.js'
import { badRequest, conflict, notFound, tooMany } from '../../lib/errors.js'
import { toSqlDateTime } from '../../lib/tokens.js'
import { env } from '../../config/env.js'
import * as messaging from '../messaging/messaging.service.js'
import { messagingCapabilities } from '../../lib/mailer.js'

/**
 * Proving that an email address and a phone number belong to the person using them.
 *
 * `users.email_verified_at` and `phone_verified_at` have existed since migration 001 and were
 * written by exactly one thing: the database seeder. Nothing could set them, because there was
 * no token to check — so every account on Mirwal was, formally, unverified, and the seller
 * application flow had no way to insist otherwise.
 *
 * Design follows `password_resets` (migration 019), which got this right already:
 *
 *   * only a SHA-256 hash of the token is stored, so a database copy hands an attacker
 *     nothing usable;
 *   * tokens are short-lived and single-use;
 *   * requesting a new one invalidates the outstanding one, so a forwarded old email cannot
 *     be replayed.
 *
 * The one addition is an attempt counter, and it is not optional. An email link carries 256
 * bits of entropy and needs no rate limit to be unguessable. A phone OTP is six digits — one
 * in a million — and a six-digit code with unlimited guesses is not a second factor, it is a
 * formality. Five attempts and the code dies.
 */

const EMAIL_TTL_MINUTES = 60
const PHONE_TTL_MINUTES = 10
const MAX_PHONE_ATTEMPTS = 5
// A new code cannot be requested more often than this, so the endpoint cannot be used to send
// someone a hundred texts — which costs Mirwal money and the recipient their patience.
const RESEND_COOLDOWN_SECONDS = 60

const hash = (value) => createHash('sha256').update(value).digest('hex')

/**
 * Constant-time comparison for the phone code.
 *
 * A plain `===` on a short numeric string leaks, through timing, how many leading digits were
 * correct. That is a small leak and a cheap fix, and the codebase already stores password and
 * refresh-token material carefully enough that being sloppy here would be the weak point.
 */
function codesMatch(candidateHash, storedHash) {
  const a = Buffer.from(candidateHash, 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Issue a verification challenge.
 *
 * Email gets a link; phone gets a six-digit code. Both are returned to the caller only in
 * development, exactly as a password reset is — a token in an API response is a token in every
 * log and proxy between here and the browser.
 */
export async function requestVerification(userId, purpose, { appUrl } = {}) {
  const user = await queryOne(
    'SELECT id, email, phone, full_name, email_verified_at, phone_verified_at FROM users WHERE id = ?',
    [userId],
  )
  if (!user) throw notFound('Account not found.')

  const destination = purpose === 'email' ? user.email : user.phone
  if (!destination) {
    throw badRequest(
      purpose === 'email' ? 'This account has no email address.' : 'Add a mobile number first.',
      'DESTINATION_MISSING',
    )
  }
  if (purpose === 'email' && user.email_verified_at) {
    throw conflict('Your email address is already confirmed.', 'ALREADY_VERIFIED')
  }
  if (purpose === 'phone' && user.phone_verified_at) {
    throw conflict('Your mobile number is already confirmed.', 'ALREADY_VERIFIED')
  }

  const recent = await queryOne(
    `SELECT created_at FROM verification_tokens
      WHERE user_id = ? AND purpose = ? AND used_at IS NULL
        AND created_at > DATE_SUB(NOW(3), INTERVAL ? SECOND)
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose, RESEND_COOLDOWN_SECONDS],
  )
  if (recent) {
    throw tooMany(
      `Please wait a moment before requesting another ${purpose === 'email' ? 'email' : 'code'}.`,
      'VERIFICATION_COOLDOWN',
    )
  }

  // Any outstanding challenge for this purpose is dead the moment a new one is issued.
  await query(
    'UPDATE verification_tokens SET used_at = NOW(3) WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    [userId, purpose],
  )

  const secret = purpose === 'email'
    ? randomBytes(32).toString('base64url')
    // randomInt is CSPRNG-backed; Math.random would make this code predictable from a couple
    // of observed samples.
    : String(randomInt(0, 1_000_000)).padStart(6, '0')

  const ttl = purpose === 'email' ? EMAIL_TTL_MINUTES : PHONE_TTL_MINUTES
  const expires = new Date(Date.now() + ttl * 60_000)

  await query(
    `INSERT INTO verification_tokens (user_id, purpose, destination, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, purpose, destination, hash(secret), toSqlDateTime(expires)],
  )

  const link = purpose === 'email'
    ? `${String(appUrl ?? '').replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(secret)}`
    : null

  /**
   * Hand the message to the transport without waiting for it.
   *
   * This used to `await` the send so it could report truthfully whether delivery succeeded.
   * The honesty was right; the blocking was not. A real send against Gmail measured three to
   * fourteen seconds, and every one of those seconds was a person watching a spinner after
   * pressing "Send confirmation link" — which is how the button came to be reported as hanging.
   *
   * The distinction that rescues both properties: **whether a transport is configured is known
   * instantly, but whether a message arrived is not.** The first is the case that actually
   * mattered — an unconfigured SMTP server silently swallowing every verification email — and
   * it is a synchronous check. The second was never knowable in the time a request should take,
   * and pretending otherwise is what made the endpoint slow.
   *
   * So: report configuration synchronously, queue the delivery, and let the delivery ledger
   * record the real outcome for the admin Email & SMS page.
   */
  const channel = purpose === 'email' ? 'email' : 'sms'
  const capabilities = messagingCapabilities()
  const configured = channel === 'email' ? capabilities.email.configured : capabilities.sms.configured

  const dispatch = () => (purpose === 'email'
    ? messaging.send('account.verify_email', {
      to: destination,
      userId,
      variables: { name: user.full_name, link, minutes: String(ttl) },
      // The link is Mirwal's own and must not be HTML-escaped, or the "&" in a query string
      // breaks it. Everything else stays escaped.
      rawVariables: ['link'],
    })
    : messaging.send('account.verify_phone', {
      to: destination,
      userId,
      channel: 'sms',
      variables: { name: user.full_name, code: secret, minutes: String(ttl) },
    }))

  if (configured) {
    // Not awaited. `send()` never throws and records its own outcome, so there is nothing here
    // that a caller could usefully do with the result — and everything to lose by waiting.
    dispatch().catch(() => {})
  } else {
    // Still dispatched, so the ledger keeps its record of every attempt and the admin page
    // shows why nothing went out.
    dispatch().catch(() => {})
  }

  return {
    purpose,
    // Masked, so the UI can say "we sent a code to 03•••••4567" without the endpoint being a
    // way to read back a number the caller may not already know in full.
    destination: purpose === 'email' ? maskEmail(destination) : maskPhone(destination),
    expiresInMinutes: ttl,

    delivery: {
      // 'queued' is the honest answer for a configured transport: it has been handed over, and
      // whether it arrives is between Mirwal and the mail server. 'skipped' is equally honest
      // and far more useful — it means nothing was even attempted, and says what to fix.
      status: configured ? 'queued' : 'skipped',
      reason: configured
        ? null
        : (channel === 'email'
          ? 'No mail server is configured, so nothing was sent. Set SMTP_HOST in the API environment.'
          : 'No SMS gateway is configured, so nothing was sent. Set SMS_API_URL and SMS_API_KEY.'),
    },

    /**
     * The secret itself, in development only.
     *
     * Without a mail server or an SMS gateway there is otherwise no way to exercise this flow
     * at all, and the alternative — reading it out of `message_deliveries` by hand — is what
     * we were reduced to while building it.
     *
     * Guarded on `env.isProduction` rather than on a debug flag someone could switch on by
     * accident. If this value ever reaches a production response it hands the caller a working
     * verification token, so the condition is deliberately the narrowest one available and is
     * checked here rather than in the controller, where a future route could forget it.
     */
    ...(env.isProduction ? {} : { devOnly: { code: purpose === 'phone' ? secret : null, link } }),
  }
}

/**
 * Confirm a challenge.
 *
 * The destination is re-checked against the account as it stands now. Without that, a user who
 * requests a link, changes their email, then clicks the old link would end up with the *new*
 * address marked verified on the strength of a token issued for the old one.
 */
export async function confirmVerification(userId, purpose, secret) {
  const record = await queryOne(
    `SELECT id, destination, token_hash, attempts, expires_at, used_at
       FROM verification_tokens
      WHERE user_id = ? AND purpose = ? AND used_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  )
  if (!record) throw badRequest('Request a new code and try again.', 'VERIFICATION_NOT_FOUND')

  if (new Date(`${record.expires_at}Z`) <= new Date()) {
    await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])
    throw badRequest('That code has expired. Please request a new one.', 'VERIFICATION_EXPIRED')
  }

  if (purpose === 'phone' && record.attempts >= MAX_PHONE_ATTEMPTS) {
    await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])
    throw tooMany('Too many incorrect codes. Please request a new one.', 'VERIFICATION_ATTEMPTS_EXCEEDED')
  }

  if (!codesMatch(hash(String(secret ?? '')), record.token_hash)) {
    // Counted before the error is thrown, so a failed guess costs an attempt whatever the
    // caller does next.
    await query('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = ?', [record.id])
    throw badRequest('That code is not correct.', 'VERIFICATION_INVALID')
  }

  const user = await queryOne('SELECT email, phone FROM users WHERE id = ?', [userId])
  const current = purpose === 'email' ? user?.email : user?.phone
  if (current !== record.destination) {
    await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])
    throw conflict(
      `Your ${purpose === 'email' ? 'email address' : 'mobile number'} changed after this code was sent. Please request a new one.`,
      'DESTINATION_CHANGED',
    )
  }

  const column = purpose === 'email' ? 'email_verified_at' : 'phone_verified_at'
  await query(`UPDATE users SET ${column} = NOW(3) WHERE id = ?`, [userId])
  await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])

  return { purpose, verified: true }
}

/**
 * Confirm an email from the link alone, with no session.
 *
 * A verification link is clicked from an inbox, which is frequently not the browser the user
 * signed in on. Requiring a session here would make the link fail for exactly the people most
 * likely to use it. The token itself is the proof — it is unguessable, single-use and
 * short-lived — so no session is needed to trust it.
 */
export async function confirmEmailByToken(secret) {
  const record = await queryOne(
    `SELECT id, user_id, destination, expires_at
       FROM verification_tokens
      WHERE purpose = 'email' AND token_hash = ? AND used_at IS NULL`,
    [hash(String(secret ?? ''))],
  )
  if (!record) throw badRequest('That link is not valid. Please request a new one.', 'VERIFICATION_NOT_FOUND')

  if (new Date(`${record.expires_at}Z`) <= new Date()) {
    await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])
    throw badRequest('That link has expired. Please request a new one.', 'VERIFICATION_EXPIRED')
  }

  const user = await queryOne('SELECT email FROM users WHERE id = ?', [record.user_id])
  if (user?.email !== record.destination) {
    await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])
    throw conflict('Your email address has changed since this link was sent.', 'DESTINATION_CHANGED')
  }

  await query('UPDATE users SET email_verified_at = NOW(3) WHERE id = ?', [record.user_id])
  await query('UPDATE verification_tokens SET used_at = NOW(3) WHERE id = ?', [record.id])
  return { verified: true }
}

/** Where an account stands. Used by the seller-application checklist and the account page. */
export async function verificationStatus(userId) {
  const user = await queryOne(
    'SELECT email, phone, email_verified_at, phone_verified_at FROM users WHERE id = ?',
    [userId],
  )
  if (!user) throw notFound('Account not found.')
  return {
    email: {
      address: maskEmail(user.email),
      verified: Boolean(user.email_verified_at),
      verifiedAt: user.email_verified_at,
    },
    phone: {
      number: user.phone ? maskPhone(user.phone) : null,
      verified: Boolean(user.phone_verified_at),
      verifiedAt: user.phone_verified_at,
    },
  }
}

/**
 * Changing an email or phone un-verifies it.
 *
 * Called by the profile update path. Without this, someone could verify a throwaway address to
 * clear the seller-application gate and then swap in the real one, and the account would still
 * read as verified — which makes the whole check theatre.
 */
export async function invalidateVerification(userId, purpose) {
  const column = purpose === 'email' ? 'email_verified_at' : 'phone_verified_at'
  await query(`UPDATE users SET ${column} = NULL WHERE id = ?`, [userId])
  await query(
    'UPDATE verification_tokens SET used_at = NOW(3) WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    [userId, purpose],
  )
}

function maskEmail(value) {
  if (!value) return null
  const [local, domain] = String(value).split('@')
  if (!domain) return '•••'
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}${'•'.repeat(Math.max(local.length - head.length, 1))}@${domain}`
}

function maskPhone(value) {
  if (!value) return null
  const text = String(value)
  return `${text.slice(0, 4)}${'•'.repeat(Math.max(text.length - 7, 1))}${text.slice(-3)}`
}
