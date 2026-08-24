import { useState } from 'react'
import { categories, products } from './data/mockData'
import Header from './components/Header'
import Footer from './components/Footer'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const browseCategories = [
  ['Mobiles', 'mobile-screen-button'], ['Laptops', 'laptop'], ['Electronics', 'headphones'], ['Home & Living', 'couch'],
  ['Fashion', 'shirt'], ['Beauty', 'bottle-droplet'], ['Sports', 'football'], ['Automotive', 'car'], ['More', 'ellipsis']
]

const dealProducts = products.slice(0, 5)

function ProductCard({ product, onAddToCart }) {
  const [wishlisted, setWishlisted] = useState(false)
  const openProduct = () => navigate(`/products/${product.id}`)
  return <article className="explore-product-card" onClick={openProduct} onKeyDown={(event) => event.key === 'Enter' && openProduct()} tabIndex="0" role="link"><button className={wishlisted ? 'explore-heart selected' : 'explore-heart'} type="button" aria-label={`${wishlisted ? 'Remove' : 'Add'} ${product.name} ${wishlisted ? 'from' : 'to'} wishlist`} onClick={(event) => { event.stopPropagation(); setWishlisted(!wishlisted) }}><FaIcon name="heart" /></button><img src={product.image} alt={product.name} /><h3>{product.name}</h3><small>{product.type}</small><p className="explore-rating">★ {product.rating}</p><strong>{product.price}</strong>{product.old && <del>{product.old}</del>}<label><input type="checkbox" onClick={(event) => event.stopPropagation()} /> Add to compare</label><button className="explore-add" type="button" onClick={(event) => { event.stopPropagation(); onAddToCart(product) }}><FaIcon name="cart-shopping" /> Add to cart</button></article>
}

function DealCard({ product }) {
  return <article className="explore-deal-card" onClick={() => navigate(`/products/${product.id}`)}><label>{product.badge || '-20%'}</label><img src={product.image} alt={product.name} /><h3>{product.name}</h3><strong>{product.price}</strong>{product.old && <del>{product.old}</del>}<small>Only {(product.name.length % 8) + 3} left</small></article>
}

function FilterGroup({ title, children }) {
  return <section className="explore-filter-group"><h3>{title}<FaIcon name="chevron-up" /></h3>{children}</section>
}

function CheckOption({ children }) {
  return <label className="explore-check"><input type="checkbox" /> {children}</label>
}

export default function ProductsPage({ onAddToCart, cartCount }) {
  const [sort, setSort] = useState('Popular')
  const [search, setSearch] = useState('')
  const filteredProducts = products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()) || product.type.toLowerCase().includes(search.toLowerCase()))
  const sortedProducts = [...filteredProducts].sort((a, b) => sort === 'Price: Low to High' ? parseInt(a.price.replace(/\D/g, ''), 10) - parseInt(b.price.replace(/\D/g, ''), 10) : sort === 'Price: High to Low' ? parseInt(b.price.replace(/\D/g, ''), 10) - parseInt(a.price.replace(/\D/g, ''), 10) : 0)
  return <><Header cartCount={cartCount} /><main className="explore-page"><div className="container"><div className="explore-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><span>›</span>Explore</div><div className="explore-title"><div><h1>Explore</h1><p>Discover millions of products, top brands and great deals, all in one place.</p></div><div className="explore-search"><FaIcon name="magnifying-glass" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /></div></div><div className="browse-category-row">{browseCategories.map(([name, icon]) => <button type="button" key={name} onClick={() => setSearch(name === 'Mobiles' ? 'phone' : name)}><span><FaIcon name={icon} /></span><b>{name}</b></button>)}</div><section className="explore-hero"><div><h2>New here?</h2><p>Get the best picks handpicked for you.</p><button type="button" onClick={() => document.querySelector('.explore-products')?.scrollIntoView({ behavior: 'smooth' })}>Explore deals <FaIcon name="arrow-right" /></button></div><div className="explore-hero-art" aria-hidden="true"><div className="hero-bag">M</div><div className="hero-device phone" /><div className="hero-device watch" /><div className="hero-device buds" /></div></section><section className="explore-section"><div className="explore-section-heading"><h2>Shop by category</h2><button type="button">View all categories <FaIcon name="arrow-right" /></button></div><div className="category-showcase">{categories.slice(0, 6).map(([name, image]) => <button type="button" key={name} onClick={() => setSearch(name)}><img src={image} alt="" /><b>{name}</b></button>)}</div></section><section className="explore-section deals-section"><div className="explore-section-heading"><h2>Top deals right now</h2><button type="button">View all deals <FaIcon name="arrow-right" /></button></div><div className="explore-deals">{dealProducts.map((product) => <DealCard key={product.id} product={product} />)}</div></section><section className="explore-products"><div className="explore-toolbar"><b>Filters</b><span>Showing 1 - {sortedProducts.length} of 12,540 results</span><label>Sort by: <select value={sort} onChange={(event) => setSort(event.target.value)}><option>Popular</option><option>Price: Low to High</option><option>Price: High to Low</option></select></label></div><div className="explore-product-layout"><aside className="explore-filters"><div className="filter-heading"><b>Filters</b><button type="button" onClick={() => setSearch('')}>Clear all</button></div><FilterGroup title="Categories"><CheckOption>Mobiles <small>(1250)</small></CheckOption><CheckOption>Laptops <small>(900)</small></CheckOption><CheckOption>Electronics <small>(2340)</small></CheckOption><CheckOption>Home & Living <small>(1580)</small></CheckOption><CheckOption>Fashion <small>(2150)</small></CheckOption><button className="show-more" type="button">+ Show more</button></FilterGroup><FilterGroup title="Brand"><input className="filter-search" placeholder="Search brand" /><CheckOption>Apple <small>(560)</small></CheckOption><CheckOption>Samsung <small>(820)</small></CheckOption><CheckOption>Dell <small>(420)</small></CheckOption><CheckOption>HP <small>(410)</small></CheckOption><button className="show-more" type="button">+ Show more</button></FilterGroup><FilterGroup title="Price range"><div className="range-track"><i /><i /></div><div className="range-values"><span>Rs. 500</span><span>Rs. 250,000</span></div></FilterGroup><FilterGroup title="Customer rating"><CheckOption>4 & above <small>(2200)</small></CheckOption><CheckOption>3 & above <small>(4120)</small></CheckOption><CheckOption>2 & above <small>(4300)</small></CheckOption></FilterGroup><button className="apply-filters" type="button">Apply filters</button></aside><div className="explore-grid">{sortedProducts.length ? sortedProducts.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />) : <p className="no-products">No products match your search.</p>}</div></div><div className="explore-pagination"><button type="button" className="current">1</button><button type="button">2</button><button type="button">3</button><button type="button">4</button><button type="button">5</button><span>...</span><button type="button">523</button><button type="button" aria-label="Next page">›</button></div></section></div><div className="explore-trust"><div className="container">{[['bag-shopping', '100% Secure Payments', 'Safe & encrypted'], ['rotate-left', 'Easy Returns', 'Hassle-free returns'], ['truck-fast', 'Fast Delivery', 'Across Pakistan'], ['headset', '24/7 Support', "We're here for you"]].map(([icon, title, detail]) => <p key={title}><FaIcon name={icon} /><span><b>{title}</b><small>{detail}</small></span></p>)}</div></div><section className="explore-newsletter container"><div><h2>Get the best deals & updates</h2><p>Subscribe to our newsletter and never miss an update.</p></div><input placeholder="Enter your email address" aria-label="Email address" /><button type="button">Subscribe</button></section></main><Footer /></>
}
