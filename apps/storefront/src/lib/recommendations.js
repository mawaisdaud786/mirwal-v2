/**
 * Real interest-based recommendation scoring.
 *
 * Every input here is a genuine signal this app already collects — nothing is invented to
 * make the algorithm look smarter than the data actually is:
 *
 *   - products a shopper has actually opened (`mirwal-recent-products`, written by
 *     ProductPage/HomePage — a real per-browser view history)
 *   - products currently in their cart
 *   - products a signed-in shopper has actually bought before (real order history)
 *
 * There is no wishlist, click-tracking or session preference data anywhere in this app (see
 * PROJECT_AUDIT.md) — so a category/brand a shopper only ever *looked at or bought* is the
 * whole signal. A brand-new guest has none of that yet, which is why every consumer of this
 * module always blends in a top-rated fallback pool rather than showing nothing.
 */

export const RECENT_PRODUCTS_KEY = 'mirwal-recent-products'
const RECENT_PRODUCTS_LIMIT = 8

/** Slugs of products this browser has opened, most-recent first. */
export function getRecentSlugs() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_PRODUCTS_KEY) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

/** Records a product view. Safe to call on every product page visit. */
export function recordProductView(slug) {
  if (!slug) return
  try {
    const recent = getRecentSlugs()
    const next = [slug, ...recent.filter((value) => value !== slug)].slice(0, RECENT_PRODUCTS_LIMIT)
    window.localStorage.setItem(RECENT_PRODUCTS_KEY, JSON.stringify(next))
  } catch {
    /* local storage may be unavailable (private browsing, quota) — viewing still works */
  }
}

// A view's weight fades fast: the last couple of products looked at say much more about
// current intent than the fifth or sixth, and everything past that is a weak, equal signal.
const VIEW_WEIGHTS = [3, 2]
const viewWeight = (index) => VIEW_WEIGHTS[index] ?? 1

function bump(scores, slug, amount) {
  if (!slug) return
  scores.set(slug, (scores.get(slug) || 0) + amount)
}

/**
 * Builds a scored interest profile from real product objects (already resolved from the
 * slugs/ids each signal source carries). Purchases outweigh what's in the cart right now,
 * which outweighs a plain view — spending money is the strongest statement of intent, an
 * active cart is a close second, a view alone is the weakest.
 *
 * @param {{viewedProducts?: object[], cartProducts?: object[], purchasedProducts?: object[]}} signals
 */
export function buildInterestProfile({ viewedProducts = [], cartProducts = [], purchasedProducts = [] }) {
  const categoryScores = new Map()
  const brandScores = new Map()
  const prices = []
  const excludeIds = new Set()

  const record = (product, weight, { exclude } = {}) => {
    if (!product) return
    bump(categoryScores, product.category?.slug, weight)
    bump(brandScores, product.brand?.slug, weight)
    if (product.price?.amount) prices.push(Number(product.price.amount))
    if (exclude) excludeIds.add(product.id)
  }

  purchasedProducts.forEach((product) => record(product, 5, { exclude: true }))
  cartProducts.forEach((product) => record(product, 3, { exclude: true }))
  // Excluded too: a product they've already opened should shape the category/brand score,
  // but re-suggesting that exact product back as "Recommended" is redundant, not useful.
  viewedProducts.forEach((product, index) => record(product, viewWeight(index), { exclude: true }))

  prices.sort((a, b) => a - b)
  const typicalPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null

  return { categoryScores, brandScores, typicalPrice, excludeIds }
}

/**
 * Scores one catalog candidate against an interest profile. Category/brand affinity carries
 * the most weight since that is the actual "based on your interest" signal; rating and
 * current discount are mild tie-breakers on real product data (never fabricated); the price
 * term nudges toward the shopper's own typical price band so a Rs. 2,000 accessory shopper
 * doesn't get topped with Rs. 300,000 laptops just because they share a category.
 */
export function scoreCandidate(product, profile) {
  let score = 0
  score += (profile.categoryScores.get(product.category?.slug) || 0) * 3
  score += (profile.brandScores.get(product.brand?.slug) || 0) * 2
  score += Math.log10(1 + product.rating.count) * product.rating.average
  if (product.discountPercent > 0) score += product.discountPercent * 0.05

  if (profile.typicalPrice && product.price?.amount) {
    const ratio = Number(product.price.amount) / profile.typicalPrice
    // Peaks at ratio 1 (same price band), fades to 0 by roughly 3x above or below it.
    score += Math.max(0, 2 - Math.abs(Math.log(ratio)))
  }

  return score
}

/**
 * Dedupes, excludes, scores and sorts a raw candidate pool down to `limit` recommendations.
 */
export function rankRecommendations(candidates, profile, { excludeIds = new Set(), limit = 5 } = {}) {
  const seen = new Set()
  const deduped = []
  for (const product of candidates) {
    if (!product || seen.has(product.id) || excludeIds.has(product.id)) continue
    seen.add(product.id)
    deduped.push(product)
  }

  return deduped
    .map((product) => ({ product, score: scoreCandidate(product, profile) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.product)
}
