import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import { useRecommendedProducts } from './hooks/useRecommendations'
import { getRecentSlugs, recordProductView } from './lib/recommendations'
import WishlistHeart from './components/WishlistHeart'
import api from './api'

/**
 * Homepage.
 *
 * Every section here used to read from the local `products`/`categories` mock arrays, which
 * meant "Recommended Picks", "Trending Right Now" and the rest were really just fixed slices
 * of the same 34-item array — not anything computed. Converted to the catalog API, section by
 * section, each owning its own query so one slow or empty section doesn't blank the page.
 *
 * Removed rather than converted, because there is no real data to back them:
 *
 *   - `Stats` ("50K+ Happy Customers", "2,000+ Trusted Stores", "100K+ Products Compared",
 *     "98% Positive Reviews") — invented numbers with no backing metric anywhere in the
 *     system. This is the same class of fabricated business claim the Phase 0 audit removed
 *     elsewhere (fake review counts, fake warranty terms).
 *   - The per-product editorial claims in `RecommendedPicks` ("Best overall", "Best for
 *     creators", ...) and `ComparePreview`'s "Best for: Creative work" / "Value: More power"
 *     rows. Both were static captions pointing at whatever mock product happened to sit at a
 *     hard-coded array index — not a real editorial judgement. Replaced with a reason computed
 *     from the product's own real rating/discount, and with real fields (Brand, Category) in
 *     the compare table.
 *   - The "Great Value" product badge, a fabricated marketing label. Products carry a real
 *     discount percentage now; that's what the ribbon shows.
 *
 * `reviews` stays a local empty array rather than an import — there is no reviews API yet
 * (Phase 10), and an empty testimonials section was already the correct behaviour before this
 * pass (PROJECT_AUDIT.md S-4/S-5).
 *
 * `Hero` used to rotate through four static banner images (`hero-1..4.webp`) that baked in,
 * as literal pixels, the exact class of fabricated numbers this file's comment above already
 * bans in text form: "50K+ Happy Customers", "2,000+ Trusted Stores", "100K+ Products
 * Compared", "98% Positive Reviews", plus a fixed set of product/price callouts that weren't
 * tied to the real catalog. Removed the images; the hero now spotlights real, live products
 * from `pool` (the same newest-arrivals query already fetched for `ShoppingShortcuts`) instead
 * of a stock graphic. The rotating carousel (arrows + dots) went with it — four near-identical
 * fake-stat slides weren't meaningfully different content, just added UI to maintain.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />
const reviews = []
const faqItems = [
  ['How does Mirwal help me shop?', 'Tell us what you need, then compare products, prices, ratings and trusted stores in one place.'],
  ['Are the stores verified?', 'Mirwal highlights trusted stores so you can make a more informed purchase decision.'],
  ['Can I compare products?', 'Yes. Select products from any product list and open Compare to evaluate their features and prices.'],
  ['How are recommendations chosen?', 'Recommendations use product ratings, discounts and your recent shopping activity when available.'],
  ['Where can I find current deals?', 'Open Deals to browse currently discounted products and filter them by category, brand or discount.'],
]
/** Reason strings computed from the product's own real fields, not an editorial guess. */
function pickReason(product) {
  if (product.discountPercent > 0) return `${product.discountPercent}% off right now`
  if (product.rating.count > 0) return `Rated ${product.rating.average.toFixed(1)} by ${product.rating.count} buyers`
  return 'New on the Mirwal marketplace'
}
function productOverview(product) {
  const category = product.category?.name ?? 'everyday needs'
  if (product.rating.count > 0 && product.discountPercent > 0) return `Strong value in ${category}, with a ${product.rating.average.toFixed(1)} rating.`
  if (product.rating.count > 0) return `A well-rated ${category} pick for everyday use.`
  if (product.discountPercent > 0) return `A practical ${category} pick with current savings.`
  return `A new ${category} option worth exploring.`
}

/** A decorative image from a live product, indexed with wraparound so a short pool never runs out. */
function poolImage(pool, index) {
  if (!pool.length) return undefined
  return pool[index % pool.length]?.images?.[0]?.url
}

