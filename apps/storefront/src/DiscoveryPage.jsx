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
import './categories-page.css'

/**
 * Brand discovery — listing plus per-brand product grid.
 *
 * This component used to also handle a `type="categories"` mode, but no route in App.jsx ever
 * passes that — CategoriesPage owns `/categories`. That branch (and the `type` prop) is gone;
 * this is brand-only now.
 *
 * Also fixed: another instance of the duplicate-chrome bug found while converting Search and
 * Compare — this page rendered its own <Header>/<Footer> while mounted under PublicLayout,
 * which already renders both `global`.
 *
 * Brand logos are real (`brand.logoUrl`) rather than borrowed from a matching product's photo
 * the way the mock version did — the dev seed has none yet, so a brand card without one just
 * shows the icon, which is honest about what's actually configured.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function ProductTile({ product }) {
  const image = product.images[0]
  return (
    <article className="discovery-product">
      <Link to={`/product/${product.slug}`}>
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        <div>
          <b>{product.name}</b>
          <small>{product.rating.count > 0 ? <><FaIcon name="star" /> {product.rating.average.toFixed(1)}</> : 'No reviews yet'}</small>
          <strong>{product.price.display}</strong>
          {product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}
        </div>
        <FaIcon name="arrow-right" />
      </Link>
    </article>
  )
}

function BrandCard({ brand }) {
  return (
    <Link className="category-card discovery-card" to={`/brand/${brand.slug}`}>
      <div className="category-card-media">
        {brand.logoUrl ? <img src={brand.logoUrl} alt={`${brand.name} products`} loading="lazy" /> : <span className="category-card-fallback"><FaIcon name="certificate" /></span>}
        <span className="category-card-shade" aria-hidden="true" />
      </div>
      <span className="category-card-content"><span className="category-card-icon"><FaIcon name="certificate" /></span><strong>{brand.name}</strong></span>
      <small className="category-card-count"><b>{brand.productCount}</b> {brand.productCount === 1 ? 'Product' : 'Products'}</small>
      <small className="category-card-tagline">Explore trusted products.</small>
      <FaIcon name="arrow-right" />
    </Link>
  )
}

export default function DiscoveryPage() {
  const { brandSlug, slug, categorySlug } = useParams()
  const activeBrandSlug = brandSlug || slug
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  // Switching brand or category should always land back on page 1 — otherwise a shopper who
  // was on page 3 of one brand's catalogue could land on an out-of-range page of the next.
  // Adjusted during render (React's documented pattern for resetting state on a prop change)
  // rather than in an effect, which would cost an extra render.
  const [scopeKey, setScopeKey] = useState(`${activeBrandSlug}|${categorySlug}`)
  const nextScopeKey = `${activeBrandSlug}|${categorySlug}`
  if (scopeKey !== nextScopeKey) {
    setScopeKey(nextScopeKey)
    setPage(1)
  }

  const { data: brands, error: brandsError, isLoading: brandsLoading, refetch: refetchBrands } = useApiQuery((signal) => api.brands.list(signal), [])
  const { data: categories } = useApiQuery((signal) => api.categories.list(signal), [])

  const selectedBrand = activeBrandSlug ? (brands ?? []).find((brand) => brand.slug === activeBrandSlug) : null
  const selectedCategory = categorySlug ? (categories ?? []).find((category) => category.slug === categorySlug) : null

  const productsQuery = useApiQuery(
    (signal) => api.products.list({ brand: activeBrandSlug, category: categorySlug || undefined, page, pageSize: 24 }, signal),
    [activeBrandSlug, categorySlug, page],
    { enabled: Boolean(selectedBrand) },
  )
  const visibleProducts = productsQuery.data?.items ?? []
  const pagination = productsQuery.data?.pagination

  const matchingBrands = (brands ?? []).filter((brand) => brand.name.toLowerCase().includes(search.toLowerCase()))
  // Real, current picks only: whichever product on this brand's page actually has the
  // biggest discount, or (with no brand selected) whichever real brand carries the most
  // products — never a fixed or editorial choice.
  const topDeal = visibleProducts.length
    ? [...visibleProducts].filter((product) => product.discountPercent > 0).sort((a, b) => b.discountPercent - a.discountPercent)[0]
    : null
  const topBrand = !selectedBrand && brands?.length
    ? [...brands].sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0))[0]
    : null

  if (activeBrandSlug && !brandsLoading && !brandsError && !selectedBrand) return <NotFoundPage />
  if (categorySlug && categories && !selectedCategory) return <NotFoundPage />

  const titleName = selectedBrand?.name ?? 'Brands'
  const description = selectedBrand
    ? `Explore ${selectedBrand.name} products in Pakistan. Compare prices, ratings and offers from Mirwal sellers.`
    : 'Find products from brands available on the Mirwal marketplace, all in one place.'

  return <main className={`discovery-page${!activeBrandSlug ? ' categories-page' : ''}`}>
    <SEOHead
      title={selectedBrand ? `${selectedBrand.name}${selectedCategory ? ` ${selectedCategory.name}` : ''} | Compare Products & Prices | Mirwal` : `${titleName} | Mirwal`}
      description={description}
    />
    <div className="container">
      <nav className="discovery-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link><FaIcon name="chevron-right" />
        {selectedBrand ? <><Link to="/brands">Brands</Link><FaIcon name="chevron-right" /><span aria-current="page">{selectedBrand.name}{selectedCategory ? ` / ${selectedCategory.name}` : ''}</span></> : <span aria-current="page">{titleName}</span>}
      </nav>

      <header className="discovery-heading">
        <div>
          <span className="discovery-eyebrow"><FaIcon name="certificate" /> MIRWAL DISCOVERY</span>
          <h1>{selectedBrand ? `${selectedBrand.name}${selectedCategory ? ` ${selectedCategory.name}` : ''}` : 'Shop by Brand'}</h1>
          <p>{description}</p>
        </div>
        {!selectedBrand && (
          <label className="discovery-search">
            <FaIcon name="magnifying-glass" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search brands" aria-label="Search brands" />
          </label>
        )}
      </header>

      {brandsLoading && <LoadingState label="Loading brands" />}
      {brandsError && <ErrorState title="We could not load brands" description={describeApiError(brandsError)} onRetry={refetchBrands} />}

      {selectedBrand ? (
        <>
          <nav className="discovery-shortcuts" aria-label="Brand sections">
            <Link to={`/brand/${selectedBrand.slug}`}>All Products <FaIcon name="arrow-right" /></Link>
            {(categories ?? []).slice(0, 4).map((category) => <Link to={`/brand/${selectedBrand.slug}/${category.slug}`} key={category.slug}>{category.name} <FaIcon name="arrow-right" /></Link>)}
            <Link to="/compare">Compare <FaIcon name="arrow-right" /></Link>
          </nav>
          {topDeal && (
            <PromoBanner
              eyebrow={`${selectedBrand.name} offer`}
              title={`${topDeal.discountPercent}% off ${topDeal.name}`}
              subtitle={`${topDeal.price.display}${topDeal.compareAtPrice ? ` — was ${topDeal.compareAtPrice.display}` : ''}`}
              ctaLabel="View product"
              onCta={() => navigateTo(`/product/${topDeal.slug}`)}
              image={topDeal.images[0]?.url}
              imageAlt={topDeal.images[0]?.alt ?? topDeal.name}
              badge={`−${topDeal.discountPercent}%`}
            />
          )}
          <section className="discovery-section">
            <div className="discovery-section-heading"><div><h2>{selectedBrand.name} products</h2><p>{pagination?.total ?? 0} products available for comparison</p></div></div>
            {productsQuery.isLoading && <LoadingState label="Loading products" />}
            {productsQuery.isError && <ErrorState title="We could not load products" description={describeApiError(productsQuery.error)} onRetry={productsQuery.refetch} />}
            {!productsQuery.isLoading && !productsQuery.isError && (
              visibleProducts.length
                ? <><div className="discovery-product-grid">{visibleProducts.map((product) => <ProductTile key={product.id} product={product} />)}</div>
                    <Pagination page={page} totalPages={pagination?.totalPages} onChange={setPage} /></>
                : <div className="discovery-empty"><FaIcon name="box-open" /><h2>No products found</h2><p>Try another brand category.</p></div>
            )}
          </section>
          <section className="discovery-section discovery-related">
            <div className="discovery-section-heading"><div><h2>Related brands</h2><p>More names to explore on Mirwal</p></div></div>
            <div className="category-card-grid">
              {(brands ?? []).filter((brand) => brand.slug !== selectedBrand.slug).slice(0, 6).map((brand) => <BrandCard key={brand.slug} brand={brand} />)}
            </div>
          </section>
        </>
      ) : (!brandsLoading && !brandsError && (
        <section className="discovery-section">
          {topBrand && (
            <PromoBanner
              eyebrow="Most stocked brand"
              title={topBrand.name}
              subtitle={`${topBrand.productCount} ${topBrand.productCount === 1 ? 'product' : 'products'} to compare right now.`}
              ctaLabel={`Shop ${topBrand.name}`}
              onCta={() => navigateTo(`/brand/${topBrand.slug}`)}
              image={topBrand.logoUrl}
              imageAlt={`${topBrand.name} logo`}
            />
          )}
          <div className="discovery-section-heading"><div><h2>Popular brands</h2><p>{matchingBrands.length} brands to explore</p></div></div>
          <div className="category-card-grid">{matchingBrands.map((brand) => <BrandCard key={brand.slug} brand={brand} />)}</div>
          {!matchingBrands.length && <div className="discovery-empty"><FaIcon name="magnifying-glass" /><h2>Nothing found</h2><p>Try a different search.</p></div>}
        </section>
      ))}
    </div>
  </main>
}
