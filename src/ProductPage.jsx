import { useState } from 'react'
import { products } from './data/mockData'
import Header from './components/Header'
import Footer from './components/Footer'
import { navigateTo } from './navigation'

const defaultHighlights = ['Crisp, vibrant display for everyday use', 'All-day battery with fast charging', 'Reliable performance for everyday tasks', 'Thoughtful features for your routine', 'Seamless use with your other devices']
const defaultSpecifications = { Brand: 'Mirwal marketplace', Type: 'Everyday product', Availability: 'In stock', Warranty: '1 Year warranty', Delivery: 'Fast delivery across Pakistan' }

function navigate(path) { navigateTo(path) }

function reviewCount(rating) {
  const count = rating?.match(/\(([^)]+)\)/)?.[1]
  return count || '128'
}

const reviewSeed = [
  { name: 'Sara Khan', date: 'May 15, 2025', rating: 5, title: 'Excellent product!', text: 'Amazing quality and a smooth shopping experience. The recommendation was spot on.' },
  { name: 'Muhammad Ali', date: 'May 12, 2025', rating: 5, title: 'Worth the price', text: 'The product arrived quickly and works exactly as described. Very happy with the purchase.' },
  { name: 'Usman Farooq', date: 'May 08, 2025', rating: 4, title: 'Great everyday choice', text: 'Good build quality and reliable performance. Delivery was fast as well.' },
  { name: 'Ayesha Raza', date: 'May 02, 2025', rating: 5, title: 'Highly recommended', text: 'The quality is impressive and the product feels premium. I would buy it again.' },
  { name: 'Bilal Ahmed', date: 'April 27, 2025', rating: 4, title: 'Good experience', text: 'Everything matched the listing and customer support answered my question quickly.' },
  { name: 'Hina Malik', date: 'April 20, 2025', rating: 5, title: 'Perfect for daily use', text: 'Simple to use, dependable, and delivered safely. Exactly what I needed.' },
]

const questionSeed = [
  { name: 'Ahmed Raza', question: 'Is this product covered by warranty?', answer: 'Yes, 1 year warranty is included with this product.' },
  { name: 'Sana Malik', question: 'How quickly will it be delivered?', answer: 'Fast delivery across Pakistan and ships within 24 hours.' },
  { name: 'Bilal Khan', question: 'Is the product original?', answer: 'Yes, every product is verified and covered by our 100% original product guarantee.' },
  { name: 'Hira Ahmed', question: 'Can I return it if it does not meet my expectations?', answer: 'Yes, this product is eligible for easy returns within 7 days.' },
  { name: 'Usman Farooq', question: 'Are secure payment methods available?', answer: 'Yes, payments are securely encrypted and protected.' },
]

