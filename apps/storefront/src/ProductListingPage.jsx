import { useState } from 'react'
import { Link } from 'react-router-dom'
import SEOHead from './components/SEOHead'
import Pagination from './components/Pagination'
import PromoBanner from './components/PromoBanner'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from './api'
import './product-listing.css'

/**
 * New Arrivals / Featured — both API-backed listing queries now.
 *
 * "New Arrivals" filtered the mock array for `badge === 'New'` (a field nothing ever set) or
 * "one of the last 10 items in the array" — an accident of array order, not recency. It's
 * `sort=newest` now, which is a real `products.published_at` ordering.
 *
 * "Featured" filtered for `product.badge || rating >= 4.7` — `badge` doesn't exist on a real
 * product. It's `sort=rating` with a `rating >= 4.5` floor now, a real threshold on the real
 * aggregate.
 *
 * Also fixed: another instance of the duplicate-chrome bug (own <Header>/<Footer> under
 * PublicLayout, which already renders both).
 */

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function ListingCard({ product, onAddToCart }) {
  const [saved, setSaved] = useState(false)
  const image = product.images[0]
  return (
    <article className="listing-card">
      <div className="listing-image">
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        {product.discountPercent > 0 && <span>−{product.discountPercent}%</span>}
        <button type="button" aria-label={`${saved ? 'Remove' : 'Add'} ${product.name} ${saved ? 'from' : 'to'} wishlist`} aria-pressed={saved} onClick={() => setSaved((value) => !value)}><Icon name="heart" /></button>
      </div>
      <div className="listing-card-body">
        <small>{product.subtitle}</small>
        <h2><Link to={`/product/${product.slug}`}>{product.name}</Link></h2>
        <p>{product.rating.count > 0 ? <><Icon name="star" /> {product.rating.average.toFixed(1)}</> : 'No reviews yet'}</p>
        <strong>{product.price.display}</strong>
        {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        <div>
          <Link to={`/compare?product=${product.slug}`}><Icon name="scale-balanced" /> Compare</Link>
          <button type="button" disabled={!product.availability.inStock} onClick={() => onAddToCart?.(product)}><Icon name="cart-shopping" /> {product.availability.inStock ? 'Add' : 'Out of stock'}</button>
        </div>
      </div>
    </article>
  )
}

export default function ProductListingPage({ variant = 'new', onAddToCart }) {
  const isFeatured = variant === 'featured'

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)

  const { data: categories } = useApiQuery((signal) => api.categories.list(signal), [])

  const listQuery = {
    q: search || undefined,
    category: category || undefined,
    sort: isFeatured ? 'rating' : 'newest',
    rating: isFeatured ? 4.5 : undefined,
    page,
    pageSize: 24,
  }
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.products.list(listQuery, signal),
    [JSON.stringify(listQuery)],
  )
  const items = data?.items ?? []
  const pagination = data?.pagination
  // The list is already sorted by rating (Featured) or by newest (New Arrivals), so the
  // first real result is exactly the right thing to spotlight — no separate ranking needed.
  const spotlight = items[0] ?? null

  return <main className="listing-page">
    <SEOHead
      title={`${isFeatured ? 'Featured Products' : 'New Arrivals'} | Mirwal`}
      description={isFeatured ? 'Explore featured products selected from the Mirwal marketplace.' : 'Discover newly listed products and fresh finds on Mirwal.'}
    />
    <div className="listing-container">
      <nav aria-label="Breadcrumb"><Link to="/">Home</Link><Icon name="chevron-right" /><span aria-current="page">{isFeatured ? 'Featured' : 'New arrivals'}</span></nav>
      <header className="listing-heading">
        <div>
          <span>CURATED MARKETPLACE FINDS</span>
          <h1>{isFeatured ? 'Featured products' : 'New arrivals'}</h1>
          <p>{isFeatured ? 'Explore standout products with strong shopper ratings and useful marketplace signals.' : 'See fresh catalogue additions and recently listed products from Mirwal sellers.'}</p>
        </div>
        <form onSubmit={(event) => event.preventDefault()}>
          <Icon name="magnifying-glass" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search this collection" aria-label="Search this collection" />
        </form>
      </header>

      {spotlight && (
        <PromoBanner
          eyebrow={isFeatured ? 'Top-rated pick' : 'Just landed'}
          title={spotlight.name}
          subtitle={isFeatured
            ? (spotlight.rating.count > 0 ? `Rated ${spotlight.rating.average.toFixed(1)} by ${spotlight.rating.count} buyers.` : spotlight.subtitle)
            : `Now available from ${spotlight.price.display}.`}
          ctaLabel="View product"
          onCta={() => navigateTo(`/product/${spotlight.slug}`)}
          image={spotlight.images[0]?.url}
          imageAlt={spotlight.images[0]?.alt ?? spotlight.name}
        />
      )}

      <section className="listing-toolbar">
        <p><strong>{pagination?.total ?? 0}</strong> products</p>
        <div>
          <label>Category
            <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
              <option value="">All categories</option>
              {(categories ?? []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {isLoading && <LoadingState label="Loading products" />}
      {error && !isLoading && (
        <ErrorState title="We could not load products" description={describeApiError(error)} onRetry={refetch} />
      )}
      {!isLoading && !error && items.length === 0 && (
        <div className="listing-empty">
          <Icon name="box-open" />
          <h2>No products found</h2>
          <p>Try another category or search term.</p>
          <button type="button" onClick={() => { setSearch(''); setCategory(''); setPage(1) }}>Clear filters</button>
        </div>
      )}
      {!isLoading && !error && items.length > 0 && (
        <>
          <div className="listing-grid">
            {items.map((product) => <ListingCard key={product.id} product={product} onAddToCart={onAddToCart} />)}
          </div>
          <Pagination page={page} totalPages={pagination?.totalPages} onChange={setPage} />
        </>
      )}

      <section className="listing-bottom">
        <h2>Shop with more context</h2>
        <p>Compare product details, seller information and current prices before you decide.</p>
        <Link to="/compare">Compare products <Icon name="arrow-right" /></Link>
        <Link to="/ai-shopping">Ask Mirwal AI <Icon name="wand-magic-sparkles" /></Link>
      </section>
    </div>
  </main>
}
