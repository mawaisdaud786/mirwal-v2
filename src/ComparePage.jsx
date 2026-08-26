import { useMemo, useState } from 'react'
import { products } from './data/mockData'
import Header from './components/Header'
import Footer from './components/Footer'
import compareBanner from './assets/images/compare.png'
import './compare.css'
import { navigateTo } from './navigation'

function navigate(path) { navigateTo(path) }

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const detailByType = {
  Smartphone: { Brand: 'Apple', Type: 'Smartphone', Connectivity: '5G, Wi-Fi 6', 'Battery Life': 'Up to 20 hours', Weight: '171 g', Warranty: '1 Year' },
  Smartwatch: { Brand: 'Samsung', Type: 'Smartwatch', Connectivity: 'Bluetooth 5.3', 'Battery Life': 'Up to 40 hours', Weight: '33.3 g', Warranty: '1 Year' },
  Laptop: { Brand: 'Dell', Type: 'Laptop', Connectivity: 'Wi-Fi 6, Bluetooth', 'Battery Life': 'Up to 8 hours', Weight: '1.65 kg', Warranty: '1 Year' },
  'Wireless earbuds': { Brand: 'Sony', Type: 'TWS Earbuds', Connectivity: 'Bluetooth 5.3', 'Battery Life': 'Up to 24 hours', Weight: '5.9 g (Each)', Warranty: '1 Year' },
  'Kitchen appliance': { Brand: 'Philips', Type: 'Kitchen Appliance', Connectivity: 'Touch controls', 'Battery Life': 'N/A', Weight: '4.5 kg', Warranty: '2 Years' },
  Headphones: { Brand: 'JBL', Type: 'Over Ear Headphones', Connectivity: 'Bluetooth 5.3', 'Battery Life': 'Up to 70 hours', Weight: '232 g', Warranty: '1 Year' },
  Camera: { Brand: 'Canon', Type: 'DSLR Camera', Connectivity: 'Wi-Fi, Bluetooth', 'Battery Life': 'Up to 600 shots', Weight: '449 g', Warranty: '1 Year' },
}

const featureNames = ['Price', 'Ratings', 'Brand', 'Type', 'Connectivity', 'Battery Life', 'Charging Time', 'Water Resistance', 'Active Noise Cancellation', 'Microphone', 'Compatibility', 'Weight', 'Warranty']
const compareImages = {
  'jbl-tune-770nc': 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=500&q=85',
  'sony-wf-1000xm5': 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&q=85',
  'amazfit-gtr-4': 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=85',
  'samsung-galaxy-watch-6': 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=500&q=85',
}

function productDetails(product) {
  return { ...(detailByType[product.type] || {}), Price: product.price, Ratings: <span className="compare-table-rating"><FaIcon name="star" /> {product.rating}</span>, 'Charging Time': '1.5 Hours', 'Water Resistance': product.type === 'Smartwatch' ? '5 ATM' : 'No', 'Active Noise Cancellation': ['Headphones', 'Wireless earbuds'].includes(product.type) ? <FaIcon name="check" /> : <FaIcon name="xmark" />, Microphone: 'Built-in Mic', Compatibility: 'Android, iOS, Windows', Brand: detailByType[product.type]?.Brand || product.name.split(' ')[0], Type: product.type, }
}

function ProductCard({ product, onRemove, onAddToCart }) {
  return <article className="compare-product-card">
    <button className="compare-remove" type="button" onClick={() => onRemove(product.id)} aria-label={`Remove ${product.name} from comparison`} title="Remove product"><FaIcon name="xmark" /></button>
    <span className="compare-badge">{product.badge || 'Popular'}</span>
    <img src={compareImages[product.id] || product.image} alt={product.name} />
    <h3 title={product.name}>{product.name}</h3>
    <small>{product.type}</small>
    <p className="compare-rating"><FaIcon name="star" /> {product.rating}</p>
    <strong>{product.price}</strong>
    {product.old && <del>{product.old}</del>}
    <button className="compare-cart" type="button" onClick={() => onAddToCart(product)}>Add to Cart</button>
  </article>
}

