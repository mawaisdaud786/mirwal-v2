import { useMemo } from 'react'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { useSession } from '../components/useSession'
import { getRecentSlugs, buildInterestProfile, rankRecommendations } from '../lib/recommendations'

async function resolveProducts(slugs, signal) {
  const resolved = await Promise.all(slugs.map((slug) => api.products.get(slug, signal).catch(() => null)))
  return resolved.filter(Boolean)
}

function topSlugs(scoreMap, count) {
  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([slug]) => slug)
}

async function buildRecommendations({ recentSlugs, purchasedSlugs, cartSlugs, excludeId, limit, signal }) {
  // Every signal source only ever carries a slug; each is resolved to a real, current
  // product exactly once here, however many sources it appears in.
  const uniqueSlugs = [...new Set([...recentSlugs, ...purchasedSlugs, ...cartSlugs])]
  const resolved = await resolveProducts(uniqueSlugs, signal)
  const bySlug = new Map(resolved.map((product) => [product.slug, product]))
  const lookup = (slugs) => slugs.map((slug) => bySlug.get(slug)).filter(Boolean)

  const profile = buildInterestProfile({
    viewedProducts: lookup(recentSlugs),
    cartProducts: lookup(cartSlugs),
    purchasedProducts: lookup(purchasedSlugs),
  })

  const categoryPool = topSlugs(profile.categoryScores, 2)
  const brandPool = topSlugs(profile.brandScores, 2)
  // Generous over-fetch: the candidate pool has to survive excluding everything already
  // owned/carted, deduping across pools, and still leave enough left to fill `limit`.
  const pageSize = Math.min(60, limit + cartSlugs.length + 10)

  const queries = [
    ...categoryPool.map((slug) => api.products.list({ category: slug, sort: 'rating', pageSize, availability: 'in-stock' }, signal)),
    ...brandPool.map((slug) => api.products.list({ brand: slug, sort: 'rating', pageSize, availability: 'in-stock' }, signal)),
    // Cold-start / gap-filling fallback — a guest with no signal yet (or a profile too thin
    // to fill `limit` on its own) still gets a full, sensible list, same as before this
    // algorithm existed.
    api.products.list({ sort: 'rating', pageSize, availability: 'in-stock' }, signal),
  ]
  const pages = await Promise.all(queries)
  const candidates = pages.flatMap((page) => page.items ?? [])

  const excludeIds = new Set(profile.excludeIds)
  if (excludeId) excludeIds.add(excludeId)

  return rankRecommendations(candidates, profile, { excludeIds, limit })
}

/**
 * Real interest-based recommendations for one shopper: scores live catalog products against
 * what they've actually viewed, have in their cart right now, and — if signed in — have
 * actually bought before, then ranks candidates pulled from their strongest categories and
 * brands. A guest or a shopper with no history yet still gets a sensible top-rated list; the
 * personalization only ever adds to that, it never has to invent a substitute for it.
 *
 * @param {{cartItems?: object[], excludeId?: string, limit?: number}} [options]
 */
export function useRecommendedProducts({ cartItems = [], excludeId, limit = 5 } = {}) {
  const { user } = useSession()
  const recentSlugs = useMemo(() => getRecentSlugs(), [])
  const cartSlugs = useMemo(() => [...new Set(cartItems.map((item) => item.slug).filter(Boolean))], [cartItems])

  const ordersEnabled = Boolean(user)
  const ordersQuery = useApiQuery((signal) => api.orders.list(signal), [ordersEnabled], { enabled: ordersEnabled })
  const purchasedSlugs = useMemo(() => {
    if (!ordersQuery.data) return []
    const slugs = ordersQuery.data.flatMap((order) => order.items?.map((item) => item.product.slug) ?? [])
    return [...new Set(slugs)].slice(0, 10)
  }, [ordersQuery.data])

  // Waits for the purchase signal to settle (success or failure) before scoring, rather than
  // scoring twice — once without it, once with — which would flash an unpersonalized list
  // first for every signed-in shopper.
  const signalsReady = !ordersEnabled || Boolean(ordersQuery.data) || Boolean(ordersQuery.error)

  const { data, isLoading } = useApiQuery(
    (signal) => buildRecommendations({ recentSlugs, purchasedSlugs, cartSlugs, excludeId, limit, signal }),
    [recentSlugs.join(','), purchasedSlugs.join(','), cartSlugs.join(','), excludeId, limit],
    { enabled: signalsReady },
  )

  return { data: data ?? [], isLoading: isLoading || !signalsReady }
}
