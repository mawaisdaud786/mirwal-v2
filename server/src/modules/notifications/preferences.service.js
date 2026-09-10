import { query, queryOne } from '../../db/pool.js'
import { parseJsonColumn } from '../../lib/json.js'

/**
 * What reaches a person, and how.
 *
 * `users.notification_channels` and `users.notification_preferences` have existed since
 * migration 027 and the storefront has had a settings panel writing to them the whole time.
 * Nothing has ever read them. Turning "Email Notifications" off changed a JSON column and
 * nothing else — every message still went out, which is worse than having no setting at all:
 * a control that visibly does nothing teaches people the whole account is untrustworthy.
 *
 * Three decisions shape this:
 *
 * **Categories, not message types.** The old panel toggled whatever five keys happened to come
 * first in an icon lookup table. Nobody has an opinion about `order_status_changed` as distinct
 * from `item_cancelled`; they have an opinion about hearing from Mirwal about their orders. So
 * preferences are expressed over five categories a person can actually reason about, and every
 * template and notification type maps into one.
 *
 * **Security cannot be switched off.** A password change, a new-device sign-in, a changed
 * payout destination — these exist to be noticed by the person who did *not* do them, and an
 * attacker who has the session would simply turn them off first. They are marked `forced` and
 * the resolver ignores any stored preference against them.
 *
 * **Default on.** An absent key means yes. Anything else would mean that everyone who has never
 * opened the settings page silently stops receiving their order updates.
 */

/** The five things a person actually has an opinion about. */
export const CATEGORIES = [
  {
    key: 'orders',
    label: 'Orders and delivery',
    description: 'Confirmations, dispatch, delivery and cancellations.',
  },
  {
    key: 'returns',
    label: 'Returns and refunds',
    description: 'Progress on a return you have filed, and refunds.',
  },
  {
    key: 'account',
    label: 'Your account and store',
    description: 'Applications, verification, listings and payouts.',
  },
  {
    key: 'security',
    label: 'Security',
    description: 'Sign-ins from new devices, password and payout changes.',
    // Never optional. See above.
    forced: true,
  },
  {
    key: 'marketing',
    label: 'Offers and recommendations',
    description: 'Price drops, promotions and things Mirwal thinks you would like.',
  },
]

export const CHANNELS = [
  { key: 'inApp', label: 'In the app', forced: true },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
]

/**
 * Which category a message belongs to.
 *
 * Keyed on the prefix the template and notification names already use, with the handful of
 * exceptions spelled out. A name that matches nothing lands in `account`, which is the
 * category a person is least likely to have switched off — an unclassified message going
 * missing is a worse failure than one arriving in the wrong bucket.
 */
const EXPLICIT = {
  'account.password_reset': 'security',
  'account.password_changed': 'security',
  'account.verify_email': 'security',
  'account.verify_phone': 'security',
  'order.refunded': 'returns',
}

export function categoryFor(name = '') {
  const key = String(name)
  if (EXPLICIT[key]) return EXPLICIT[key]
  if (key.startsWith('security.')) return 'security'
  if (key.startsWith('order.') || key.startsWith('order_') || key.startsWith('item_')) return 'orders'
  if (key.startsWith('return') || key.startsWith('refund')) return 'returns'
  if (key.startsWith('marketing.') || key.startsWith('promo')) return 'marketing'
  return 'account'
}

const FORCED_CATEGORIES = new Set(CATEGORIES.filter((category) => category.forced).map((c) => c.key))

/**
 * May we send this to this person, on this channel?
 *
 * Called from inside `messaging.send` and `createNotification` rather than at each call site,
 * because a gate that every caller has to remember is a gate that will be forgotten. A user
 * we cannot read is treated as opted in — failing closed here would mean a database hiccup
 * silently swallowed someone's delivery notification.
 */
export async function mayNotify(userId, name, channel = 'inApp') {
  if (!userId) return true

  const category = categoryFor(name)
  if (FORCED_CATEGORIES.has(category)) return true
  if (channel === 'inApp') {
    // In-app is the record, not an interruption. A person who has switched a category off
    // still gets it in their notification list; what they have turned off is being contacted.
    return categoryEnabled(await load(userId), category)
  }

  const stored = await load(userId)
  if (!stored) return true
  if (stored.channels[channel] === false) return false
  return categoryEnabled(stored, category)
}

function categoryEnabled(stored, category) {
  if (!stored) return true
  // Absent means yes: nobody who has never opened the settings page should stop hearing from us.
  return stored.preferences[category] !== false
}

async function load(userId) {
  const row = await queryOne(
    'SELECT notification_channels, notification_preferences FROM users WHERE id = ?',
    [userId],
  )
  if (!row) return null
  return {
    // mysql2 hands JSON columns back parsed on some paths and as a string on others; this is
    // the codebase's answer to exactly that ambiguity.
    channels: parseJsonColumn(row.notification_channels, {}),
    preferences: parseJsonColumn(row.notification_preferences, {}),
  }
}

/** What the settings page renders, and what the account currently has set. */
export async function getPreferences(userId) {
  const stored = (await load(userId)) ?? { channels: {}, preferences: {} }
  return {
    categories: CATEGORIES.map((category) => ({
      ...category,
      enabled: category.forced ? true : stored.preferences[category.key] !== false,
    })),
    channels: CHANNELS.map((channel) => ({
      ...channel,
      enabled: channel.forced ? true : stored.channels[channel.key] !== false,
    })),
  }
}

/**
 * Save a change.
 *
 * Merges rather than replaces: the panel sends only what was toggled, so a client that does
 * not know about a category added later cannot switch it off by omission. Forced categories
 * and channels are dropped on the way in — accepting `security: false` and quietly ignoring it
 * would leave the caller believing it had taken effect.
 */
export async function setPreferences(userId, { categories = {}, channels = {} }) {
  const stored = (await load(userId)) ?? { channels: {}, preferences: {} }

  const nextCategories = { ...stored.preferences }
  for (const [key, value] of Object.entries(categories)) {
    const known = CATEGORIES.find((category) => category.key === key)
    if (!known || known.forced) continue
    nextCategories[key] = value
  }

  const nextChannels = { ...stored.channels }
  for (const [key, value] of Object.entries(channels)) {
    const known = CHANNELS.find((channel) => channel.key === key)
    if (!known || known.forced) continue
    nextChannels[key] = value
  }

  await query(
    'UPDATE users SET notification_preferences = ?, notification_channels = ? WHERE id = ?',
    [JSON.stringify(nextCategories), JSON.stringify(nextChannels), userId],
  )
  return getPreferences(userId)
}
