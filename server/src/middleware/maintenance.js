import { getSetting } from '../modules/settings/settings.service.js'

/**
 * Maintenance mode.
 *
 * The admin panel had a maintenance screen whose toggle wrote to component state and nothing
 * else. This is what makes it real: with `maintenance.enabled` on, storefront and seller
 * traffic gets 503, and the storefront can render the operator's message instead of a
 * half-loaded page full of failed requests.
 *
 * Three things always stay reachable, and each one is a lockout waiting to happen otherwise:
 *
 *  - Authentication. Someone has to be able to sign in to switch this back off.
 *  - Everything under /admin. Staff need the panel that owns the toggle.
 *  - /health. A load balancer that cannot health-check will pull the box out of rotation
 *    and turn a maintenance window into an outage.
 *
 * Staff are additionally let through everywhere, so an admin can check the storefront while
 * it is closed to the public.
 *
 * The setting is cached for a few seconds. Reading it per request would put a query in front
 * of every single call for a value that changes perhaps twice a year; a few seconds of
 * staleness when switching on is not worth that.
 */

const CACHE_MS = 5_000
let cache = { at: 0, value: null }

/** Drop the cache so a toggle takes effect immediately for whoever flipped it. */
export function invalidateMaintenanceCache() {
  cache = { at: 0, value: null }
}

async function readMaintenance() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value

  try {
    const [enabled, message, allowIps] = await Promise.all([
      getSetting('maintenance.enabled', false),
      getSetting('maintenance.message', ''),
      getSetting('maintenance.allow_ips', []),
    ])
    cache = {
      at: Date.now(),
      value: {
        enabled: Boolean(enabled),
        message: String(message ?? ''),
        allowIps: Array.isArray(allowIps) ? allowIps : [],
      },
    }
  } catch {
    // A database that cannot answer is its own outage; refusing every request on top of it
    // would only hide the real fault. Fail open and let the route report the real error.
    cache = { at: Date.now(), value: { enabled: false, message: '', allowIps: [] } }
  }
  return cache.value
}

const ALWAYS_ALLOWED = [/^\/health$/, /\/auth\//, /^\/api\/v\d+\/admin(\/|$)/]

export async function maintenanceMode(req, res, next) {
  const { enabled, message, allowIps } = await readMaintenance()
  if (!enabled) return next()

  if (ALWAYS_ALLOWED.some((pattern) => pattern.test(req.path))) return next()

  // optionalAuth has already run, so a staff session is visible here without a second lookup.
  const roles = req.user?.roles ?? []
  if (roles.includes('admin') || roles.includes('super_admin')) return next()

  if (allowIps.length > 0 && allowIps.includes(req.ip)) return next()

  // Retry-After is omitted on purpose: nobody knows how long the window will last, and a
  // guessed value tells crawlers something untrue.
  return res.status(503).json({
    success: false,
    error: {
      code: 'MAINTENANCE_MODE',
      message: message || 'Mirwal is briefly down for maintenance. Please try again shortly.',
    },
  })
}
