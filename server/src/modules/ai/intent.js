/**
 * Intent extraction: free-text shopping request -> structured search criteria.
 *
 * This is step 1 of the grounding pipeline (docs/AI.md). It is deliberately deterministic
 * and rule-based rather than an LLM call, for two reasons:
 *
 *  1. It works with zero credentials configured, so the assistant is genuinely functional
 *     today rather than a UI shell waiting on a key. An LLM extractor can replace this
 *     behind the same interface later (see ai.service.js's `extractIntent` seam) — the
 *     grounding guarantees below do not depend on which extractor produced the criteria.
 *  2. Every field it emits is matched against the REAL catalogue (real category slugs, real
 *     brand slugs, real product types) before it is used. A criterion that matches nothing
 *     in the database is dropped, never guessed at.
 *
 * What this never does: invent a product, a price, a brand or a specification. It only ever
 * produces filters that catalog.service.listProducts already understands.
 */

/** "50k" -> 50000, "1 lakh"/"1.5 lakh" -> 100000/150000, "50,000" -> 50000. */
const MULTIPLIERS = [
  [/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs)/i, 100_000],
  [/(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/i, 10_000_000],
  [/(\d+(?:\.\d+)?)\s*k\b/i, 1_000],
]

/**
 * @param {boolean} explicit  true when a budget preposition ("under", "below", ...) already
 *   established that this number IS a price. A bare number floating in a sentence needs at
 *   least 3 digits to be read as a budget — "iphone 15" must not become "budget: Rs. 15" —
 *   but once the shopper has said "under", any number is a real stated ceiling and must be
 *   honoured. Requiring 3+ digits in both cases silently dropped "under 50" entirely, which
 *   is worse than a wrong budget: the constraint vanished with no indication.
 */
