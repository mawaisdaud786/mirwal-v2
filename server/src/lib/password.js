import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

/**
 * Password hashing using scrypt from Node's own crypto module.
 *
 * Why scrypt rather than bcrypt or argon2: both of those are native addons that need a
 * compiler at install time. Mirwal deploys to cPanel, where native builds are unreliable
 * and sometimes impossible. scrypt is memory-hard, built into Node, and needs nothing
 * installed — see docs/DEPLOYMENT.md.
 *
 * Stored format is self-describing so the cost parameters can be raised later without
 * invalidating existing hashes:
 *
 *   scrypt$N$r$p$<salt base64url>$<hash base64url>
 */

// N=2^15 with r=8 needs roughly 32 MB per hash. Comfortable on shared hosting while still
// being expensive to attack in bulk.
const PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64, saltLength: 16 }

export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }
  const salt = randomBytes(PARAMS.saltLength)
  const derived = await scrypt(plain.normalize('NFKC'), salt, PARAMS.keyLength, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  })
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Verify a password against a stored hash.
 * Always compares in constant time, and never throws on a malformed stored value —
 * a corrupt hash must read as "wrong password", not as a server error.
 */
export async function verifyPassword(plain, stored) {
  try {
    if (typeof plain !== 'string' || typeof stored !== 'string') return false
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'scrypt') return false

    const salt = Buffer.from(saltB64, 'base64url')
    const expected = Buffer.from(hashB64, 'base64url')
    const derived = await scrypt(plain.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
      maxmem: 256 * 1024 * 1024,
    })
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** True when a stored hash was made with weaker parameters and should be re-hashed on login. */
export function needsRehash(stored) {
  const [scheme, n, r, p] = String(stored).split('$')
  return scheme !== 'scrypt' || Number(n) < PARAMS.N || Number(r) < PARAMS.r || Number(p) < PARAMS.p
}
