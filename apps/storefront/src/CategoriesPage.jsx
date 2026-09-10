import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'
import SEOHead from './components/SEOHead'
import Pagination from './components/Pagination'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from './api'
import categoriesBanner from './assets/images/categories banner.png'
import './categories-page.css'

/**
 * Categories — landing grid plus per-category product listing, both API-backed.
 *
 * Previously `categoryModel` was built from a hard-coded name -> description/subcategory
 * map, and an unlinked `mobile-phones` slug was special-cased into a fake category filtered
 * by product type. Neither exists in the data model, so both are gone: unknown slugs now
 * get a real 404 from the category API instead of a fabricated page.
 *
 * The multi-select compare picker (checkbox on every card + a sticky bar) is also gone.
 * It stored whatever object was passed to it verbatim in the shared comparison context, and
 * ComparePage (not yet converted) renders `product.price` as a bare string — the API's
 * `product.price` is `{amount, currency, display}`, which React cannot render as a child.
 * ExplorePage hit the same conflict and resolved it by linking to /compare?product=slug
 * instead of adding the object directly; this follows that precedent.
 */

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const faqs = [
  ['What should I consider before buying?', 'Compare the price, key specifications, seller details, ratings and return information before choosing a product.'],
  ['How can I compare products on Mirwal?', 'Open a product page and use Compare to see it alongside other options.'],
  ['Are products available across Pakistan?', 'Availability and delivery depend on the seller and your delivery location. Check the product page for the latest details.'],
]

const needs = [
  ['Better for Students', 'laptop', 'student laptop'],
  ['Work from Home', 'briefcase', 'home office'],
  ['Gifts', 'gift', 'gifts'],
  ['Latest Finds', 'sparkles', 'new arrivals'],
  ['Trending Now', 'fire', 'trending'],
]

const SORTS = [
  ['recommended', 'Recommended'],
  ['price-low', 'Price: Low to High'],
  ['price-high', 'Price: High to Low'],
]

const DIRECTORY_MODES = {
  categories: {
    api: api.categories,
    eyebrow: 'MIRWAL MARKETPLACE',
    title: <>Explore <em>Every Category.</em><br />Find What You Need.</>,
    description: 'Explore everyday essentials, compare your options, and discover better choices with Mirwal.',
    search: 'categories',
    heading: 'All Categories',
    headingDescription: 'Browse all categories and find what fits your need.',
    itemLabel: 'Item',
    path: (item) => `/categories/${item.slug}`,
    icon: (name) => categoryIcon(name),
    needsTitle: 'Shop by Need',
    needsDescription: 'Find the right products for every goal.',
    needsLink: 'Not sure what you need? Ask Mirwal AI',
  },
  brands: {
    api: api.brands,
    eyebrow: 'MIRWAL DISCOVERY',
    title: <>Explore <em>Trusted Brands.</em><br />Find What You Need.</>,
    description: 'Explore products from trusted brands, compare your options, and discover better choices with Mirwal.',
    search: 'brands',
    heading: 'All Brands',
    headingDescription: 'Browse all brands and find what fits your need.',
    itemLabel: 'Product',
    path: (item) => `/brand/${item.slug}`,
    icon: () => 'certificate',
    needsTitle: 'Explore by Brand',
    needsDescription: 'Find products from brands you trust.',
    needsLink: 'Browse all brands',
  },
  sellers: {
    api: api.sellers,
    eyebrow: 'TRUSTED MARKETPLACE',
    title: <>Explore <em>Trusted Sellers.</em><br />Find What You Need.</>,
    description: 'Explore products from trusted sellers, compare your options, and discover better choices with Mirwal.',
    search: 'sellers',
    heading: 'All Sellers',
    headingDescription: 'Browse all sellers and find what fits your need.',
    itemLabel: 'Product',
    path: (item) => `/seller/${item.slug}`,
    icon: () => 'store',
    needsTitle: 'Explore by Seller',
    needsDescription: 'Shop from trusted marketplace sellers.',
    needsLink: 'Browse all sellers',
  },
}