export default function ComparePage({ cartCount, onAddToCart }) {
  const [selectedIds, setSelectedIds] = useState(['jbl-tune-770nc', 'sony-wf-1000xm5', 'amazfit-gtr-4', 'samsung-galaxy-watch-6'])
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const selected = selectedIds.map((id) => products.find((product) => product.id === id)).filter(Boolean)
  const available = useMemo(() => products.filter((product) => !selectedIds.includes(product.id) && `${product.name} ${product.type}`.toLowerCase().includes(search.toLowerCase())), [search, selectedIds])

  const removeProduct = (id) => setSelectedIds((ids) => ids.filter((selectedId) => selectedId !== id))
  const addProduct = (id) => {
    if (selectedIds.length < 4) setSelectedIds((ids) => [...ids, id])
    else setNotice('Remove a product before adding another')
  }
  const shareComparison = async () => {
    const text = `Mirwal comparison: ${selected.map((product) => product.name).join(', ')}`
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Comparison copied to clipboard')
    } catch {
      setNotice('Comparison is ready to share')
    }
    window.setTimeout(() => setNotice(''), 2200)
  }

  return <><Header cartCount={cartCount} /><main className="compare-page">
    <section className="compare-hero"><div className="container compare-hero-inner"><div><div className="compare-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><span>›</span>Compare</div><h1>Compare <span>products</span></h1><p>Compare features, prices and reviews to find<br />the best product for your needs.</p><div className="compare-points"><span><FaIcon name="layer-group" /><b>Compare up to 4 products</b><small>Add products to compare</small></span><span><FaIcon name="magnifying-glass-chart" /><b>See key differences</b><small>Side-by-side comparison</small></span><span><FaIcon name="award" /><b>Choose the best</b><small>Pick what’s right for you</small></span></div></div><div className="compare-art"><img src={compareBanner} alt="Mirwal product comparison banner" /></div></div></section>
    <section className="comparison-section container"><div className="comparison-toolbar"><div><h2>Your comparison <span>{selected.length} / 4 products added</span></h2><p>{selected.length ? 'Review products side by side to make a confident choice.' : 'Add products below to start comparing.'}</p></div><div><button className="compare-clear" type="button" onClick={() => setSelectedIds([])}>Clear all</button><button className="compare-share" type="button" onClick={shareComparison}><FaIcon name="share-nodes" /> Share comparison</button></div></div>
      <div className="comparison-layout"><aside className="compare-sidebar"><button className="sidebar-close" type="button" aria-label="Close product picker"></button><h3>Add products to<br />compare</h3><p>Search and select products you want to compare.</p><label className="compare-search"><span></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." aria-label="Search products to compare" /></label><div className="available-products">{available.slice(0, 5).map((product) => <button type="button" key={product.id} onClick={() => addProduct(product.id)}><img src={compareImages[product.id] || product.image} alt="" /><span><b>{product.name}</b><small>{product.type}</small></span><em>Add</em></button>)}</div><button className="all-products" type="button" onClick={() => navigate('/explore')}>View all products</button></aside><div className="comparison-content"><div className={`compare-cards compare-cards-${selected.length}`}><div className="compare-card-spacer" aria-hidden="true" />{selected.map((product) => <ProductCard key={product.id} product={product} onRemove={removeProduct} onAddToCart={onAddToCart} />)}</div>{selected.length > 0 && <div className="feature-table-wrap"><table className="feature-table"><thead><tr><th scope="col">Features</th>{selected.map((product) => <th scope="col" key={product.id}>{product.name}</th>)}</tr></thead><tbody>{featureNames.map((feature) => <tr key={feature}><th scope="row">{feature}</th>{selected.map((product) => <td key={product.id}>{feature === 'Price' ? <b>{productDetails(product)[feature]}</b> : productDetails(product)[feature]}</td>)}</tr>)}<tr><th scope="row">Add to Cart</th>{selected.map((product) => <td key={product.id}><button className="table-cart" type="button" onClick={() => onAddToCart(product)}>Add to cart</button></td>)}</tr></tbody></table></div>}</div></div>
    </section>
    <section className="compare-choice container"><div><h2>Not sure which one to choose?</h2><p>Get personalized recommendations based on your needs.</p><button type="button" onClick={() => setNotice('Tell us your priorities and we will guide you')}>Help me choose <FaIcon name="wand-magic-sparkles" /></button></div>{[['Best for Music', 'music'], ['Best Battery Life', 'battery-full'], ['Best for Fitness', 'person-running'], ['Best Value', 'tag'], ['Lightweight', 'feather'], ['Water Resistant', 'droplet']].map(([item, icon]) => <button type="button" key={item} onClick={() => setNotice(`${item} recommendations are coming up`)}><span><FaIcon name={icon} /></span><b>{item}</b></button>)}</section>
    <section className="compare-benefits container"><div><span><FaIcon name="shield-halved" /></span><b>100% Secure Payments</b><small>Safe & encrypted</small></div><div><span><FaIcon name="rotate-left" /></span><b>Easy Returns</b><small>Hassle-free returns</small></div><div><span><FaIcon name="truck-fast" /></span><b>Fast Delivery</b><small>Across Pakistan</small></div><div><span><FaIcon name="headset" /></span><b>24/7 Support</b><small>We're here for you</small></div></section>
    <section className="compare-newsletter container"><div><h2>Stay updated with the best products &amp; deals</h2><p>Subscribe to our newsletter and never miss an update.</p></div><form onSubmit={(event) => { event.preventDefault(); setNotice('Thanks for subscribing to Mirwal') }}><input type="email" required placeholder="Enter your email address" aria-label="Email address" /><button type="submit">Subscribe</button></form><span className="newsletter-art" aria-hidden="true"><FaIcon name="envelope-open-text" /></span></section>
    {notice && <div className="compare-notice" role="status">{notice}</div>}
  </main><div className="compare-footer"><Footer /></div></>
}