function Hero({ pool }) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const spotlight = pool.slice(0, 3)

  const submitSearch = (event) => { event.preventDefault(); const value = query.trim(); navigate(value ? `/explore?search=${encodeURIComponent(value)}` : '/explore') }

  return <section className="hero-section container" aria-labelledby="homepage-title">
    <div className="hero-content">
      <span className="hero-eyebrow"><FaIcon name="wand-magic-sparkles" /> AI-Powered Shopping Assistant</span>
      <h1 id="homepage-title">Find the right product,<br />without the research.</h1>
      <p>Tell Mirwal what you need. Compare prices, ratings and stores, then choose with confidence.</p>
      <form onSubmit={submitSearch}><FaIcon name="magnifying-glass" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="I need a laptop for graphic design under Rs. 200,000" aria-label="What are you shopping for" /><button type="submit">Search <FaIcon name="arrow-right" /></button></form>
      <button type="button" className="hero-ai-button" onClick={() => navigate('/ai-assistant')}><FaIcon name="wand-magic-sparkles" /> Ask Mirwal AI</button>
    </div>
    {spotlight.length > 0 && <div className="hero-visual">
      <div className="hero-visual-backdrop" aria-hidden="true" />
      {spotlight.map((product, index) => <button type="button" key={product.id} className="hero-spotlight-card" onClick={() => navigateTo(`/product/${product.slug}`)}>
        <img src={product.images[0]?.url} alt={product.images[0]?.alt ?? product.name} loading={index === 0 ? 'eager' : 'lazy'} />
        <span><b>{product.name}</b><strong>{product.price.display}</strong></span>
      </button>)}
    </div>}
  </section>
}

function ShoppingShortcuts({ pool }) {
  const shortcuts = [
    ['lightbulb', 'Shop by Need', 'Find products for a purpose', () => navigateTo('/explore?need=work')],
    ['wallet', 'Shop by Budget', 'Start with what you want to spend', () => navigateTo('/explore?budget=25000')],
    ['scale-balanced', 'Compare Products', 'See the important differences', () => navigateTo('/compare')],
    ['bolt', "Today's Deals", 'Save on popular products', () => navigateTo('/deals')],
  ]
  return <section className="container shopping-shortcuts" aria-labelledby="shop-your-way"><SectionHeading title="Shop Your Way" sub="Choose the path that fits your shopping goal" icon="compass" /><div className="shortcut-grid">{shortcuts.map(([icon, title, copy, action], index) => <button type="button" key={title} onClick={action}><span className="decision-card-image"><img src={poolImage(pool, index)} alt="" loading="lazy" /><FaIcon name={icon} /></span><b>{title}</b><small>{copy}</small><FaIcon name="arrow-right" /></button>)}</div></section>
}
function RecommendedPicks({ cartItems }) {
  // Ranked against this visitor's own viewed/cart/purchase history (src/lib/recommendations.js)
  // rather than a flat "sort=recommended" query — which, server-side, is literally identical
  // to "sort=rating" and so showed every visitor the same four products regardless of what
  // "Recommended" implied. A guest with no history yet still gets that same top-rated set;
  // personalization only ever narrows toward their own real signal once it exists.
  const { data: items } = useRecommendedProducts({ cartItems, limit: 4 })
  if (!items.length) return null
  return <section className="container recommendation-section" aria-labelledby="recommended-picks"><SectionHeading title="Recommended Picks" sub="A snapshot of what's on Mirwal right now" icon="star" /><div className="recommendation-grid">{items.map((product) => <article key={product.id}><span className="recommendation-label"><FaIcon name="star" /> Recommended</span><button type="button" onClick={() => navigateTo(`/product/${product.slug}`)}><img src={product.images[0]?.url} alt={product.name} /><div><b>{product.name}</b><span className="recommendation-rating">{product.rating.count > 0 ? <><FaIcon name="star" /> {product.rating.average.toFixed(1)} <small>({product.rating.count} reviews)</small></> : 'No reviews yet'}</span><strong>{product.price.display}</strong><small className={`recommendation-reason ${product.discountPercent > 0 ? 'discount' : ''}`}>{pickReason(product)}</small></div></button></article>)}<button className="row-view-all" type="button" onClick={() => navigateTo('/explore')}>See All Recommendations <FaIcon name="arrow-right" /></button></div></section>
}

