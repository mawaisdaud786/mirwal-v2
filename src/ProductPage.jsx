import { useState } from 'react'
import { products } from './data/mockData'
import Header from './components/Header'
import Footer from './components/Footer'

const highlights = ['Crisp, vibrant display for everyday use', 'All-day battery with fast charging', 'Health and activity tracking', 'Water resistant for daily adventures', 'Seamless calls, alerts and notifications']

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function ProductPage({ product, cartCount, onAddToCart }) {
  const [activeImage, setActiveImage] = useState(product.image)
  const [quantity, setQuantity] = useState(1)
  const gallery = [product.image, product.image, product.image, product.image]
  const related = products.filter((item) => item.id !== product.id).slice(0, 5)

  return <>
    <Header cartCount={cartCount} />
    <main className="container product-detail">
      <div className="product-breadcrumb"><button onClick={() => navigate('/')}>Home</button> <span>›</span> {product.type} <span>›</span> {product.name}</div>
      <section className="detail-main">
        <div className="gallery"><div className="thumbnail-list">{gallery.map((image, index) => <button className={activeImage === image && index === 0 ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setActiveImage(image)}><img src={image} alt={`${product.name} view ${index + 1}`} /></button>)}</div><div className="main-image">{product.badge && <label>{product.badge}</label>}<img src={activeImage} alt={product.name} /><button className="image-heart">♡</button></div></div>
        <div className="detail-copy"><span className="detail-badge">Best Seller</span><h1>{product.name}</h1><div className="detail-rating"><b>★★★★★</b> <strong>{product.rating}</strong> <span>Highly rated by shoppers</span></div><div className="detail-price"><strong>{product.price}</strong>{product.old && <del>{product.old}</del>}<em>Save today</em></div><small>Inclusive of all taxes</small><div className="detail-benefits"><span>♧ <b>Free Delivery</b><small>On orders over Rs. 2,000</small></span><span>↻ <b>Easy Returns</b><small>Returns within 7 days</small></span><span>✓ <b>1 Year Warranty</b><small>Official warranty</small></span></div><h3>Product highlights</h3><ul>{highlights.map((feature) => <li key={feature}>{feature}</li>)}</ul></div>
        <aside className="buy-panel"><div className="stock"><span /> In Stock <small>Ships within 24 hours</small></div><b>Color: Black</b><div className="swatches"><button className="active" /><button /><button /><button /></div><b>Quantity</b><div className="quantity"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><span>{quantity}</span><button onClick={() => setQuantity(quantity + 1)}>+</button><small>Only 8 items left!</small></div><button className="buy-primary" onClick={() => onAddToCart(product, quantity)}>♧ &nbsp; Add to Cart</button><button className="buy-secondary" onClick={() => onAddToCart(product, quantity)}>Buy Now</button><button className="buy-secondary">♡ &nbsp; Add to Wishlist</button><div className="seller-note"><div className="seller-note-heading"><b>Sold by Awais Store</b><button type="button" onClick={() => navigate('/stores/awais-store')}>Visit Store <span>→</span></button></div><span>✓ 100% Original Products</span><span>▣ Secure payments</span><span>↻ Fast delivery</span></div></aside>
      </section>
      <nav className="detail-tabs"><a className="active">Description</a><a>Specifications</a><a>Reviews (128)</a><a>Q&A</a></nav>
      <section className="description-grid"><article><h2>Product Description</h2><p>The {product.name} is designed for people who want reliable performance, thoughtful features and a great everyday experience.</p><p>Enjoy a refined design, dependable battery life and the smart features you need, backed by Mirwal's trusted shopping experience.</p><div className="feature-grid">{[['✧','Premium design'],['♡','Smart monitoring'],['♧','Everyday performance'],['⌁','Long battery life'],['▣','Helpful notifications'],['✓','Trusted quality']].map(([icon, title]) => <span key={title}><b>{icon}</b><strong>{title}</strong><small>Built for your daily routine</small></span>)}</div></article><article><h2>What's in the box</h2><ul><li>1 × {product.name}</li><li>1 × Charging cable</li><li>1 × User manual</li><li>1 × Warranty card</li></ul><div className="confidence"><b>Shop with confidence</b><span>✓ 100% Original Products</span><span>▣ Secure and encrypted payments</span><span>↻ Fast delivery across Pakistan</span></div></article></section>
      <section className="review-summary"><article><h2>Customer Reviews</h2><strong>4.8</strong><div className="stars">★★★★★</div><small>Based on 128 reviews</small><button>Write a Review</button></article><article><div className="review-heading"><b>Sara Khan</b><span>Verified Buyer</span><small>May 15, 2025</small></div><div className="stars">★★★★★</div><h3>Excellent product!</h3><p>Amazing display and build quality. The experience has been smooth and the recommendation was spot on.</p></article></section>
      <section className="related-products"><div className="related-heading"><h2>You May Also Like</h2><button onClick={() => navigate('/')}>View All →</button></div><div className="product-grid">{related.map((item) => <article className="product-card" key={item.id} onClick={() => navigate(`/products/${item.id}`)}><button className="heart btn" onClick={(event) => event.stopPropagation()}>♡</button><img src={item.image} alt={item.name} /><div className="product-info"><h3>{item.name}</h3><small>{item.type}</small><p className="rating">★ {item.rating}</p><strong>{item.price}</strong><button className="add-to-cart btn btn-primary" onClick={(event) => { event.stopPropagation(); onAddToCart(item) }}>Add to Cart</button></div></article>)}</div></section>
    </main>
    <Footer />
  </>
}
