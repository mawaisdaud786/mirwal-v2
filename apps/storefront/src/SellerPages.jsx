import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'
import SEOHead from './components/SEOHead'
import Pagination from './components/Pagination'
import PromoBanner from './components/PromoBanner'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from './api'
import './public-sellers.css'
import './categories-page.css'
import './explore.css'

/**
 * Public seller storefronts (`/sellers`, `/seller/:sellerSlug`, `/seller/:sellerSlug/:categorySlug`).
 *
 * The mock version had exactly one hard-coded seller (`sellerMockData.sellerStore`), so the
 * listing page always read "1 seller available" and any `sellerSlug` other than that one fixed
 * value 404'd immediately — multi-seller routing was never actually exercised. Real sellers
 * exist now (two in the dev seed), and the "Products" tab is scoped by `seller_id` on the
 * backend, which is what makes Seller A's storefront unable to show Seller B's listings.
 *
 * The `/seller/:sellerSlug` prefix used to also host the seller management panel, which meant
 * a real seller whose slug was "orders", "products", "finance" etc. would have this storefront
 * shadowed by the panel. The panel has moved to `/seller-center/*` (see App.jsx) specifically
 * so this route is unambiguous now.
 */

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const SORTS = [
  ['recommended', 'Recommended'],
  ['price-low', 'Price: Low to High'],
  ['price-high', 'Price: High to Low'],
]

const sellerCategoryIcons = ['table-cells-large', 'mobile-screen-button', 'house', 'utensils', 'hand-sparkles', 'shirt', 'couch', 'dumbbell']

function SellerCard({ seller }) {
  return (
    <Link className="category-card public-seller-card" to={`/seller/${seller.slug}`}>
      <div className="category-card-media">
        {seller.logoUrl ? <img src={seller.logoUrl} alt={`${seller.name} logo`} loading="lazy" /> : <span className="category-card-fallback"><Icon name="store" /></span>}
        <span className="category-card-shade" aria-hidden="true" />
      </div>
      <span className="category-card-content"><span className="category-card-icon"><Icon name="store" /></span><strong>{seller.name}</strong></span>
      <small className="category-card-count"><b>{seller.productCount}</b> {seller.productCount === 1 ? 'Product' : 'Products'}</small>
      <small className="category-card-tagline">Trusted marketplace seller.</small>
      <Icon name="arrow-right" />
    </Link>
  )
}

