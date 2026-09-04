import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import SEOHead from './components/SEOHead'
import Pagination from './components/Pagination'
import PromoBanner from './components/PromoBanner'
import { EmptyState, ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'

/**
 * All Products — the marketplace-wide listing.
 *
 * Previously this rendered a hard-coded array and its H1 read "Explore", duplicating
 * /explore. It now loads from the API with real pagination and its own SEO identity.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />
const navigate = (path) => navigateTo(path)

const SORTS = [
  ['recommended', 'Recommended'],
  ['newest', 'Newest'],
  ['price-low', 'Price: Low to High'],
  ['price-high', 'Price: High to Low'],
  ['rating', 'Rating'],
]

function ProductCard({ product, onAddToCart }) {
  const image = product.images[0]
  return (
    <article className="product-card">
      {product.discountPercent > 0 && <label>−{product.discountPercent}%</label>}
      <button type="button" className="product-card-link" onClick={() => navigate(`/product/${product.slug}`)}>
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        <span className="product-info">
          <b>{product.name}</b>
          <small>{product.subtitle}</small>
          {product.rating.count > 0
            ? <span className="rating"><FaIcon name="star" /> {product.rating.average.toFixed(1)} ({product.rating.count})</span>
            : <span className="rating muted">No reviews yet</span>}
          <strong>{product.price.display}</strong>
          {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        </span>
      </button>
      <div className="product-actions">
        <button
          type="button"
          className="add-to-cart btn btn-primary"
          disabled={!product.availability.inStock}
          onClick={() => onAddToCart?.(product)}
        >
          <FaIcon name="cart-shopping" /> {product.availability.inStock ? 'Add to Cart' : 'Out of stock'}
        </button>
      </div>
    </article>
  )
}

export default function ProductsPage({ onAddToCart }) {
  const location = useLocation()
  const initialCategory = new URLSearchParams(location.search).get('category') ?? ''

  const [category, setCategory] = useState(initialCategory)
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(1)

  const categories = useApiQuery((signal) => api.categories.list(signal), [])
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.products.list({ category: category || undefined, sort, page, pageSize: 24 }, signal),
    [category, sort, page],
  )

  const items = data?.items ?? []
  const pagination = data?.pagination
  const topDeal = items.length
    ? [...items].filter((product) => product.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent)[0]
    : null

  return (
    <main className="listing-page container">
      <SEOHead
        title="All Products | Mirwal"
        description="Browse every product on the Mirwal marketplace. Filter by category, compare prices and ratings, and buy from trusted sellers in Pakistan."
      />

      <header className="listing-heading">
        <h1>All Products</h1>
        <p>Everything currently listed on Mirwal by our marketplace sellers.</p>
      </header>

      {topDeal && (
        <PromoBanner
          eyebrow="On sale right now"
          title={`${topDeal.discountPercent}% off ${topDeal.name}`}
          subtitle={`${topDeal.price.display}${topDeal.compareAtPrice ? ` — was ${topDeal.compareAtPrice.display}` : ''}`}
          ctaLabel="View product"
          onCta={() => navigate(`/product/${topDeal.slug}`)}
          image={topDeal.images[0]?.url}
          imageAlt={topDeal.images[0]?.alt ?? topDeal.name}
          badge={`−${topDeal.discountPercent}%`}
        />
      )}

      <div className="listing-toolbar">
        <label>
          <span className="visually-hidden">Filter by category</span>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((item) => (
              <option key={item.slug} value={item.slug}>{item.name} ({item.productCount})</option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">Sort products</span>
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {pagination && <p className="listing-count"><strong>{pagination.total}</strong> products</p>}
      </div>

      {isLoading && <LoadingState label="Loading products" />}

      {error && !isLoading && (
        <ErrorState
          title="We could not load products"
          description={describeApiError(error)}
          onRetry={refetch}
        />
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          title="No products found"
          description={category ? 'No products in this category yet. Try another one.' : 'There are no products listed yet.'}
          primaryAction={{ label: 'Clear filters', onClick: () => { setCategory(''); setPage(1) } }}
        />
      )}

      {!isLoading && !error && items.length > 0 && (
        <>
          <div className="listing-grid product-grid">
            {items.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}
          </div>

          <Pagination page={page} totalPages={pagination?.totalPages} onChange={setPage} />
        </>
      )}
    </main>
  )
}
