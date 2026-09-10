import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SEOHead from './components/SEOHead'
import Pagination from './components/Pagination'
import PromoBanner from './components/PromoBanner'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from './api'
import './search-results.css'

/**
 * Search results — the same faceted listing query Explore and Categories use, scoped to a
 * free-text `q`.
 *
 * Removed while converting:
 *
 *   - This page rendered its own <Header>/<Footer>. It is mounted under App.jsx's
 *     PublicLayout, which already renders both with `global` — every /search visit had two
 *     of each. Every other page under that layout (Categories, Explore, Products) renders
 *     only its <main>, so this now matches them.
 *   - The brand list and price ceiling were derived by scanning the mock array on every
 *     render (`[...new Set(products.map(p => p.name.split(' ')[0]))]`, a fixed 350,000 slider
 *     cap). Both now come from `GET /products/facets`, so the options match what the search
 *     can actually return.
 *   - Client-side "Try these related products" suggestions matched loosely against the mock
 *     array. Replaced with a real query for popular products, shown only when the search
 *     genuinely returns nothing.
 *   - The "Load more" pagination re-sliced an already-fully-fetched local array. Filtering
 *     and paging now happen in the database, so this uses the same Previous/Next pattern as
 *     ProductsPage.
 */

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const SORTS = [
  ['recommended', 'Recommended'],
  ['price-low', 'Price: Low to High'],
  ['price-high', 'Price: High to Low'],
  ['rating', 'Rating'],
]

function ProductCard({ product, onAddToCart }) {
  const image = product.images[0]
  return (
    <article className="search-product-card">
      <div className="search-product-media">
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        {product.discountPercent > 0 && <span>−{product.discountPercent}%</span>}
      </div>
      <div className="search-product-body">
        <small>{product.subtitle}</small>
        <h2><Link to={`/product/${product.slug}`}>{product.name}</Link></h2>
        <p><Icon name="star" /> {product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : 'No reviews yet'}</p>
        <strong>{product.price.display}</strong>
        {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        <div>
          <Link to={`/compare?product=${product.slug}`}><Icon name="scale-balanced" /> Compare</Link>
          <button type="button" onClick={() => onAddToCart?.(product)}><Icon name="cart-shopping" /> Add to cart</button>
        </div>
      </div>
    </article>
  )
}

export default function SearchResultsPage({ onAddToCart }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const initialQuery = params.get('q') || params.get('search') || ''

  const [query, setQuery] = useState(initialQuery)
  const [sort, setSort] = useState('recommended')
  const [brand, setBrand] = useState('')
  const [maxPrice, setMaxPrice] = useState(null)
  const [page, setPage] = useState(1)

  const { data: facets } = useApiQuery((signal) => api.products.facets(signal), [])
  const priceCeiling = facets?.price.max ?? 0
  const priceCap = maxPrice ?? priceCeiling

  const listQuery = {
    q: query || undefined,
    brand: brand || undefined,
    maxPrice: priceCap > 0 ? priceCap : undefined,
    sort,
    page,
    pageSize: 12,
  }
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.products.list(listQuery, signal),
    [JSON.stringify(listQuery)],
    { enabled: Boolean(facets) },
  )

  const items = data?.items ?? []
  const pagination = data?.pagination
  const noResults = !isLoading && !error && items.length === 0
  const topDeal = items.length
    ? [...items].filter((product) => product.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent)[0]
    : null

  const { data: suggestionData } = useApiQuery(
    (signal) => api.products.list({ sort: 'rating', pageSize: 5 }, signal),
    [],
    { enabled: noResults },
  )
  const suggestions = suggestionData?.items ?? []

  const runSearch = (event) => {
    event.preventDefault()
    setPage(1)
  }

  return (
    <main className="search-results-page">
      <SEOHead
        title={query ? `Search results for ${query} | Mirwal` : 'Search products | Mirwal'}
        description={query ? `Find ${query} products in Pakistan. Compare prices, ratings and offers from Mirwal sellers.` : 'Search products, brands and categories on Mirwal.'}
        canonical={null}
        robots="noindex,follow"
      />
      <div className="search-results-container">
        <nav className="search-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link><Icon name="chevron-right" /><span aria-current="page">Search</span>
        </nav>

        <header className="search-results-heading">
          <span>FIND YOUR NEXT GOOD THING</span>
          <h1>{query ? <>Results for <em>"{query}"</em></> : 'Search products'}</h1>
          <form onSubmit={runSearch}>
            <Icon name="magnifying-glass" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products, brands or categories"
              aria-label="Search products"
            />
            <button type="submit">Search</button>
          </form>
        </header>

        {topDeal && (
          <PromoBanner
            eyebrow="Spotted in these results"
            title={`${topDeal.discountPercent}% off ${topDeal.name}`}
            subtitle={`${topDeal.price.display}${topDeal.compareAtPrice ? ` — was ${topDeal.compareAtPrice.display}` : ''}`}
            ctaLabel="View product"
            onCta={() => navigateTo(`/product/${topDeal.slug}`)}
            image={topDeal.images[0]?.url}
            imageAlt={topDeal.images[0]?.alt ?? topDeal.name}
            badge={`−${topDeal.discountPercent}%`}
          />
        )}

        {noResults && suggestions.length > 0 && (
          <section className="search-suggestions">
            <h2>Try these popular products</h2>
            <div>
              {suggestions.map((product) => (
                <Link to={`/product/${product.slug}`} key={product.id}>{product.name}<Icon name="arrow-right" /></Link>
              ))}
            </div>
          </section>
        )}

        <section className="search-results-layout">
          <aside className="search-filters">
            <div>
              <h2>Refine results</h2>
              <button type="button" onClick={() => { setBrand(''); setMaxPrice(null); setPage(1) }}>Clear all</button>
            </div>
            <label>Brand
              <select value={brand} onChange={(event) => { setBrand(event.target.value); setPage(1) }}>
                <option value="">All brands</option>
                {(facets?.brands ?? []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
              </select>
            </label>
            {priceCeiling > 0 && (
              <label>Maximum price
                <strong>Rs. {priceCap.toLocaleString('en-PK')}</strong>
                <input
                  type="range"
                  min={facets.price.min}
                  max={facets.price.max}
                  step="5000"
                  value={priceCap}
                  onChange={(event) => { setMaxPrice(Number(event.target.value)); setPage(1) }}
                />
              </label>
            )}
          </aside>

          <div className="search-results-content">
            <div className="search-results-toolbar">
              <p><strong>{pagination?.total ?? 0}</strong> products found</p>
              <label>Sort by
                <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>
                  {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            {isLoading && <LoadingState label="Loading products" />}
            {error && !isLoading && (
              <ErrorState title="We could not load products" description={describeApiError(error)} onRetry={refetch} />
            )}
            {noResults && (
              <div className="search-empty">
                <Icon name="magnifying-glass" />
                <h2>No products found</h2>
                <p>Try fewer words or search for a product category.</p>
                <button type="button" onClick={() => { setQuery(''); setPage(1) }}>Browse all products</button>
              </div>
            )}
            {!isLoading && !error && items.length > 0 && (
              <>
                <div className="search-product-grid">
                  {items.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}
                </div>
                <Pagination page={page} totalPages={pagination?.totalPages} onChange={setPage} />
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