function ProductCard({ product, onAddToCart }) {
  const [wishlisted, setWishlisted] = useState(false)
  const image = product.images[0]
  return (
    <article className="public-seller-product">
      <div className="public-seller-product-image">
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        {product.discountPercent > 0 && <span>−{product.discountPercent}%</span>}
        <button type="button" aria-label={`${wishlisted ? 'Remove' : 'Add'} ${product.name} ${wishlisted ? 'from' : 'to'} wishlist`} aria-pressed={wishlisted} onClick={() => setWishlisted((value) => !value)}><Icon name="heart" /></button>
      </div>
      <div className="public-seller-product-body">
        <small>{product.subtitle}</small>
        <h3><Link to={`/product/${product.slug}`}>{product.name}</Link></h3>
        <p>{product.rating.count > 0 ? <><Icon name="star" /> {product.rating.average.toFixed(1)}</> : 'No reviews yet'}</p>
        <strong>{product.price.display}</strong>
        {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        <button className="public-seller-cart" type="button" disabled={!product.availability.inStock} onClick={() => onAddToCart?.(product)}><Icon name="cart-shopping" /> {product.availability.inStock ? 'Add to cart' : 'Out of stock'}</button>
      </div>
    </article>
  )
}

function SellerFilterBlock({ title, children, open = false }) {
  return <details className="explore-filter-block" data-filter={title} open={open}>
    <summary><Icon name="sliders" /><span>{title}</span><Icon name="chevron-down" /></summary>
    <div>{children}</div>
  </details>
}

function SellerFilterSidebar({ categories, selectedCategories, setSelectedCategories, minPrice, setMinPrice, maxPrice, setMaxPrice, inStock, setInStock, mobileFilters, setMobileFilters }) {
  const toggleCategory = (slug) => setSelectedCategories((values) => values.includes(slug) ? values.filter((value) => value !== slug) : [...values, slug])
  return <>
    <aside className={mobileFilters ? 'explore-sidebar is-open' : 'explore-sidebar'}>
      <div className="explore-sidebar-head"><strong>Filters</strong><button type="button" onClick={() => setMobileFilters(false)} aria-label="Close filters"><Icon name="xmark" /></button></div>
      <SellerFilterBlock title="Category" open>
        <div className="explore-check-list">{categories.map((category) => <label key={category.slug}><input type="checkbox" checked={selectedCategories.includes(category.slug)} onChange={() => toggleCategory(category.slug)} /> <span>{category.name}</span></label>)}</div>
      </SellerFilterBlock>
      <SellerFilterBlock title="Price" open>
        <div className="explore-range"><label>Min price<input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Rs. 0" /></label><label>Max price<input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" /></label></div>
      </SellerFilterBlock>
      <SellerFilterBlock title="Availability" open>
        <div className="explore-check-list"><label><input type="checkbox" checked={inStock} onChange={(event) => setInStock(event.target.checked)} /> <span>In stock</span></label></div>
      </SellerFilterBlock>
      <SellerFilterBlock title="Explore" open>
        <div className="explore-sidebar-links">{[['All Products', '/products'], ['Categories', '/categories'], ['Brands', '/brands'], ['Sellers', '/sellers'], ['Deals', '/deals']].map(([label, path]) => <button type="button" key={path} onClick={() => navigateTo(path)}>{label}</button>)}</div>
      </SellerFilterBlock>
      <SellerFilterBlock title="Shop by need">
        <div className="explore-sidebar-links">{['study', 'work', 'gaming', 'travel', 'home', 'fitness', 'gifts', 'fashion'].map((value) => <button type="button" key={value} onClick={() => navigateTo(`/explore?search=${value}`)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      </SellerFilterBlock>
      <SellerFilterBlock title="My shopping">
        <div className="explore-sidebar-links">{[['Wishlist', '/wishlist'], ['Recently viewed', '/recently-viewed'], ['Saved comparisons', '/compare']].map(([label, path]) => <button type="button" key={path} onClick={() => navigateTo(path)}>{label}</button>)}</div>
      </SellerFilterBlock>
      <button type="button" className="explore-clear-button" onClick={() => { setSelectedCategories([]); setMinPrice(''); setMaxPrice(''); setInStock(false) }}>Clear all</button>
    </aside>
    {mobileFilters && <button type="button" className="explore-sidebar-scrim" onClick={() => setMobileFilters(false)} aria-label="Close filters" />}
  </>
}

function SellerListing() {
  const [search, setSearch] = useState('')
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.sellers.list(signal), [])
  const sellers = (data ?? []).filter((seller) => seller.name.toLowerCase().includes(search.toLowerCase()))
  // Featured is whichever real seller actually carries the most products right now — not
  // an editorial or paid placement.
  const topSeller = (data ?? []).length ? [...data].sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0))[0] : null

  return <>
    <header className="public-sellers-heading">
      <div>
        <span>TRUSTED MARKETPLACE</span>
        <h1>Shop from trusted sellers</h1>
        <p>Compare products, seller ratings and marketplace details before you choose.</p>
      </div>
      <label><Icon name="magnifying-glass" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sellers" aria-label="Search sellers" /></label>
    </header>

    {topSeller && (
      <PromoBanner
        eyebrow="Most stocked store"
        title={topSeller.name}
        subtitle={`${topSeller.productCount} ${topSeller.productCount === 1 ? 'product' : 'products'}${topSeller.city ? ` · ${topSeller.city}` : ''}`}
        ctaLabel={`Visit ${topSeller.name}`}
        onCta={() => navigateTo(`/seller/${topSeller.slug}`)}
        image={topSeller.logoUrl}
        imageAlt={`${topSeller.name} logo`}
      />
    )}

    {isLoading && <LoadingState label="Loading sellers" />}
    {error && !isLoading && <ErrorState title="We could not load sellers" description={describeApiError(error)} onRetry={refetch} />}
    {!isLoading && !error && (
      <section className="public-seller-list">
        <div className="public-section-heading"><h2>All sellers</h2><span>{sellers.length} {sellers.length === 1 ? 'seller' : 'sellers'} available</span></div>
        <div className="category-card-grid">{sellers.map((seller) => <SellerCard key={seller.slug} seller={seller} />)}</div>
      </section>
    )}
  </>
}

function SellerStorefront({ sellerSlug, categorySlug, onAddToCart }) {
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selectedCategories, setSelectedCategories] = useState([])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [inStock, setInStock] = useState(false)
  const [mobileFilters, setMobileFilters] = useState(false)

  const sellerQuery = useApiQuery((signal) => api.sellers.get(sellerSlug, signal), [sellerSlug])
  const seller = sellerQuery.data

  const { data: categories } = useApiQuery((signal) => api.categories.list(signal), [])
  const selectedCategory = categorySlug ? (categories ?? []).find((category) => category.slug === categorySlug) : null

  const listQuery = { seller: sellerSlug, category: categorySlug || (selectedCategories.length ? selectedCategories : undefined), q: search || undefined, minPrice: minPrice || undefined, maxPrice: maxPrice || undefined, availability: inStock ? 'in_stock' : undefined, sort, page, pageSize: 24 }
  const productsQuery = useApiQuery(
    (signal) => api.products.list(listQuery, signal),
    [JSON.stringify(listQuery)],
    { enabled: Boolean(seller) },
  )
  const visibleProducts = productsQuery.data?.items ?? []
  const pagination = productsQuery.data?.pagination
  const topDeal = visibleProducts.length
    ? [...visibleProducts].filter((product) => product.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent)[0]
    : null

  if (sellerQuery.error?.code === 'SELLER_NOT_FOUND') return <NotFoundPage />
  if (sellerQuery.isLoading) return <LoadingState label="Loading store" />
  if (sellerQuery.isError) {
    return <ErrorState title="We could not load this store" description={describeApiError(sellerQuery.error)} onRetry={sellerQuery.refetch} />
  }
  if (categorySlug && categories && !selectedCategory) return <NotFoundPage />
  if (!seller) return null

  return <>
    <SEOHead
      title={`${seller.name}${selectedCategory ? ` ${selectedCategory.name}` : ''} | Shop Products on Mirwal`}
      description={seller.description ? `${seller.description} Browse products and offers from ${seller.name} on Mirwal.` : `Browse products and offers from ${seller.name} on Mirwal.`}
    />
    <header className="public-seller-header">
      <div className="public-seller-avatar large">{seller.logoUrl || seller.imageUrl ? <img src={seller.logoUrl || seller.imageUrl} alt="" /> : <Icon name="store" />}</div>
      <div>
        <span>MARKETPLACE SELLER</span>
        <h1>{seller.name}</h1>
        <p>{seller.rating.count > 0 ? <><Icon name="star" /> {seller.rating.average.toFixed(1)} · {seller.rating.count} reviews</> : 'No reviews yet'} {seller.city && <><b>·</b> {seller.city}</>}</p>
        {seller.description && <p>{seller.description}</p>}
      </div>
      <button type="button" onClick={() => navigator.clipboard?.writeText(window.location.href)}><Icon name="share-nodes" /> Share</button>
      <div className="public-seller-banner">{seller.bannerUrl ? <img src={seller.bannerUrl} alt={`${seller.name} store banner`} /> : <div><Icon name="store" /><span>{seller.name}</span></div>}</div>
    </header>

    <section className="public-seller-stats">
      <div><Icon name="box" /><strong>{pagination?.total ?? seller.productCount ?? 0}</strong><span>Products</span></div>
      <div><Icon name="star" /><strong>{seller.rating.count > 0 ? seller.rating.average.toFixed(1) : '—'}</strong><span>Seller rating</span></div>
      <div><Icon name="comment" /><strong>{seller.rating.count}</strong><span>Reviews</span></div>
      <div><Icon name="circle" /><strong>Active</strong><span>Store status</span></div>
    </section>

    <section className="explore-quick seller-category-quick" aria-labelledby="seller-category-title">
      <div className="explore-quick-heading"><h2 id="seller-category-title">Shop by category</h2></div>
      <div className="explore-quick-list">
        <Link className={!categorySlug ? 'active' : ''} to={`/seller/${seller.slug}`}><span><Icon name="table-cells-large" /></span><b>All Products</b></Link>
        {(categories ?? []).map((category, index) => <Link className={categorySlug === category.slug ? 'active' : ''} to={`/seller/${seller.slug}/${category.slug}`} key={category.slug}><span><Icon name={sellerCategoryIcons[index % sellerCategoryIcons.length]} /></span><b>{category.name}</b></Link>)}
      </div>
    </section>

    {topDeal && (
      <PromoBanner
        eyebrow={`${seller.name} offer`}
        title={`${topDeal.discountPercent}% off ${topDeal.name}`}
        subtitle={`${topDeal.price.display}${topDeal.compareAtPrice ? ` — was ${topDeal.compareAtPrice.display}` : ''}`}
        ctaLabel="View product"
        onCta={() => navigateTo(`/product/${topDeal.slug}`)}
        image={topDeal.images[0]?.url}
        imageAlt={topDeal.images[0]?.alt ?? topDeal.name}
        badge={`−${topDeal.discountPercent}%`}
      />
    )}

    <div className="explore-main-layout public-seller-main-layout">
      <SellerFilterSidebar categories={categories ?? []} selectedCategories={selectedCategories} setSelectedCategories={(value) => { setSelectedCategories(value); setPage(1) }} minPrice={minPrice} setMinPrice={(value) => { setMinPrice(value); setPage(1) }} maxPrice={maxPrice} setMaxPrice={(value) => { setMaxPrice(value); setPage(1) }} inStock={inStock} setInStock={(value) => { setInStock(value); setPage(1) }} mobileFilters={mobileFilters} setMobileFilters={setMobileFilters} />
      <section className="public-seller-catalog">
      <div className="public-section-heading"><div><h2>{selectedCategory ? selectedCategory.name : 'Products from this seller'}</h2><span>{pagination?.total ?? 0} products</span></div><button type="button" className="explore-mobile-refine" onClick={() => setMobileFilters(true)}><Icon name="sliders" /> Filters</button><label><span>Sort by</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <label className="public-seller-search"><Icon name="magnifying-glass" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search in this store..." aria-label="Search in this store" /></label>

      {productsQuery.isLoading && <LoadingState label="Loading products" />}
      {productsQuery.isError && <ErrorState title="We could not load products" description={describeApiError(productsQuery.error)} onRetry={productsQuery.refetch} />}
      {!productsQuery.isLoading && !productsQuery.isError && visibleProducts.length === 0 && (
        <div className="public-seller-empty"><Icon name="box-open" /><h2>No products found</h2><p>Try another seller category.</p></div>
      )}
      {!productsQuery.isLoading && !productsQuery.isError && visibleProducts.length > 0 && (
        <>
          <div className="public-seller-product-grid">
            {visibleProducts.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}
          </div>
          <Pagination page={page} totalPages={pagination?.totalPages} onChange={setPage} />
        </>
      )}
      </section>
    </div>

    {seller.description && (
      <section className="public-seller-about">
        <span>ABOUT THE SELLER</span>
        <h2>Shop with context and confidence</h2>
        <p>{seller.description} Review each product's availability, delivery information and return terms on its product page before placing an order.</p>
      </section>
    )}
  </>
}

export default function SellerPages({ listing = false, onAddToCart }) {
  const { sellerSlug, categorySlug } = useParams()

  const title = listing ? 'Find trusted sellers in Pakistan | Mirwal' : undefined
  const description = listing ? 'Discover marketplace sellers, compare products and shop with confidence on Mirwal.' : undefined

  return <main className={`public-sellers${listing ? ' categories-page' : ''}`}>
    {listing && <SEOHead title={title} description={description} />}
    <div className="public-sellers-container">
      <nav aria-label="Breadcrumb">
        <Link to="/">Home</Link><Icon name="chevron-right" />
        {listing ? <span aria-current="page">Sellers</span> : <><Link to="/sellers">Sellers</Link><Icon name="chevron-right" /><span aria-current="page">{sellerSlug}</span></>}
      </nav>
      {listing ? <SellerListing /> : <SellerStorefront sellerSlug={sellerSlug} categorySlug={categorySlug} onAddToCart={onAddToCart} />}
    </div>
  </main>
}
