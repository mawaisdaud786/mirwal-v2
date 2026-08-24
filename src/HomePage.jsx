import { useEffect, useState } from 'react'
import { categories, products, reviews } from './data/mockData'
import heroBannerOne from './assets/hero-banner/ChatGPT Image Aug 23, 2026, 08_44_29 PM.png'
import heroBannerTwo from './assets/hero-banner/ChatGPT Image Aug 23, 2026, 08_47_21 PM.png'
import heroBannerThree from './assets/hero-banner/ChatGPT Image Aug 23, 2026, 08_51_25 PM.png'
import heroBannerFour from './assets/hero-banner/ChatGPT Image Aug 23, 2026, 09_03_13 PM.png'
import Header from './components/Header'
import Footer from './components/Footer'

const Icon = ({ children }) => <span className="icon" aria-hidden="true">{children}</span>

function Hero() {
  const banners = [heroBannerOne, heroBannerTwo, heroBannerThree, heroBannerFour]
  const [activeBanner, setActiveBanner] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveBanner((current) => (current + 1) % banners.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [banners.length])

  const showBanner = (direction) => {
    setActiveBanner((current) => (current + direction + banners.length) % banners.length)
  }

  return <section className="hero-carousel container" aria-label="Mirwal featured offers">
    <img src={banners[activeBanner]} alt="Mirwal smart shopping featured offer" />
    <button className="carousel-arrow previous" onClick={() => showBanner(-1)} aria-label="Previous banner">‹</button>
    <button className="carousel-arrow next" onClick={() => showBanner(1)} aria-label="Next banner">›</button>
    <div className="carousel-dots">{banners.map((banner, index) => <button key={banner} className={index === activeBanner ? 'selected' : ''} onClick={() => setActiveBanner(index)} aria-label={`Show banner ${index + 1}`} />)}</div>
  </section>
}

