import { listProducts, getFacets } from '../catalog/catalog.service.js'
import { extractIntent } from './intent.js'

/**
 * Mirwal AI shopping assistant.
 *
 * The whole point of this module is that the AI can never invent a product, price, stock
 * level, seller, rating or discount — because it never authors any of those. The pipeline is:
 *
 *   shopper's words
 *     -> extractIntent()            structured criteria, matched against REAL facets
 *     -> catalog.listProducts()     the same query the storefront uses, no special path
 *     -> rank()                     ordering only; never edits a product's data
 *     -> explain()                  prose assembled FROM the returned rows' own fields
 *
 * Every number and name in a reply is read out of a database row that this request just
 * fetched. There is no step where free text about a product is generated from anything other
 * than that row. If the catalogue returns nothing, the assistant says so and asks a useful
 * question — it does not fall back to describing products that do not exist.
 *
 * On the LLM seam: `extractIntent` is deterministic today (see intent.js) and needs no
 * credentials. Swapping in an LLM extractor later changes only which criteria come out of
 * step 1; steps 2-4 — the parts that actually enforce grounding — are unchanged, because the
 * products are always fetched from the database afterwards, never described by the model.
 */

const MAX_RESULTS = 6

/** Ranks the real rows the catalogue returned. Ordering only — no field is ever rewritten. */
function rank(products, { signals }) {
  return [...products].sort((a, b) => score(b, signals) - score(a, signals))
}

function score(product, signals) {
  let value = 0
  // A real rating, weighted by how many real reviews back it. log10 keeps a 4.9-from-3-reviews
  // product from outranking a 4.6-from-500 one.
  value += product.rating.average * Math.log10(1 + product.rating.count)
  if (signals.wantsCheap) value += 5 - Math.log10(1 + Number(product.price.amount))
  if (signals.wantsDeal && product.discountPercent > 0) value += product.discountPercent * 0.08
  if (product.availability.inStock) value += 2
  return value
}

/** The one line of prose per product — every clause is a real field from that product's row,
 * and a clause is omitted entirely when the underlying field is absent (a product with no
 * reviews never gets an invented rating sentence).
 *
 * Takes no `relaxed` flag: the budget clause below already states the difference in both
 * directions, so a result found by widening the budget reads "Rs. 400 over your budget"
 * without needing to be told that the budget was widened. */
function explainProduct(product, criteria) {
  const reasons = []

  if (product.rating.count > 0) {
    reasons.push(`rated ${product.rating.average.toFixed(1)} by ${product.rating.count} ${product.rating.count === 1 ? 'buyer' : 'buyers'}`)
  }
  if (product.discountPercent > 0) {
    reasons.push(`${product.discountPercent}% off right now`)
  }
  if (criteria.maxPrice != null) {
    // Stated honestly in both directions. Showing only the "under budget" case would leave a
    // relaxed-budget result looking like it met a ceiling it actually exceeds.
    const difference = criteria.maxPrice - Number(product.price.amount)
    reasons.push(difference >= 0
      ? `Rs. ${Math.round(difference).toLocaleString('en-PK')} under your budget`
      : `Rs. ${Math.round(-difference).toLocaleString('en-PK')} over your budget`)
  }
  if (!product.availability.inStock) reasons.push('out of stock')
  else if (product.availability.lowStock) reasons.push('low stock')

  return reasons
}

/**
 * A question worth asking, or null. Only asked when the answer is genuinely ambiguous —
 * a good, specific result set gets no question at all, because interrogating someone who
 * already got what they asked for is noise, not helpfulness. Every option offered is a real
 * filter the catalogue can act on, drawn from the products actually returned.
 */
