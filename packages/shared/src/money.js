/**
 * Money handling for the frontend.
 *
 * The Phase 0 audit found `parseInt(price.replace(/\D/g, ''))` reimplemented in six files,
 * operating on display strings like "Rs. 234,000". That is unworkable for tax, discounts
 * or refunds, and it silently produced a Rs. 0 saving on the one product whose prices were
 * transposed.
 *
 * The API now sends money as `{ amount: "202000.00", currency: "PKR", display: "Rs 202,000" }`
 * — a string amount so nothing is pushed through a float in transit. Everything here works
 * in **integer minor units** (paisa) and only formats at the edge.
 *
 * During the migration some product sources are still the legacy mock shape with a string
 * price, so `toMinorUnits` accepts both. That tolerance is temporary and should be removed
 * once every source is API-backed.
 */

/**
 * Convert any supported price representation into integer minor units.
 * @param {{amount: string}|string|number|null|undefined} value
 * @returns {number} paisa
 */
export function toMinorUnits(value) {
  if (value === null || value === undefined) return 0

  if (typeof value === 'object' && value.amount !== undefined) {
    return Math.round(Number(value.amount) * 100)
  }
  if (typeof value === 'number') return Math.round(value * 100)

  // Legacy display string, e.g. "Rs. 202,000". Digits only, treated as whole rupees.
  const digits = String(value).replace(/[^0-9]/g, '')
  return digits ? Number(digits) * 100 : 0
}

/** Format integer minor units for display. */
export function formatMinorUnits(minor, currency = 'PKR') {
  const major = minor / 100
  if (currency === 'PKR') return `Rs. ${major.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
  return `${currency} ${major.toLocaleString('en-PK', { minimumFractionDigits: 2 })}`
}

export const currencyOf = (value) =>
  (typeof value === 'object' && value?.currency) || 'PKR'

/**
 * Normalise anything added to the cart into one canonical shape, so the cart does not have
 * to know whether an item came from the API or from the remaining mock pages.
 *
 * NOTE: these values are for display only. Once the cart is server-controlled (Phase 10)
 * the backend recalculates every figure and the client's numbers are informational.
 */
export function toCartItem(input, quantity = 1) {
  const price = input.price ?? input.amount
  const unitMinor = toMinorUnits(price)
  const compareMinor = toMinorUnits(input.compareAtPrice ?? input.old)

  return {
    id: input.id ?? input.slug,
    slug: input.slug ?? input.id,
    name: input.name,
    subtitle: input.subtitle ?? input.type ?? '',
    image: input.image ?? input.images?.[0]?.url ?? null,
    variantSku: input.variantSku ?? null,
    currency: currencyOf(price),
    unitMinor,
    // Only a genuine reduction counts; a "was" price below the current price is not a saving.
    compareMinor: compareMinor > unitMinor ? compareMinor : 0,
    quantity,
  }
}

export const lineTotal = (item) => item.unitMinor * item.quantity

/**
 * List price before any discount — the compare-at price where there is one, otherwise the
 * price paid. Subtotal must be built from this, not from the already-discounted price,
 * or the saving gets subtracted twice.
 */
export const lineListTotal = (item) =>
  (item.compareMinor > 0 ? item.compareMinor : item.unitMinor) * item.quantity
export const lineSaving = (item) =>
  item.compareMinor > 0 ? (item.compareMinor - item.unitMinor) * item.quantity : 0