function categoryIcon(name) {
  const value = name.toLowerCase()
  if (value.includes('mobile') || value.includes('tech')) return 'laptop'
  if (value.includes('organization') || value.includes('cleaning')) return 'broom'
  if (value.includes('kitchen') || value.includes('appliance')) return 'utensils'
  if (value.includes('personal') || value.includes('beauty') || value.includes('grooming')) return 'hand-sparkles'
  if (value.includes('fashion') || value.includes('wear')) return 'shirt'
  if (value.includes('comfort') || value.includes('home')) return 'couch'
  if (value.includes('fitness') || value.includes('sport') || value.includes('outdoor')) return 'dumbbell'
  if (value.includes('car') || value.includes('motorcycle') || value.includes('auto')) return 'car'
  if (value.includes('baby') || value.includes('family') || value.includes('kid')) return 'baby'
  if (value.includes('pet')) return 'paw'
  if (value.includes('stationery') || value.includes('study') || value.includes('office')) return 'pencil'
  if (value.includes('travel') || value.includes('safety') || value.includes('utility')) return 'suitcase'
  if (value.includes('toy')) return 'puzzle-piece'
  if (value.includes('book') || value.includes('media')) return 'book-open'
  if (value.includes('computer')) return 'desktop'
  if (value.includes('tool')) return 'screwdriver-wrench'
  return 'house'
}

