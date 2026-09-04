import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238) and single-use recovery codes.
 *
 * Two-factor was previously a toggle in the admin UI that saved nowhere. This is the actual
 * algorithm rather than a dependency: it is about forty lines, and an authentication
 * primitive is not somewhere to inherit an unaudited package.
 *
 * Interoperable with Google Authenticator, Authy, 1Password and the rest — SHA-1, 6 digits,
 * 30-second step. SHA-1 is not a security weakness here: HMAC-SHA1 has no practical attack,
 * and every authenticator app in use expects it.
 */

const DIGITS = 6
const STEP_SECONDS = 30
/** How many steps either side of "now" are accepted. One = ±30s of clock drift. */
const DRIFT_STEPS = 1

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, uppercase and unpadded — the encoding authenticator apps expect. */
function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A fresh 160-bit secret — the size RFC 4226 recommends for HMAC-SHA1. */
export function generateSecret() {
  return base32Encode(randomBytes(20))
}

/** The code for one 30-second step. Exported so a test can pin the clock. */
export function codeForStep(secret, step) {
  const counter = Buffer.alloc(8)
  // Big-endian 64-bit counter. Writing the low half at offset 4 keeps this correct past
  // 2^32 steps without pulling in BigInt arithmetic.
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0)
  counter.writeUInt32BE(step >>> 0, 4)

  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Whether `token` is currently valid for `secret`.
 *
 * Compared with timingSafeEqual so the check does not leak, digit by digit, how much of a
 * guess was right. Returns false rather than throwing on a malformed secret or token: a
 * caller checking a second factor should never see an exception where it expects a boolean.
 */
export function verifyToken(secret, token, { now = Date.now() } = {}) {
  const candidate = String(token ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(candidate)) return false

  const currentStep = Math.floor(now / 1000 / STEP_SECONDS)
  const supplied = Buffer.from(candidate, 'ascii')

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    let expected
    try {
      expected = Buffer.from(codeForStep(secret, currentStep + drift), 'ascii')
    } catch {
      return false
    }
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true
  }
  return false
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice on purpose — once in the label and once as a parameter. Older
 * apps read only the label; newer ones prefer the parameter.
 */
export function buildOtpAuthUri({ secret, account, issuer = 'Mirwal' }) {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Ten single-use codes, shown once and stored only as hashes.
 *
 * A plain SHA-256 rather than a password hash: these are 50 bits of server-generated
 * randomness, so there is no dictionary to slow an attacker down with, and a login path
 * that has to bcrypt ten candidates per attempt is its own denial of service.
 */
export function generateBackupCodes(count = 10) {
  const codes = []
  for (let index = 0; index < count; index += 1) {
    // Avoids 0/O and 1/I, which get mistyped when read off a printout.
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    let code = ''
    for (let position = 0; position < 10; position += 1) code += alphabet[randomInt(alphabet.length)]
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`)
  }
  return codes
}

export const hashBackupCode = (code) =>
  createHash('sha256').update(String(code).toUpperCase().replace(/[\s-]/g, '')).digest('hex')