function ComparePreview() {
  const { data } = useApiQuery((signal) => api.products.list({ sort: 'rating', pageSize: 2 }, signal), [])
  const [first, second] = data?.items ?? []
  if (!first || !second) return null
  const rating = (product) => product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : 'No reviews yet'
  const rows = [
    ['Price', first.price.display, second.price.display],
    ['Rating', rating(first), rating(second)],
    ['Brand', first.brand?.name ?? 'Unbranded', second.brand?.name ?? 'Unbranded'],
    ['Category', first.category?.name ?? '—', second.category?.name ?? '—'],
  ]
  return <section className="container compare-preview" aria-labelledby="compare-before-buy"><div><span className="eyebrow"><FaIcon name="scale-balanced" /> Make a confident decision</span><h2>Compare before you buy</h2><p>Put the important details side by side and see which option fits your needs, budget and priorities.</p><button type="button" onClick={() => navigateTo('/compare')}>Compare Products <FaIcon name="arrow-right" /></button></div><div className="compare-preview-table"><div className="compare-product-head"><span>Feature</span><b>{first.name}</b><b>{second.name}</b></div>{rows.map(([feature, one, two]) => <div key={feature}><span>{feature}</span><b>{one}</b><b>{two}</b></div>)}</div></section>
}

function ReturningUserSection({ onAddToCart }) {
  const [slugs] = useState(() => getRecentSlugs().slice(0, 4))
  const { data } = useApiQuery(
    (signal) => Promise.all(slugs.map((slug) => api.products.get(slug, signal).catch(() => null))),
    [slugs.join(',')],
    { enabled: slugs.length > 0 },
  )
  const recentProducts = (data ?? []).filter(Boolean)
  if (!recentProducts.length) return null
  return <ProductSection title="Continue Shopping" sub="Pick up where you left off" items={recentProducts} link="View All Products" onAddToCart={onAddToCart} variant="continue-shopping" />
}

function SectionHeading({ title, sub, link, onLinkClick, icon }) { return <div className="section-heading"><div><h2>{title}{icon && <span className="section-heading-icon"><FaIcon name={icon} /></span>}</h2>{sub && <p>{sub}</p>}</div>{link && <button type="button" onClick={onLinkClick}>{link} <FaIcon name="arrow-right" /></button>}</div> }

function Categories() {
  const { data } = useApiQuery((signal) => api.categories.list(signal), [])
  const categories = data ?? []
  if (!categories.length) return null
  return <section className="container section category-section"><SectionHeading title="Shop by Category" icon="layer-group" /><div className="category-grid">{categories.slice(0, 6).map((category) => <button className="category" type="button" key={category.slug} onClick={() => navigateTo(`/categories/${category.slug}`)}><img src={category.imageUrl} alt={category.name} /><b>{category.name}</b></button>)}<button className="category-view-all" type="button" onClick={() => navigateTo('/categories')}>View All Categories <FaIcon name="arrow-right" /></button></div></section>
}