function ProductCard({ product }) {
  const image = product.images[0]
  return (
    <article className="category-product-card">
      <div className="category-product-media">
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        {product.discountPercent > 0 && <span>−{product.discountPercent}%</span>}
      </div>
      <div className="category-product-content">
        <small>{product.subtitle}</small>
        <h3><Link to={`/product/${product.slug}`}>{product.name}</Link></h3>
        <p><Icon name="star" /> {product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : 'No reviews yet'}</p>
        <div className="category-price">
          <strong>{product.price.display}</strong>
          {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        </div>
        <div className="category-product-actions">
          <Link to={`/compare?product=${product.slug}`}><Icon name="scale-balanced" /> Compare</Link>
          <Link to={`/product/${product.slug}`}>View product <Icon name="arrow-right" /></Link>
        </div>
      </div>
    </article>
  )
}

function CategoryLanding({ mode }) {
  const directory = DIRECTORY_MODES[mode]
  const [search, setSearch] = useState('')
  const [directoryPage, setDirectoryPage] = useState(1)
  const { data, error, isLoading, refetch } = useApiQuery((signal) => directory.api.list(signal), [])
  const items = data ?? []
  const visible = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
  const directoryPageSize = 5
  const directoryTotalPages = Math.ceil(visible.length / directoryPageSize)
  const pageItems = visible.slice((directoryPage - 1) * directoryPageSize, directoryPage * directoryPageSize)
  const contextualItems = mode === 'categories' ? needs : visible.slice(0, 5)
  return (
    <section className="category-landing" aria-labelledby="category-landing-title">
      <header className="category-landing-intro">
        <div>
          <span className="category-eyebrow"><Icon name="layer-group" /> {directory.eyebrow}</span>
          <h1 id="category-landing-title">{directory.title}</h1>
          <p>{directory.description}</p>
          <label className="category-search">
            <Icon name="magnifying-glass" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setDirectoryPage(1) }} placeholder={`Search ${directory.search}...`} aria-label={`Search ${directory.search}`} />
          </label>
        </div>
      </header>

      <section className="category-hero-banner" aria-label={`Explore ${directory.search}`}>
        <img className="category-banner-image" src={categoriesBanner} alt="Explore every category on Mirwal" />
      </section>

      <section className="category-discovery-section">
          <div className="category-section-heading">
          <div><span className="category-eyebrow">START HERE</span><h2>{directory.heading}</h2></div>
          <span>{directory.headingDescription}</span>
        </div>

        {isLoading && <LoadingState label={`Loading ${directory.search}`} />}
        {error && !isLoading && (
          <ErrorState title={`We could not load ${directory.search}`} description={describeApiError(error)} onRetry={refetch} />
        )}
        {!isLoading && !error && visible.length === 0 && (
          <div className="category-empty">
            <Icon name="box-open" />
            <h3>No {directory.search} match your search</h3>
            <p>Try a different search term.</p>
          </div>
        )}
        {!isLoading && !error && visible.length > 0 && (
          <>
            <div className="category-card-grid">
            {pageItems.map((item) => (
              <Link className="category-card" to={directory.path(item)} key={item.slug}>
                <div className="category-card-media">
                  {item.imageUrl || item.logoUrl ? <img src={item.imageUrl || item.logoUrl} alt={`${item.name} products on Mirwal`} loading="lazy" /> : <span className="category-card-fallback"><Icon name={directory.icon(item.name)} /></span>}
                  <span className="category-card-shade" aria-hidden="true" />
                </div>
                <span className="category-card-content">
                  <span className="category-card-icon"><Icon name={directory.icon(item.name)} /></span>
                  <strong>{item.name}</strong>
                </span>
                <small className="category-card-count"><b>{item.productCount}</b> {item.productCount === 1 ? directory.itemLabel : `${directory.itemLabel}s`}</small>
                <small className="category-card-tagline">Find what fits best.</small>
                <Icon name="arrow-right" />
              </Link>
            ))}
            </div>
            <Pagination page={directoryPage} totalPages={directoryTotalPages} onChange={setDirectoryPage} />
          </>
        )}
      </section>

      <section className="category-needs-section">
        <div className="category-section-heading">
          <div><span className="category-eyebrow">{mode === 'categories' ? 'SHOP WITH A GOAL' : 'DISCOVER MORE'}</span><h2>{directory.needsTitle}</h2></div>
          {mode === 'categories' && <Link to="/ai-shopping">{directory.needsLink} <Icon name="arrow-right" /></Link>}
        </div>
        <div className="need-grid">
          {mode === 'categories' ? contextualItems.map(([label, icon, query]) => (
            <Link to={`/explore?search=${encodeURIComponent(query)}`} key={label}>
              <span><Icon name={icon} /></span><strong>{label}</strong>
              <Icon name="arrow-right" />
            </Link>
          )) : contextualItems.map((item) => (
            <Link to={directory.path(item)} key={item.slug}>
              <span><Icon name={directory.icon(item.name)} /></span><strong>{item.name}</strong><Icon name="arrow-right" />
            </Link>
          ))}
        </div>
      </section>
      <section className="category-ai-cta" aria-label="Mirwal AI shopping assistant">
        <div>
          <span className="category-ai-label"><Icon name="robot" /> MIRWAL AI</span>
          <h2>Still deciding? Let’s narrow it down.</h2>
          <p>Tell Mirwal what matters to you and get a shortlist worth comparing.</p>
        </div>
        <Link to="/ai-shopping"><Icon name="robot" /> Ask Mirwal AI</Link>
      </section>
    </section>
  )
}

function CategoryFaq() {
  return (
    <section className="category-faq">
      <div className="category-section-heading">
        <div><span className="category-eyebrow">HELP BEFORE YOU SHOP</span><h2>Frequently Asked Questions</h2></div>
      </div>
      {faqs.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}<Icon name="chevron-down" /></summary>
          <p>{answer}</p>
        </details>
      ))}
    </section>
  )
}