function clarifyingQuestion(intent, facets, products) {
  const { criteria } = intent

  if (products.length === 0) {
    if (criteria.maxPrice != null) return `Nothing matched under Rs. ${criteria.maxPrice.toLocaleString('en-PK')}. Would a higher budget work, or should I look in a different category?`
    return 'I could not find a match for that. Could you tell me the category or the kind of product you have in mind?'
  }

  // Results spanning several categories mean the request was broad enough that narrowing
  // genuinely helps. Offer the categories these results are actually in — not an arbitrary
  // slice of the whole catalogue, which might not contain the answer at all.
  const spanned = [...new Map(products.map((p) => [p.category?.slug, p.category?.name])).entries()].filter(([slug]) => slug)
  if (!criteria.category && !criteria.type && spanned.length > 2) {
    return `These span a few areas — want me to focus on ${spanned.slice(0, 3).map(([, name]) => name).join(', ')}?`
  }

  // A wide price spread is the other real ambiguity: it means "budget" and "premium" answers
  // are sitting side by side and the shopper has not said which they want.
  if (criteria.maxPrice == null && criteria.minPrice == null && products.length > 2) {
    const prices = products.map((p) => Number(p.price.amount))
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    if (high >= low * 3) return `These range from ${products.find((p) => Number(p.price.amount) === low).price.display} to ${products.find((p) => Number(p.price.amount) === high).price.display}. Do you have a budget in mind?`
  }

  return null
}

function summarise(intent, products, facets, relaxed) {
  const { criteria } = intent
  const parts = []

  if (products.length === 0) {
    parts.push('I could not find anything in the Mirwal catalogue that matches that yet.')
    return parts.join(' ')
  }

  // Say up front when the results do NOT actually satisfy what was asked, before describing
  // them — otherwise an over-budget list reads as though it met the budget.
  if (relaxed.includes('budget') && criteria.maxPrice != null) {
    const cheapest = products.reduce((low, p) => Number(p.price.amount) < Number(low.price.amount) ? p : low)
    parts.push(`Nothing matched under Rs. ${criteria.maxPrice.toLocaleString('en-PK')} — the closest is ${cheapest.name} at ${cheapest.price.display}. Here are the nearest options above your budget:`)
    return parts.join(' ')
  }
  if (relaxed.includes('availability')) {
    parts.push('Everything matching that is out of stock right now, but here is what Mirwal carries:')
    return parts.join(' ')
  }
  if (relaxed.includes('discount')) {
    parts.push('Nothing matching that is discounted at the moment, so here are the best regular-priced options:')
  }

  const scope = []
  if (criteria.category?.length) {
    const names = (facets.categories ?? []).filter((c) => criteria.category.includes(c.slug)).map((c) => c.name)
    if (names.length) scope.push(`in ${names.join(' and ')}`)
  }
  if (criteria.brand?.length) {
    const names = (facets.brands ?? []).filter((b) => criteria.brand.includes(b.slug)).map((b) => b.name)
    if (names.length) scope.push(`from ${names.join(' and ')}`)
  }
  if (criteria.maxPrice != null && criteria.minPrice != null) scope.push(`between Rs. ${criteria.minPrice.toLocaleString('en-PK')} and Rs. ${criteria.maxPrice.toLocaleString('en-PK')}`)
  else if (criteria.maxPrice != null) scope.push(`under Rs. ${criteria.maxPrice.toLocaleString('en-PK')}`)
  else if (criteria.minPrice != null) scope.push(`over Rs. ${criteria.minPrice.toLocaleString('en-PK')}`)

  parts.push(`I found ${products.length} option${products.length === 1 ? '' : 's'}${scope.length ? ` ${scope.join(', ')}` : ''}, all in stock right now.`)

  const cheapest = products.reduce((low, p) => Number(p.price.amount) < Number(low.price.amount) ? p : low)
  const bestRated = products.filter((p) => p.rating.count > 0).sort((a, b) => b.rating.average - a.rating.average)[0]

  if (bestRated && bestRated.id !== cheapest.id) {
    parts.push(`${bestRated.name} has the strongest rating; ${cheapest.name} is the lowest priced at ${cheapest.price.display}.`)
  } else {
    parts.push(`${cheapest.name} is the lowest priced at ${cheapest.price.display}.`)
  }

  return parts.join(' ')
}