function ProductCard({ product, onAddToCart }) {
  const image = product.images[0]
  const badge = product.discountPercent > 0
    ? { label: `−${product.discountPercent}%`, tone: 'discount' }
    : product.rating.count > 0
      ? { label: 'Top Rated', tone: 'rating' }
      : { label: 'New Arrival', tone: 'new' }
  const openProduct = () => {
    recordProductView(product.slug)
    navigateTo(`/product/${product.slug}`)
  }
  return <article className="product-card"><WishlistHeart product={product} /><label className={`product-badge ${badge.tone}`}>{badge.label}</label><button type="button" className="product-card-link" onClick={openProduct}><img src={image?.url} alt={image?.alt ?? product.name} /><span className="product-info"><b>{product.name}</b><small>{product.subtitle}</small><span className="rating">{product.rating.count > 0 ? <><FaIcon name="star" /> {product.rating.average.toFixed(1)} <small>({product.rating.count})</small></> : 'No reviews yet'}</span><span className="product-price-row"><strong>{product.price.display}</strong>{product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}</span><small className="product-overview"><FaIcon name="wand-magic-sparkles" /> {productOverview(product)}</small></span></button><div className="product-actions"><button type="button" className="add-to-cart" disabled={product.availability?.inStock === false} onClick={(event) => { event.stopPropagation(); onAddToCart?.(product) }}><FaIcon name="cart-shopping" /> {product.availability?.inStock === false ? 'Out of stock' : 'Add to Cart'}</button></div></article>
}
function ProductSection({ title, sub, items, link, onAddToCart, variant = '' }) { const sectionIcon = variant === 'trending-products' ? 'arrow-trend-up' : variant === 'flash-sales' ? 'bolt' : variant === 'continue-shopping' ? 'clock-rotate-left' : variant === 'lifestyle-products' ? 'house' : undefined; return <section className={`container section product-section ${variant}`}><SectionHeading title={title} sub={sub} icon={sectionIcon} /><div className="product-grid">{items.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}{link && <button className="row-view-all" type="button" onClick={() => navigateTo(link === 'View All Deals' ? '/deals' : '/explore')}>{link} <FaIcon name="arrow-right" /></button>}</div></section> }

/**
 * A ProductSection backed directly by one catalog query. Renders nothing while loading, on
 * error, or if the query genuinely comes back empty — no skeleton, matching ProductPage's
 * RelatedProducts.
 */
function ApiProductSection({ title, sub, link, query, onAddToCart, variant }) {
  const { data } = useApiQuery((signal) => api.products.list(query, signal), [JSON.stringify(query)])
  const items = data?.items ?? []
  if (!items.length) return null
  return <ProductSection title={title} sub={sub} items={items} link={link} onAddToCart={onAddToCart} variant={variant} />
}

function Deals() { return <div className="deal-row container"><div className="deal-banner"><div><b>Exclusive Deals Just For You!</b><span>Up to 50% OFF on top brands</span><button type="button" onClick={() => navigateTo('/deals')}><FaIcon name="tag" /> Shop Exclusive Deals</button></div><strong><FaIcon name="percent" /></strong><FaIcon name="bag-shopping" /></div><div className="benefit-mini">{[['truck-fast','Free Shipping','On orders over Rs. 2,000'],['arrow-rotate-left','Easy Returns','Hassle-free returns within 7 days'],['shield-halved','Secure Payments','Multiple secure payment options'],['headset','24/7 Support',"We're here to help anytime"]].map(([i,t,c]) => <div key={t}><FaIcon name={i} /><b>{t}</b><small>{c}</small></div>)}</div></div> }
function AiCta() { return <section className="ai-home-cta container"><div><span className="eyebrow"><FaIcon name="wand-magic-sparkles" /> Smart shopping assistant</span><h2>Not sure what to buy?</h2><p>Tell Mirwal your needs, budget and preferences to get a shortlist you can compare with confidence.</p></div><button type="button" onClick={() => navigateTo('/ai-assistant')}>Find my perfect product <FaIcon name="arrow-right" /></button></section> }
function HowWorks() { return <section className="works"><div className="container"><SectionHeading title="How Mirwal Works?" sub="4 simple steps to find your perfect product" /><div className="steps">{[['01','Tell Us Your Need','Share your requirement, budget or preference'],['02','We Find Solutions','AI finds the best products and stores for you'],['03','Compare & Evaluate','Compare price, features, ratings and reviews'],['04','Choose with Confidence','Pick the right product and shop securely']].map(([n,t,c]) => <div key={n}><span>{n}</span><b>{t}</b><small>{c}</small></div>)}</div></div></section> }
function Reviews() { if (!reviews.length) return null; return <section className="reviews"><div className="container"><SectionHeading title="What Shoppers Say About Mirwal" sub="Real people, real experiences" link="Explore Products" onLinkClick={() => navigateTo('/explore')} /><div className="review-grid">{reviews.map(([name,place,quote,img]) => <article key={name}><div className="reviewer"><img src={img} alt={`${name}, Mirwal customer`} /><b>{name}<small>{place}</small></b></div><div className="rating" aria-label="5 out of 5 stars"><FaIcon name="star" /> <FaIcon name="star" /> <FaIcon name="star" /> <FaIcon name="star" /> <FaIcon name="star" /></div><p>"{quote}"</p></article>)}</div></div></section> }

