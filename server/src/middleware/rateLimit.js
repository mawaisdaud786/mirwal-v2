import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'

/**
 * Rate limits for the endpoints that are actually worth abusing.
 *
 * The API had exactly two limits: 300 requests a minute for everything, and a tight one on the
 * credential routes. That leaves two real problems.
 *
 * **The global limit keys on IP, and in Pakistan an IP is not a person.** Mobile carriers here
 * put very large numbers of subscribers behind carrier-grade NAT, and offices, universities and
 * internet cafés share a single address. One person scripting against Mirwal from a Jazz
 * connection spends everyone else's budget, while an authenticated attacker who rotates
 * addresses spends nobody's. So every limiter below keys on the **account** when the caller is
 * signed in, and falls back to IP only for anonymous traffic. That inverts both failure modes:
 * the shared connection stops being collectively punished, and the signed-in abuser stops being
 * free.
 *
 * **300/minute is generous for things that cost money.** A limit that stops a scraper is far
 * too loose for an endpoint that sends an SMS, opens a case against a seller, or lets someone
 * guess coupon codes. Those need their own numbers, chosen against what the endpoint does
 * rather than against a single global average.
 *
 * Every limiter here is relaxed under test, deliberately — the suite makes hundreds of requests
 * in seconds, and a limiter firing in CI produces failures that look like application bugs.
 * The credential limiter in `auth.routes.js` is the exception and stays tight, because
 * brute-force protection is behaviour the suite asserts on.
 */

/**
 * An IPv6 client is handed a /64 at minimum, so keying on the full address gives one person
 * eighteen quintillion budgets. Truncating to the /64 makes an IPv6 key mean roughly what an
 * IPv4 key means. (`express-rate-limit` 7.5 has no helper for this; later versions export one.)
 */
function addressKey(ip) {
  if (!ip) return 'unknown'
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (!address.includes(':')) return address
  return address.split(':').slice(0, 4).join(':') + '::/64'
}

/**
 * The account when we know it, the address when we do not.
 *
 * This is the change that matters: a limit keyed only on IP punishes everyone behind one
 * carrier-grade NAT together and lets a signed-in abuser escape by changing networks.
 */
export const rateLimitKey = (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${addressKey(req.ip)}`)

const limiter = ({ windowMs, limit, message, code = 'RATE_LIMITED', skipSuccessfulRequests = false }) => rateLimit({
  windowMs,
  limit: env.isTest ? 100_000 : limit,
  keyGenerator: rateLimitKey,
  skipSuccessfulRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code, message } },
})

/**
 * Anything that sends an email or an SMS on someone else's behalf.
 *
 * Each send costs Mirwal money and lands in a real inbox, so the abuse here is not load — it is
 * using Mirwal to harass an address. The verification service already enforces a per-purpose
 * cooldown; this is the ceiling above it, and it counts failures too, because a script that
 * gets rejected is still a script.
 */
export const messagingLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 20,
  message: 'Too many messages requested. Please wait a while before trying again.',
})

/**
 * Reporting a product, seller or review.
 *
 * Anonymous reports are allowed on purpose — requiring an account to report a counterfeit
 * would suppress exactly the reports worth having — which also makes this the cheapest way to
 * bury a competitor under a hundred cases. Loose enough that a genuinely alarmed shopper can
 * report several listings in one sitting, tight enough that stuffing the queue is pointless.
 */
export const reportLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 20,
  message: 'You have filed several reports recently. Mirwal is looking at them — please wait before filing more.',
})

/**
 * Coupon lookups.
 *
 * A code is a shared secret in a small alphabet, and an endpoint that says "no such coupon"
 * quickly enough is a code oracle: an attacker enumerates until something works, then spends a
 * campaign meant for one segment. Failures count, successes do not — a shopper legitimately
 * trying two or three codes at checkout is never affected.
 */
export const couponLimiter = limiter({
  windowMs: 10 * 60_000,
  limit: 15,
  skipSuccessfulRequests: true,
  code: 'TOO_MANY_CODES',
  message: 'Too many coupon codes tried. Please wait a few minutes.',
})

/**
 * Writes that create records other people have to deal with: listings, tickets, reviews.
 *
 * Not a security boundary so much as a floodgate. The numbers are far above what any real
 * seller or shopper does in an hour and far below what a script does in a minute.
 */
export const writeLimiter = limiter({
  windowMs: 60_000,
  limit: 40,
  message: 'You are doing that too quickly. Please slow down.',
})

/**
 * Search and catalogue browsing.
 *
 * The one place where per-IP is still right for anonymous traffic — this is the scraping
 * surface, and a scraper does not sign in. Set well above a person clicking around, and well
 * below a crawler pulling the whole catalogue.
 */
export const browseLimiter = limiter({
  windowMs: 60_000,
  limit: 120,
  message: 'Too many requests. Please try again shortly.',
})