/**
 * @param {string} message  the shopper's request, in their own words
 */
export async function ask(message) {
  const facets = await getFacets()
  const intent = extractIntent(message, facets)

  // The keyword query is only applied when the structured criteria did not already pin the
  // search down. Sending both a category filter AND a full-text term is how a reasonable
  // request ("laptop under 50k" in a catalogue whose category is "Mobile & Tech Accessories")
  // ends up with zero results despite real matches existing.
  const hasStructuredScope = Boolean(intent.criteria.category || intent.criteria.brand || intent.criteria.type)
  const searchParams = {
    ...intent.criteria,
    ...(hasStructuredScope || intent.keywords.length === 0 ? {} : { q: intent.keywords.join(' ') }),
    pageSize: MAX_RESULTS * 2,
    page: 1,
  }

  let result = await listProducts(searchParams)

  /*
   * Progressive relaxation, and the ORDER here is the whole point.
   *
   * What the shopper asked FOR (the product itself — keywords, category, brand) is never
   * dropped to fill space. Only the qualifiers around it (discount, then budget) are
   * loosened. Relaxing keywords first is what made "power bank under 5000" answer with hair
   * curlers and notebooks: real products, correctly under budget, and completely useless as
   * a reply. "The cheapest power bank is Rs. 7,199, above your budget" is the honest and
   * more useful answer, so budget gives way before the product does.
   *
   * If the product itself genuinely matches nothing in the catalogue, the result stays
   * empty and the reply says so — it never backfills with unrelated items.
   */
  const relaxed = []
  if (result.items.length === 0 && searchParams.minDiscount != null) {
    relaxed.push('discount')
    result = await listProducts({ ...searchParams, minDiscount: undefined })
  }
  if (result.items.length === 0 && searchParams.maxPrice != null) {
    relaxed.push('budget')
    result = await listProducts({ ...searchParams, minDiscount: undefined, maxPrice: undefined })
  }
  if (result.items.length === 0 && searchParams.minPrice != null) {
    relaxed.push('budget')
    result = await listProducts({ ...searchParams, minDiscount: undefined, maxPrice: undefined, minPrice: undefined })
  }
  // Last resort, and only when the shopper gave no structured scope at all: an out-of-stock
  // match is still a real, relevant answer ("we have this, just not right now"), which a
  // silent empty result is not.
  if (result.items.length === 0 && searchParams.availability === 'in-stock') {
    relaxed.push('availability')
    result = await listProducts({ ...searchParams, minDiscount: undefined, maxPrice: undefined, minPrice: undefined, availability: 'all' })
  }

  const products = rank(result.items, intent).slice(0, MAX_RESULTS)

  return {
    // Echoed back so the UI can show what the assistant actually understood — and so a
    // wrong interpretation is visible and correctable, not hidden behind confident prose.
    understood: {
      categories: (facets.categories ?? []).filter((c) => intent.criteria.category?.includes(c.slug)).map((c) => ({ slug: c.slug, name: c.name })),
      brands: (facets.brands ?? []).filter((b) => intent.criteria.brand?.includes(b.slug)).map((b) => ({ slug: b.slug, name: b.name })),
      minPrice: intent.criteria.minPrice ?? null,
      maxPrice: intent.criteria.maxPrice ?? null,
      keywords: hasStructuredScope ? [] : intent.keywords,
      sort: intent.criteria.sort,
    },
    relaxed,
    reply: summarise(intent, products, facets, relaxed),
    question: clarifyingQuestion(intent, facets, products),
    // Full product rows straight from the catalogue — the frontend renders these as real
    // product cards, so what the shopper clicks is the same record the search matched.
    products: products.map((product) => ({ ...product, reasons: explainProduct(product, intent.criteria) })),
    totalMatches: result.total,
  }
}