function PopularBrands() {
  const { data } = useApiQuery((signal) => api.products.facets(signal), [])
  const brands = (data?.brands ?? []).slice(0, 8)
  if (!brands.length) return null
  return <section className="container brands-section"><SectionHeading title="Popular Brands" sub="Brands available on the Mirwal marketplace" icon="certificate" link="Browse Brands" onLinkClick={() => navigateTo('/brands')} /><div className="brand-grid">{brands.map((brand) => <button type="button" key={brand.slug} onClick={() => navigateTo(`/brands/${brand.slug}`)}><FaIcon name="certificate" /><span>{brand.name}</span></button>)}</div></section>
}

function Faq() {
  const [openQuestion, setOpenQuestion] = useState(null)
  return <section className="container faq-section"><SectionHeading title="Frequently Asked Questions" sub="Helpful answers before you start shopping" icon="circle-question" link="Visit Help Center" onLinkClick={() => navigateTo('/help-center')} /><div className="faq-list">{faqItems.map(([question, answer]) => <details key={question} open={openQuestion === question} onToggle={(event) => { if (event.currentTarget.open) setOpenQuestion(question); else setOpenQuestion((current) => current === question ? null : current) }}><summary>{question}<FaIcon name="chevron-down" /></summary><p>{answer}</p></details>)}</div></section>
}
function Newsletter() { const [email, setEmail] = useState(''); const [submitted, setSubmitted] = useState(false); const submit = (event) => { event.preventDefault(); if (event.currentTarget.reportValidity()) setSubmitted(true) }; return <section className="newsletter container"><FaIcon name="envelope" /><div><b>Stay Updated with Best Deals</b><p>Subscribe for exclusive offers, new arrivals and smart shopping tips.</p></div><form className="subscribe" onSubmit={submit}><label className="sr-only" htmlFor="newsletter-email">Email address</label><div><input id="newsletter-email" type="email" required value={email} onChange={(event) => { setEmail(event.target.value); setSubmitted(false) }} placeholder="Enter your email address" /><button type="submit"><FaIcon name="paper-plane" /> Subscribe</button></div><small>{submitted ? "You're subscribed. Watch your inbox for Mirwal deals." : 'No spam. Unsubscribe anytime.'}</small></form></section> }
export default function HomePage({ onAddToCart, cartItems = [] }) {
  const { data: poolData } = useApiQuery((signal) => api.products.list({ sort: 'newest', pageSize: 24 }, signal), [])
  const pool = poolData?.items ?? []

  return <main className="home-page">
    <Hero pool={pool} />
    <ShoppingShortcuts pool={pool} />
    <RecommendedPicks cartItems={cartItems} />
    <ApiProductSection title="Trending Right Now" sub="Popular products shoppers are comparing today" query={{ sort: 'rating', pageSize: 10 }} link="View All Products" onAddToCart={onAddToCart} variant="trending-products" />
    <ApiProductSection title="Flash Sales" sub="Limited-time savings on products worth a closer look" query={{ minDiscount: 1, sort: 'rating', pageSize: 10 }} link="View All Deals" onAddToCart={onAddToCart} variant="flash-sales" />
    <ReturningUserSection onAddToCart={onAddToCart} />
    <AiCta />
    <ComparePreview />
    <ApiProductSection title="Home & Lifestyle Favorites" sub="Upgrade your everyday essentials" query={{ category: 'home-comfort-and-smart-living', pageSize: 6 }} link="View All Products" onAddToCart={onAddToCart} variant="lifestyle-products" />
    <Deals />
    <Categories />
    <PopularBrands />
    <HowWorks />
    <Reviews />
    <Faq />
    <Newsletter />
  </main>
}
