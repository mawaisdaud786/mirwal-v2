import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { getNumericSetting, getSetting } from '../settings/settings.service.js'

/**
 * What an order actually costs.
 *
 * Everything here is computed server-side from the database and the platform settings. The
 * client sends what it wants (a coupon code, a chosen shipping method) and never a number:
 * a checkout that trusts a price from the browser is a checkout that can be bought from for
 * one rupee.
 *
 * Three things previously did not exist at all and were silently wrong rather than absent:
 *
 *   * shipping was `const shippingFee = 0`, so every order total, GMV figure, commission and
 *     payout was computed from a number that did not match what delivery costs;
 *   * coupons and promotions were a complete CRUD surface with no effect on any order, so
 *     `coupon_redemptions` could never gain a row;
 *   * tax had nowhere to live.
 *
 * The subtle part is apportionment. An order-level discount has to be pushed down onto the
 * individual lines, because a seller is paid per line and Mirwal's commission is charged per
 * line. Without it a marketplace-funded coupon quietly comes out of the seller's earnings,
 * which is the fastest way to lose a seller's trust permanently.
 */

export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

/**
 * Split `total` across `weights` so the parts sum to exactly `total`.
 *
 * Largest-remainder: each share is floored to the paisa, then the leftover paisas are handed
 * out to the largest remainders first. Naive rounding per line loses or invents up to a
 * paisa per line, and an order whose parts do not sum to its whole is an order whose seller
 * statements never reconcile.
 */
export function apportion(total, weights) {
  const cents = Math.round(round2(total) * 100)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (cents === 0 || totalWeight <= 0) return weights.map(() => 0)

  const exact = weights.map((weight) => (cents * weight) / totalWeight)
  const floors = exact.map(Math.floor)
  let remainder = cents - floors.reduce((sum, value) => sum + value, 0)

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (const entry of order) {
    if (remainder <= 0) break
    floors[entry.index] += 1
    remainder -= 1
  }
  return floors.map((value) => value / 100)
}

/**
 * Resolve the delivery charge for this address and basket.
 *
 * Re-quoted here rather than trusting the figure the checkout page displayed, for the same
 * reason line prices are re-read from the database: the browser is not a source of truth
 * about money. `methodPublicId` selects among the options the shopper was legitimately
 * offered; an unknown or inactive one is refused rather than silently falling back, so a
 * shopper is never charged for a service they did not choose.
 */
export async function resolveShipping(connection, { city, countryCode = 'PK', subtotal, methodPublicId }) {
  const [zones] = await connection.execute(
    'SELECT * FROM shipping_zones WHERE is_active = 1 ORDER BY priority, id',
  )

  const wantedCountry = String(countryCode || 'PK').toUpperCase()
  const wantedCity = String(city || '').trim().toLowerCase()

  const zone = zones.find((row) => {
    const countries = safeJson(row.country_codes, [])
    const cities = safeJson(row.cities, [])
    const countryOk = countries.length === 0 || countries.includes(wantedCountry)
    const cityOk = cities.length === 0 || (wantedCity && cities.map(lower).includes(wantedCity))
    return countryOk && cityOk
  })

  // No zone covers this address. The platform default is the honest answer — refusing the
  // order would strand every shopper outside a configured city.
  if (!zone) {
    const fallback = await getNumericSetting('shipping.default_fee', { fallback: 0, max: 1_000_000 })
    return { methodId: null, name: 'Standard delivery', amount: round2(fallback) }
  }

  const [methods] = await connection.execute(
    'SELECT * FROM shipping_methods WHERE zone_id = ? AND is_active = 1 ORDER BY sort_order, name',
    [zone.id],
  )
  if (!methods.length) {
    const fallback = await getNumericSetting('shipping.default_fee', { fallback: 0, max: 1_000_000 })
    return { methodId: null, name: 'Standard delivery', amount: round2(fallback) }
  }

  let method = methods[0]
  if (methodPublicId) {
    const chosen = methods.find((row) => row.public_id === methodPublicId)
    if (!chosen) {
      throw badRequest(
        'That delivery option is not available for this address. Please choose again.',
        'SHIPPING_METHOD_UNAVAILABLE',
      )
    }
    method = chosen
  }

  return { methodId: method.id, name: method.name, amount: priceMethod(method, subtotal) }
}

/** The rate rules from migration 018, applied to one basket. */
function priceMethod(method, subtotal) {
  const basket = Number(subtotal)
  if (method.rate_type === 'free_over'
    && method.free_over_amount !== null
    && basket >= Number(method.free_over_amount)) {
    return 0
  }
  if (method.rate_type === 'percentage' && method.rate_bps !== null) {
    let amount = (basket * Number(method.rate_bps)) / 10_000
    if (method.min_amount !== null) amount = Math.max(amount, Number(method.min_amount))
    if (method.max_amount !== null) amount = Math.min(amount, Number(method.max_amount))
    return round2(amount)
  }
  return round2(method.base_amount)
}

/**
 * Validate a coupon and work out what it is worth on this basket.
 *
 * Every rule is checked inside the caller's transaction, with the coupon row locked, because
 * a usage limit that is checked and then acted on in two statements is a usage limit two
 * simultaneous checkouts can both pass.
 *
 * A seller-owned coupon only discounts that seller's lines — `eligibleSubtotal` is what the
 * percentage or cap applies to, not the whole basket. Getting that wrong lets a seller's 20%
 * code discount a competitor's goods in the same cart.
 *
 * Returns null when no code was supplied. Throws when a code was supplied and is not usable:
 * a shopper who typed a code and saw it silently ignored will call support.
 */