export default function CategoriesPage({ mode = 'categories' }) {
  const { slug } = useParams()

  const categoryQuery = useApiQuery(
    (signal) => api.categories.get(slug, signal),
    [slug],
    { enabled: Boolean(slug) },
  )
  const selected = categoryQuery.data

  const [sort, setSort] = useState('recommended')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)

  const listQuery = { category: slug, sort, q: filter || undefined, page, pageSize: 24 }
  const productsQuery = useApiQuery(
    (signal) => api.products.list(listQuery, signal),
    [JSON.stringify(listQuery)],
    { enabled: Boolean(slug) && Boolean(selected) },
  )
  const items = productsQuery.data?.items ?? []
  const pagination = productsQuery.data?.pagination

  if (slug && categoryQuery.error?.code === 'CATEGORY_NOT_FOUND') return <NotFoundPage />

  const seo = selected
    ? {
        title: selected.meta?.title || `${selected.name} in Pakistan | Mirwal`,
        description: selected.meta?.description || `${selected.description ?? `Browse ${selected.name} on Mirwal.`} Compare prices, ratings and offers from trusted Mirwal sellers.`,
        canonical: `${window.location.origin}/categories/${selected.slug}`,
        image: selected.imageUrl,
      }
    : {
        title: 'Shop by Categories | Mirwal',
        description: 'Explore products across the Mirwal marketplace by category.',
        canonical: `${window.location.origin}/categories`,
      }

  return (
    <main className="categories-page">
      <SEOHead {...seo} />
      <div className="categories-container">
        <nav className="category-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link><Icon name="chevron-right" /><span aria-current="page">{selected ? selected.name : 'Categories'}</span>
        </nav>

        {!slug && <CategoryLanding mode={mode} />}

        {slug && categoryQuery.isLoading && <LoadingState label="Loading category" />}
        {slug && categoryQuery.isError && (
          <ErrorState title="We could not load this category" description={describeApiError(categoryQuery.error)} onRetry={categoryQuery.refetch} />
        )}

        {slug && selected && (
          <>
            <header className="category-detail-header">
              <div>
                <span className="category-eyebrow">CATEGORY DISCOVERY</span>
                <h1>{selected.name}</h1>
                <p>{selected.description}</p>
              </div>
              {selected.imageUrl && <img src={selected.imageUrl} alt={`${selected.name} products on Mirwal`} />}
            </header>

            <section className="category-products-section">
              <div className="category-section-heading">
                <div>
                  <span className="category-eyebrow">MARKETPLACE PRODUCTS</span>
                  <h2>Products in {selected.name}</h2>
                  <p>{pagination?.total ?? 0} products available to compare</p>
                </div>
                <div className="category-controls">
                  <label><span className="visually-hidden">Filter products</span>
                    <input value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }} placeholder="Filter products" />
                  </label>
                  <label><span className="visually-hidden">Sort products</span>
                    <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>
                      {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              {productsQuery.isLoading && <LoadingState label="Loading products" />}
              {productsQuery.isError && (
                <ErrorState title="We could not load products" description={describeApiError(productsQuery.error)} onRetry={productsQuery.refetch} />
              )}
              {!productsQuery.isLoading && !productsQuery.isError && items.length === 0 && (
                <div className="category-empty">
                  <Icon name="box-open" />
                  <h3>No products match this category yet</h3>
                  <p>Try another search or explore the full marketplace.</p>
                  <Link to="/explore">Explore products</Link>
                </div>
              )}
              {!productsQuery.isLoading && !productsQuery.isError && items.length > 0 && (
                <>
                  <div className="category-product-grid">
                    {items.map((product) => <ProductCard product={product} key={product.id} />)}
                  </div>
                  <Pagination page={page} totalPages={pagination?.totalPages} onChange={setPage} />
                </>
              )}
            </section>

            <section className="category-seo-intro">
              <span className="category-eyebrow">ABOUT THIS CATEGORY</span>
              <h2>Find the right {selected.name.toLowerCase()} products</h2>
              <p>{selected.description} Compare the details that matter and use Mirwal seller and rating information to choose with confidence.</p>
            </section>

            <CategoryFaq />
          </>
        )}
      </div>
    </main>
  )
}