function TrustStrip() { return <div className="trust container">{[['✦','AI-Powered Discovery','Smart recommendations just for you'],['↗','Compare & Save','Compare prices, features & reviews'],['⌂','Trusted Stores','Verified sellers & authentic products'],['♧','Secure & Reliable','Safe payments & buyer protection'],['♧','24/7 Support','We’re here to help anytime']].map(([icon,title,copy]) => <div className="trust-item" key={title}><Icon>{icon}</Icon><div><b>{title}</b><small>{copy}</small></div></div>)}</div> }
function Stats() { return <div className="stats container">{[['50K+','Happy Customers'],['2,000+','Trusted Stores'],['100K+','Products Compared'],['98%','Positive Reviews']].map(([n,l]) => <div key={n}><strong>{n}</strong><span>{l}</span></div>)}</div> }
function AdSlot() { return <div className="ad-slot container" aria-label="Advertisement"><div className="ad-content"><small>Sponsored</small><b>Upgrade your everyday essentials</b><span>Exclusive offers from trusted Mirwal stores</span><button type="button">Explore Offer</button></div></div> }
function SectionHeading({ title, sub, link = 'View All' }) { return <div className="section-heading"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><a>{link} &nbsp;→</a></div> }
function Categories() { return <section className="container section category-section"><SectionHeading title="Shop by Category" link="View All Categories" /><div className="category-grid">{categories.map(([name,img]) => <article className="category" key={name}><img src={img} alt="" /><b>{name}</b></article>)}</div></section> }
function ProductCard({ product, onAddToCart }) { const [wishlisted, setWishlisted] = useState(false); const openProduct = () => { window.history.pushState({}, '', `/products/${product.id}`); window.dispatchEvent(new PopStateEvent('popstate')) }; return <article className="product-card" onClick={openProduct} onKeyDown={(event) => event.key === 'Enter' && openProduct()} tabIndex="0" role="link">{product.badge && <label className={product.badge === 'Great Value' ? 'green' : ''}>{product.badge}</label>}<button className={`heart btn${wishlisted ? ' selected' : ''}`} aria-label={`${wishlisted ? 'Remove' : 'Add'} ${product.name} ${wishlisted ? 'from' : 'to'} wishlist`} aria-pressed={wishlisted} onClick={(event) => { event.stopPropagation(); setWishlisted((selected) => !selected) }}>♡</button><img src={product.image} alt={product.name} /><div className="product-info"><h3>{product.name}</h3><small>{product.type}</small><p className="rating">★ {product.rating}</p><strong>{product.price}</strong>{product.old && <del>{product.old}</del>}<div className="compare"><input className="form-check-input" type="checkbox" onClick={(event) => event.stopPropagation()} /> Compare</div><button className="add-to-cart btn btn-primary" onClick={(event) => { event.stopPropagation(); onAddToCart(product) }}>Add to Cart</button></div></article> }
function ProductSection({ title, sub, items, link, onAddToCart, variant = '' }) { return <section className={`container section product-section ${variant}`}><SectionHeading title={title} sub={sub} link={link} /><div className="product-grid">{items.map((p) => <ProductCard key={p.name} product={p} onAddToCart={onAddToCart} />)}</div></section> }
function Deals() { return <div className="deal-row container"><div className="deal-banner"><div><b>Exclusive Deals Just For You!</b><span>Up to 50% OFF on top brands</span><button>Shop Exclusive Deals</button></div><strong>%</strong><span className="bag">M</span></div><div className="benefit-mini">{[['▣','Free Shipping','On orders over Rs. 2,000'],['♧','Easy Returns','Hassle-free returns within 7 days'],['▣','Secure Payments','Multiple secure payment options'],['♧','24/7 Support','We’re here to help anytime']].map(([i,t,c]) => <div key={t}><Icon>{i}</Icon><b>{t}</b><small>{c}</small></div>)}</div></div> }
function HowWorks() { return <section className="works"><div className="container"><SectionHeading title="How Mirwal Works?" sub="4 simple steps to find your perfect product" link="" /><div className="steps">{[['01','Tell Us Your Need','Share your requirement, budget or preference'],['02','We Find Solutions','Pair AI finds the best products and stores for you'],['03','Compare & Evaluate','Compare price, features, ratings and reviews'],['04','Choose with Confidence','Pick the right product and shop securely']].map(([n,t,c]) => <div key={n}><span>{n}</span><b>{t}</b><small>{c}</small></div>)}</div></div></section> }
function Stores() { return <section className="container stores"><SectionHeading title="Shop with Confidence" link="" /><div className="store-grid">{['daraz','PriceOye','megastore','electrohub','TELEMART','shopHive'].map(s => <div key={s}><b>{s}</b><small>Verified Store</small></div>)}</div></section> }
function Reviews() { return <section className="reviews"><div className="container"><SectionHeading title="What Shoppers Say About Mirwal" sub="Real people, real experiences" link="View All Reviews" /><div className="review-grid">{reviews.map(([name,place,quote,img]) => <article key={name}><div className="reviewer"><img src={img} alt="" /><b>{name}<small>{place}</small></b></div><div className="rating">★★★★★</div><p>“{quote}”</p></article>)}</div></div></section> }
function Newsletter() { return <section className="newsletter container"><div className="mail">✉</div><div><b>Stay Updated with Best Deals</b><p>Subscribe to get exclusive offers, new arrivals<br />and smart shopping tips.</p></div><div className="subscribe"><input placeholder="Enter your email address" /><button>Subscribe</button><small>No spam. Unsubscribe anytime.</small></div></section> }
export default function HomePage({ onAddToCart }) { return <><Header /><Hero /><TrustStrip /><Stats /><Categories /><AdSlot /><ProductSection title="Top Picks for You" sub="Handpicked products based on popularity and value" items={products.slice(0,5)} link="View All Deals" onAddToCart={onAddToCart} variant="top-picks" /><ProductSection title="More Products You'll Love" items={products.slice(5)} link="View All Products" onAddToCart={onAddToCart} variant="more-products" /><AdSlot /><Deals /><HowWorks /><Stores /><Reviews /><Newsletter /><Footer /></> }