export async function resolveCoupon(connection, { code, buyerId, lines }) {
  if (!code) return null

  const [rows] = await connection.execute(
    `SELECT * FROM coupons
      WHERE code = ? AND deleted_at IS NULL
      FOR UPDATE`,
    [code],
  )
  const coupon = rows[0]
  if (!coupon) throw notFound('That code is not valid.', 'COUPON_NOT_FOUND')

  if (coupon.status !== 'active') {
    throw conflict('That code is not active.', 'COUPON_INACTIVE')
  }
  const now = new Date()
  if (coupon.starts_at && new Date(`${coupon.starts_at}Z`) > now) {
    throw conflict('That code is not usable yet.', 'COUPON_NOT_STARTED')
  }
  if (coupon.ends_at && new Date(`${coupon.ends_at}Z`) <= now) {
    throw conflict('That code has expired.', 'COUPON_EXPIRED')
  }

  // Which lines the coupon may touch. NULL seller_id = a Mirwal-wide code.
  const eligible = coupon.seller_id === null
    ? lines
    : lines.filter((line) => String(line.sellerId) === String(coupon.seller_id))
  if (!eligible.length) {
    throw conflict('That code does not apply to anything in your cart.', 'COUPON_NOT_APPLICABLE')
  }
  const eligibleSubtotal = round2(eligible.reduce((sum, line) => sum + line.lineTotal, 0))

  if (Number(coupon.min_order_amount) > 0 && eligibleSubtotal < Number(coupon.min_order_amount)) {
    throw conflict(
      `This code needs a qualifying subtotal of at least ${Number(coupon.min_order_amount).toFixed(2)}.`,
      'COUPON_MINIMUM_NOT_MET',
    )
  }

  // Usage limits, counted from the redemption ledger rather than the denormalised
  // `usage_count`, which is a cache and must never be the thing a limit is enforced on.
  if (coupon.usage_limit !== null) {
    const [[used]] = await connection.execute(
      'SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ?',
      [coupon.id],
    )
    if (Number(used.n) >= Number(coupon.usage_limit)) {
      throw conflict('That code has been fully redeemed.', 'COUPON_EXHAUSTED')
    }
  }
  if (coupon.usage_limit_per_user !== null) {
    const [[mine]] = await connection.execute(
      'SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?',
      [coupon.id, buyerId],
    )
    if (Number(mine.n) >= Number(coupon.usage_limit_per_user)) {
      throw conflict('You have already used that code.', 'COUPON_ALREADY_USED')
    }
  }

  let discount = 0
  let freeShipping = false
  if (coupon.discount_type === 'percentage') {
    discount = (eligibleSubtotal * Number(coupon.discount_bps)) / 10_000
  } else if (coupon.discount_type === 'fixed') {
    discount = Number(coupon.discount_amount)
  } else {
    freeShipping = true
  }

  if (coupon.max_discount_amount !== null) {
    discount = Math.min(discount, Number(coupon.max_discount_amount))
  }
  // A discount can never exceed what it applies to. Without this clamp a fixed-amount code
  // larger than the basket produces a negative total, which the CHECK constraint on `orders`
  // would then reject as a 500 rather than a clear message.
  discount = round2(Math.min(discount, eligibleSubtotal))

  return {
    id: coupon.id,
    code: coupon.code,
    discount,
    freeShipping,
    // A seller's own code is funded by that seller; a Mirwal-wide code is funded by Mirwal
    // and must not be deducted from anyone's earnings.
    fundedBy: coupon.seller_id === null ? 'platform' : 'seller',
    eligibleLineIds: new Set(eligible.map((line) => line.key)),
  }
}

/**
 * Sales tax on an order.
 *
 * Two modes, because both are normal in Pakistan and getting the distinction wrong misstates
 * every price on the site:
 *   * prices include tax — the listed price already contains it, so tax is extracted for the
 *     breakdown and adds nothing to the total;
 *   * prices exclude tax — it is added on top.
 */
export async function computeTax(taxableBase) {
  const bps = await getNumericSetting('tax.default_rate_bps', { fallback: 0, max: 10_000 })
  if (bps === 0) return { amount: 0, inclusive: true, bps: 0 }

  const inclusive = Boolean(await getSetting('tax.prices_include_tax', true))
  const base = Number(taxableBase)
  const amount = inclusive
    ? base - (base * 10_000) / (10_000 + bps)
    : (base * bps) / 10_000

  return { amount: round2(amount), inclusive, bps }
}

/**
 * Turn the order-level figures into per-line ones.
 *
 * Each line receives its share of the discount and of the tax, weighted by line value, so
 * that summing the lines reproduces the order exactly. This is what makes a seller statement
 * reconcile against the order it came from.
 */
export function allocateToLines(lines, { discount, coupon, tax }) {
  const discountable = coupon
    ? lines.filter((line) => coupon.eligibleLineIds.has(line.key))
    : []
  const shares = apportion(discount, discountable.map((line) => line.lineTotal))
  const byKey = new Map(discountable.map((line, index) => [line.key, shares[index]]))

  const taxShares = apportion(tax.amount, lines.map((line) => line.lineTotal))

  return lines.map((line, index) => {
    const lineDiscount = byKey.get(line.key) ?? 0
    return {
      ...line,
      discountAmount: lineDiscount,
      taxAmount: taxShares[index],
      // 'none' when this line was not discounted at all, so the funding column never claims
      // a funder for a discount that did not happen.
      discountFundedBy: lineDiscount > 0 ? (coupon?.fundedBy ?? 'none') : 'none',
    }
  })
}

const lower = (value) => String(value).trim().toLowerCase()

function safeJson(column, fallback) {
  if (column == null) return fallback
  if (typeof column === 'object') return column
  try { return JSON.parse(column) } catch { return fallback }
}