function parseAmount(text, { explicit = false } = {}) {
  for (const [pattern, multiplier] of MULTIPLIERS) {
    const match = pattern.exec(text)
    if (match) return Math.round(Number(match[1]) * multiplier)
  }
  const plain = new RegExp(`(?:rs\\.?|pkr)?\\s*([\\d,]${explicit ? '+' : '{3,}'})`, 'i').exec(text)
  if (plain) {
    const value = Number(plain[1].replace(/,/g, ''))
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return null
}

/**
 * Budget phrases, in priority order. "between X and Y" is checked first because it also
 * contains substrings that the single-bound patterns would otherwise match.
 */
function extractBudget(text) {
  const between = /(?:between|from)\s+(.{1,20}?)\s+(?:and|to|-)\s+(.{1,20}?)(?:\s|$|[.,])/i.exec(text)
  if (between) {
    const min = parseAmount(between[1], { explicit: true })
    const max = parseAmount(between[2], { explicit: true })
    if (min != null && max != null) return { minPrice: Math.min(min, max), maxPrice: Math.max(min, max) }
  }

  const under = /(?:under|below|less than|within|upto|up to|maximum|max|budget of|budget)\s+(?:rs\.?|pkr)?\s*([\d,.]+\s*(?:k|lakh|lac|lakhs|crore|cr)?)/i.exec(text)
  if (under) {
    const max = parseAmount(under[1], { explicit: true })
    if (max != null) return { maxPrice: max }
  }

  const over = /(?:over|above|more than|at least|minimum|min)\s+(?:rs\.?|pkr)?\s*([\d,.]+\s*(?:k|lakh|lac|lakhs|crore|cr)?)/i.exec(text)
  if (over) {
    const min = parseAmount(over[1], { explicit: true })
    if (min != null) return { minPrice: min }
  }

  return {}
}

/** Words that are about intent/quality, not about what the product IS — stripped before the
 * remaining text is used as a keyword query, so "best cheap laptop" searches for "laptop". */
const STOPWORDS = new Set([
  'i', 'me', 'my', 'need', 'want', 'looking', 'for', 'a', 'an', 'the', 'some', 'any',
  'best', 'good', 'top', 'nice', 'great', 'cheap', 'affordable', 'budget', 'quality',
  'buy', 'get', 'find', 'show', 'suggest', 'recommend', 'please', 'help', 'can', 'you',
  'under', 'below', 'over', 'above', 'less', 'than', 'more', 'within', 'upto', 'up', 'to',
  'between', 'and', 'or', 'with', 'without', 'in', 'on', 'at', 'of', 'is', 'are', 'be',
  'rs', 'pkr', 'rupees', 'price', 'priced', 'cost', 'costing', 'around', 'about',
  'mujhe', 'chahiye', 'ke', 'ki', 'ka', 'liye', 'hai', 'k',
  'something', 'anything', 'product', 'products', 'item', 'items', 'option', 'options',
  'gift', 'gifts', 'new', 'latest',
])

/** Explicit signals that the shopper cares about quality/reputation over price. */
const QUALITY_SIGNALS = /\b(best|top|highest rated|well[- ]reviewed|reliable|quality|premium|good)\b/i
const CHEAP_SIGNALS = /\b(cheap|cheapest|affordable|lowest price|budget|inexpensive|economical)\b/i
const DEAL_SIGNALS = /\b(deal|deals|discount|discounted|sale|offer|offers|bargain)\b/i

/**
 * Words that express *how* the shopper wants to choose, not *what* they want. These are
 * captured separately as sort/filter signals, so leaving them in the keyword query would
 * search the catalogue for products literally named "cheapest" — which match nothing, and
 * previously caused an otherwise-findable request to fall through to an irrelevant result set.
 */
const SIGNAL_WORDS = /\b(best|top|highest|rated|reliable|premium|cheap|cheapest|affordable|lowest|inexpensive|economical|deal|deals|discount|discounted|sale|offer|offers|bargain|reviewed)\b/gi

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(SIGNAL_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
}

/**
 * Matches free text against a real facet list (categories, brands, or product types loaded
 * from the database). Only exact-ish matches count — a facet whose full name appears in the
 * text, or whose name appears as a whole token. Nothing is fuzzy-guessed, because a wrong
 * category silently filters out every relevant product.
 */
function matchFacets(text, facets, { key = 'slug', label = 'name' } = {}) {
  const lower = text.toLowerCase()
  const matched = []
  for (const facet of facets) {
    const name = String(facet[label] ?? '').toLowerCase()
    if (!name) continue
    // Multi-word facet names ("Mobile & Tech Accessories") only match as a full phrase.
    // Single words match on a token boundary so "phone" doesn't match "headphones".
    const isMatch = name.includes(' ')
      ? lower.includes(name)
      : new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(lower)
    if (isMatch) matched.push(facet[key])
  }
  return matched
}

/**
 * @param {string} text          the shopper's own words
 * @param {object} facets        real catalogue facets: { categories, brands, types }
 * @returns {{criteria: object, signals: object, keywords: string[]}}
 */
export function extractIntent(text, facets) {
  const budget = extractBudget(text)

  const categories = matchFacets(text, facets.categories ?? [])
  const brands = matchFacets(text, facets.brands ?? [])
  const types = matchFacets(text, facets.types ?? [], { key: 'value', label: 'value' })

  const keywords = tokenize(text)

  const wantsQuality = QUALITY_SIGNALS.test(text)
  const wantsCheap = CHEAP_SIGNALS.test(text)
  const wantsDeal = DEAL_SIGNALS.test(text)

  // Sort follows the shopper's own stated priority. "cheapest" beats "best" when both
  // appear, because a price ceiling is a harder constraint than a vague quality preference.
  const sort = wantsCheap ? 'price-low' : wantsQuality ? 'rating' : 'recommended'

  const criteria = {
    ...budget,
    ...(categories.length ? { category: categories } : {}),
    ...(brands.length ? { brand: brands } : {}),
    ...(types.length ? { type: types } : {}),
    ...(wantsDeal ? { minDiscount: 1 } : {}),
    sort,
    availability: 'in-stock',
  }

  return {
    criteria,
    keywords,
    signals: { wantsQuality, wantsCheap, wantsDeal },
  }
}