export default function ProductPage({ product, cartCount, onAddToCart }) {
  const [activeImage, setActiveImage] = useState(product.image)
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState('description')
  const [wishlisted, setWishlisted] = useState(false)
  const [activeColor, setActiveColor] = useState(0)
  const [reviewMessage, setReviewMessage] = useState('')
  const [isLoggedIn] = useState(() => window.localStorage.getItem('mirwal-authenticated') === 'true')
  const [customerReviews, setCustomerReviews] = useState(reviewSeed)
  const [visibleReviews, setVisibleReviews] = useState(3)
  const [reviewForm, setReviewForm] = useState({ rating: 5, title: '', text: '' })
  const [questionText, setQuestionText] = useState('')
  const [questionMessage, setQuestionMessage] = useState('')
  const gallery = product.gallery || [product.image]
  const highlights = product.highlights || defaultHighlights
  const specifications = { ...defaultSpecifications, ...(product.specifications || {}), Type: product.type }
  const reviewTotal = reviewCount(product.rating)
  const related = products.filter((item) => item.id !== product.id).slice(0, 5)
  const buyNow = () => { onAddToCart(product, quantity); navigate('/checkout') }
  const tabs = [['description', 'Description'], ['specifications', 'Specifications'], ['reviews', `Reviews (${reviewTotal})`], ['questions', 'Q&A']]
  const submitReview = (event) => {
    event.preventDefault()
    if (!reviewForm.text.trim()) return
    setCustomerReviews((items) => [{ name: 'You', date: 'Today', rating: reviewForm.rating, title: reviewForm.title || 'My review', text: reviewForm.text }, ...items])
    setReviewForm({ rating: 5, title: '', text: '' })
    setReviewMessage('Your review was added successfully.')
  }
  const submitQuestion = (event) => {
    event.preventDefault()
    if (!questionText.trim()) return
    setQuestionText('')
    setQuestionMessage('Your question was sent to the seller.')
  }

  return <>
    <Header cartCount={cartCount} />
    <main className="container product-detail">
      <div className="product-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button> <span>›</span> <button type="button" onClick={() => navigate(`/explore?category=${encodeURIComponent(product.category || '')}`)}>{product.category || product.type}</button> <span>›</span> {product.name}</div>
      <section className="detail-main">
        <div className="gallery"><div className="thumbnail-list">{gallery.map((image, index) => <button type="button" className={activeImage === image ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setActiveImage(image)}><img src={image} alt={`${product.name} view ${index + 1}`} /></button>)}</div><div className="main-image">{product.badge && <label>{product.badge}</label>}<img src={activeImage} alt={product.name} /><button type="button" className={`image-heart${wishlisted ? ' selected' : ''}`} aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'} aria-pressed={wishlisted} onClick={() => setWishlisted(!wishlisted)}>♡</button></div></div>
        <div className="detail-copy"><span className="detail-badge">{product.badge || 'Featured'}</span><h1>{product.name}</h1><div className="detail-rating"><b>★★★★★</b> <strong>{product.rating}</strong> <span>Highly rated by shoppers</span></div><div className="detail-price"><strong>{product.price}</strong>{product.old && <del>{product.old}</del>}<em>{product.old ? 'Save today' : 'Great value'}</em></div><small>Inclusive of all taxes</small><div className="detail-benefits"><span>♧ <b>Free Delivery</b><small>On orders over Rs. 2,000</small></span><span>↻ <b>Easy Returns</b><small>Returns within 7 days</small></span><span>✓ <b>{specifications.Warranty}</b><small>Official warranty</small></span></div><h3>Product highlights</h3><ul>{highlights.map((feature) => <li key={feature}>{feature}</li>)}</ul></div>
        <aside className="buy-panel"><div className="stock"><span /> In Stock <small>Ships within 24 hours</small></div><b>Color: {['Black', 'Silver', 'Rose Gold', 'Blue'][activeColor]}</b><div className="swatches">{['Black', 'Silver', 'Rose Gold', 'Blue'].map((color, index) => <button type="button" aria-label={`Select ${color}`} className={activeColor === index ? 'active' : ''} key={color} onClick={() => setActiveColor(index)} />)}</div><b>Quantity</b><div className="quantity"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><span>{quantity}</span><button type="button" aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)}>+</button><small>Only 8 items left!</small></div><button type="button" className="buy-primary" onClick={() => onAddToCart(product, quantity)}>♧ &nbsp; Add to Cart</button><button type="button" className="buy-secondary" onClick={buyNow}>Buy Now</button><button type="button" className="buy-secondary" onClick={() => setWishlisted(!wishlisted)}>♡ &nbsp; {wishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}</button><div className="seller-note"><div className="seller-note-heading"><b>Sold by Awais Store</b><button type="button" onClick={() => navigate('/stores/awais-store')}>Visit Store <span>→</span></button></div><span>✓ 100% Original Products</span><span>▣ Secure payments</span><span>↻ Fast delivery</span></div></aside>
      </section>
      <nav className="detail-tabs" aria-label="Product information">{tabs.map(([value, label]) => <button type="button" className={activeTab === value ? 'active' : ''} key={value} onClick={() => setActiveTab(value)}>{label}</button>)}</nav>
      {activeTab === 'description' && <section className="description-grid"><article><h2>Product Description</h2><p>The {product.name} is designed for people who want reliable performance, thoughtful features and a great everyday experience.</p><p>Enjoy a refined design, dependable battery life and the smart features you need, backed by Mirwal's trusted shopping experience.</p><div className="feature-grid">{highlights.slice(0, 6).map((feature) => <span key={feature}><b>✓</b><strong>{feature}</strong><small>Built for your daily routine</small></span>)}</div></article><article><h2>What's in the box</h2><ul>{(product.inTheBox || [`1 × ${product.name}`, '1 × Charging cable', '1 × User manual', '1 × Warranty card']).map((item) => <li key={item}>{item}</li>)}</ul><div className="confidence"><b>Shop with confidence</b><span>✓ 100% Original Products</span><span>▣ Secure and encrypted payments</span><span>↻ Fast delivery across Pakistan</span></div></article></section>}
      {activeTab === 'specifications' && <section className="description-grid"><article><h2>Specifications</h2><ul>{Object.entries(specifications).map(([label, value]) => <li key={label}><strong>{label}:</strong> {value}</li>)}</ul></article><article><h2>Delivery & returns</h2><p>{specifications.Delivery}. This product is eligible for easy returns within 7 days.</p><div className="confidence"><b>Verified product details</b><span>✓ {specifications.Warranty}</span><span>▣ Secure payments</span></div></article></section>}
      {activeTab === 'reviews' && <section className="product-reviews"><div className="review-summary"><article><h2>Customer Reviews</h2><strong>{product.rating?.split(' ')[0] || '4.8'}</strong><div className="stars">★★★★★</div><small>Based on {reviewTotal} reviews</small></article><article><h2>Share your experience</h2>{isLoggedIn ? <form className="review-form" onSubmit={submitReview}><label>Rating <select value={reviewForm.rating} onChange={(event) => setReviewForm({ ...reviewForm, rating: Number(event.target.value) })}><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select></label><label>Title <input value={reviewForm.title} onChange={(event) => setReviewForm({ ...reviewForm, title: event.target.value })} placeholder="Summarize your experience" /></label><label>Your review <textarea required value={reviewForm.text} onChange={(event) => setReviewForm({ ...reviewForm, text: event.target.value })} placeholder="What did you think about this product?" /></label><button type="submit">Publish Review</button>{reviewMessage && <small role="status">{reviewMessage}</small>}</form> : <><p>Sign in to share your experience with other shoppers.</p><button type="button" onClick={() => navigate('/login')}>Sign In to Review</button></>}</article></div><div className="review-list">{customerReviews.slice(0, visibleReviews).map((review) => <article className="review-item" key={`${review.name}-${review.date}`}><div className="review-heading"><b>{review.name}</b><span>{review.name === 'You' ? 'Your Review' : 'Verified Buyer'}</span><small>{review.date}</small></div><div className="stars">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</div><h3>{review.title}</h3><p>{review.text}</p></article>)}</div>{visibleReviews < customerReviews.length && <button type="button" className="load-more-reviews" onClick={() => setVisibleReviews((count) => count + 3)}>Load More Reviews</button>}</section>}
      {activeTab === 'questions' && <section className="product-questions"><div className="questions-list">{questionSeed.map((item) => <article className="question-item" key={item.question}><div className="question-heading"><b>{item.name}</b><small>Verified Buyer</small></div><h3>{item.question}</h3><p>{item.answer}</p></article>)}</div><article className="ask-question"><h2>Have a question?</h2><form className="question-form" onSubmit={submitQuestion}><label htmlFor="product-question">Your question</label><div><input id="product-question" required value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Ask the seller about this product" /><button type="submit">Send</button></div>{questionMessage && <small role="status">{questionMessage}</small>}</form></article></section>}
      <section className="related-products"><div className="related-heading"><h2>You May Also Like</h2><button onClick={() => navigate('/')}>View All →</button></div><div className="product-grid">{related.map((item) => <article className="product-card" key={item.id} onClick={() => navigate(`/products/${item.id}`)}><button className="heart btn" onClick={(event) => event.stopPropagation()}>♡</button><img src={item.image} alt={item.name} /><div className="product-info"><h3>{item.name}</h3><small>{item.type}</small><p className="rating">★ {item.rating}</p><strong>{item.price}</strong><button className="add-to-cart btn btn-primary" onClick={(event) => { event.stopPropagation(); onAddToCart(item) }}>Add to Cart</button></div></article>)}</div></section>
    </main>
    <Footer />
  </>
}
