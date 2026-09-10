/**
 * Route-level SEO policy for Mirwal.
 *
 * Problem this solves (docs/PROJECT_AUDIT.md section 10): SEOHead only wrote the tags it was
 * given and nothing cleared them on unmount, so a route that set no metadata inherited the
 * previously-visited page's title, description, canonical and robots directive. Observed live:
 * /404 canonicalised to /shipping and was marked index,follow, and all 91 admin routes
 * advertised themselves as indexable.
 *
 * The fix is that every route now resolves to a complete metadata set. RouteMeta applies the
 * defaults below on every navigation; a page that renders <SEOHead> afterwards overrides them
 * with something more specific (for example a product name).
 */

const SITE_NAME = 'Mirwal'
const TAGLINE = 'Smart Shopping, Better Living'

/** Production origin used to build canonical URLs. Falls back to the runtime origin. */
export const siteOrigin = (
  import.meta.env.VITE_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/$/, '')

export const withSiteName = (title) => (title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | ${TAGLINE}`)

const INDEX = 'index,follow'
const NOINDEX_FOLLOW = 'noindex,follow'
const NOINDEX_NOFOLLOW = 'noindex,nofollow'

/** Exact-path metadata for static routes. */
const staticRoutes = {
  '/': {
    title: withSiteName(),
    description: 'Discover and compare products on Mirwal, an AI-assisted shopping marketplace in Pakistan. Find the right products, compare options, and shop smarter.',
    robots: INDEX,
  },
  '/products': {
    title: withSiteName('All Products'),
    description: 'Browse every product on the Mirwal marketplace. Filter by category, compare prices and ratings, and buy from trusted sellers in Pakistan.',
    robots: INDEX,
  },
  '/explore': {
    title: withSiteName('Explore Products'),
    description: 'Explore the Mirwal marketplace by category, brand, price and rating. Narrow the options down and compare what matters before you buy.',
    robots: INDEX,
  },
  '/categories': {
    title: withSiteName('Shop by Category'),
    description: 'Explore products across the Mirwal marketplace by category, subcategory, need and shopping goal.',
    robots: INDEX,
  },
  '/brands': {
    title: withSiteName('Shop by Brand'),
    description: 'Find products from the brands shoppers already trust, all in one place on Mirwal.',
    robots: INDEX,
  },
  '/sellers': {
    title: withSiteName('Trusted Sellers in Pakistan'),
    description: 'Discover marketplace sellers on Mirwal, browse their products and shop with confidence.',
    robots: INDEX,
  },
  '/deals': {
    title: withSiteName('Deals and Offers'),
    description: 'Browse current Mirwal offers and compare discounted products from marketplace sellers across Pakistan.',
    robots: INDEX,
  },
  '/compare': {
    title: withSiteName('Compare Products'),
    description: 'Compare up to four products side by side on Mirwal — price, ratings, specifications and seller details.',
    robots: INDEX,
  },
  '/guides': {
    title: withSiteName('Shopping Guides'),
    description: 'Practical shopping guides to help you compare products and choose with confidence.',
    robots: INDEX,
  },
  '/new-arrivals': {
    title: withSiteName('New Arrivals'),
    description: 'See the newest products listed on the Mirwal marketplace by sellers across Pakistan.',
    robots: INDEX,
  },
  '/featured': {
    title: withSiteName('Featured Products'),
    description: 'Featured products on Mirwal, chosen for value, ratings and seller reliability.',
    robots: INDEX,
  },
  '/ai-shopping': {
    title: withSiteName('AI Shopping Assistant'),
    description: 'Describe what you need and let the Mirwal AI shopping assistant help you compare the options.',
    robots: INDEX,
  },
  '/sell-with-mirwal': {
    title: withSiteName('Sell with Mirwal'),
    description: 'Start selling on Mirwal. Reach shoppers across Pakistan, manage your store and grow your business online.',
    robots: INDEX,
  },
  '/about': {
    title: withSiteName('About'),
    description: 'Learn what Mirwal is building: a simpler, more trustworthy way to discover and compare products in Pakistan.',
    robots: INDEX,
  },
  '/help-center': {
    title: withSiteName('Help Centre'),
    description: 'Find answers about orders, delivery, returns, payments and selling on Mirwal.',
    robots: INDEX,
  },

  // Functional pages: useful to people, not useful in an index.
  '/cart': { title: withSiteName('Your Cart'), description: 'Review the items in your Mirwal cart.', robots: NOINDEX_FOLLOW },
  '/checkout': { title: withSiteName('Secure Checkout'), description: 'Complete your Mirwal order.', robots: NOINDEX_NOFOLLOW },
  '/search': { title: withSiteName('Search Products'), description: 'Search products, brands and categories on Mirwal.', robots: NOINDEX_FOLLOW },
  '/login': { title: withSiteName('Sign In'), description: 'Sign in to your Mirwal account.', robots: NOINDEX_FOLLOW },
  '/register': { title: withSiteName('Create an Account'), description: 'Create a Mirwal account to save products, track orders and shop faster.', robots: NOINDEX_FOLLOW },
  '/report': { title: withSiteName('Report a Problem'), description: 'Report a problem with a product, seller or order on Mirwal.', robots: NOINDEX_FOLLOW },
  '/report-problem': { title: withSiteName('Report a Problem'), description: 'Report a problem with a product, seller or order on Mirwal.', robots: NOINDEX_FOLLOW },
  '/404': { title: withSiteName('Page Not Found'), description: 'The page you requested could not be found on Mirwal.', robots: NOINDEX_FOLLOW },
}

/** Account area — always private. */
const ACCOUNT_PATHS = new Set([
  '/my-chats', '/profile', '/orders', '/track-orders', '/wishlist', '/recently-viewed',
  '/saved-searches', '/addresses', '/payment-methods', '/notifications', '/security',
  '/settings', '/logout',
])

const PRIVATE_META = {
  title: withSiteName('Your Account'),
  description: 'Manage your Mirwal account, orders and preferences.',
  robots: NOINDEX_NOFOLLOW,
}

/**
 * Resolve a complete metadata set for a pathname.
 *
 * Back-office, account and transaction prefixes are matched first and are always private.
 * Everything else falls through to an indexable, self-canonical default, because the remaining
 * public routes are dynamic (product, category, brand, store, guide, deal) and legitimately
 * indexable. A path that matches no route at all is handled by NotFoundPage, which renders its
 * own noindex <SEOHead> — RouteMeta has no way to know a route failed to match.
 */
export function resolveRouteMeta(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname

  // No /admin or /seller-center branches here any more: the admin panel and seller portal
  // are separate applications on their own subdomains (admin.mirwal.pk, seller.mirwal.pk),
  // each serving its own noindex,nofollow document. The storefront never routes them.
  if (ACCOUNT_PATHS.has(path)) {
    return { ...PRIVATE_META, canonical: null }
  }
  if (path.startsWith('/order-success')) {
    return { title: withSiteName('Order Confirmation'), description: '', robots: NOINDEX_NOFOLLOW, canonical: null }
  }

  const exact = staticRoutes[path]
  if (exact) {
    // Search result pages must not be canonicalised to their query-stringed selves.
    return { ...exact, canonical: exact.robots === INDEX ? `${siteOrigin}${path}` : null }
  }

  // Dynamic public routes (product, category, brand, store, guide, deal, intent) are expected to
  // render their own <SEOHead>. Until they do, give them an indexable, self-canonical default
  // rather than whatever the previous page happened to leave behind.
  return {
    title: withSiteName(),
    description: staticRoutes['/'].description,
    robots: INDEX,
    canonical: `${siteOrigin}${path}`,
  }
}

export const ROBOTS = { INDEX, NOINDEX_FOLLOW, NOINDEX_NOFOLLOW }
