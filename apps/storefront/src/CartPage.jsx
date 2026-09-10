import { useEffect, useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import { formatMinorUnits, lineSaving, lineListTotal, lineTotal } from '@mirwal/shared/money'
import { useRecommendedProducts } from './hooks/useRecommendations'
import { navigateTo } from '@mirwal/shared/navigation'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) { navigateTo(path) }

const money = (minor) => formatMinorUnits(minor)

function CartItem({ item, onChangeQuantity, onRemove }) {
  return <article className="cart-item">
    <input className="cart-check" type="checkbox" defaultChecked aria-label={`Select ${item.name}`} />
    <img src={item.image} alt={item.name} />
    <div className="cart-product-info"><h3>{item.name}</h3><p>{item.subtitle}</p><div className="cart-item-actions"><button type="button"><FaIcon name="heart" /> &nbsp; Move to Wishlist</button><button className="remove-cart-button" type="button" onClick={() => onRemove(item.id)}><FaIcon name="trash-can" /> &nbsp; Remove</button></div></div>
    <div className="cart-price"><strong>{money(item.unitMinor)}</strong>{item.compareMinor > 0 && <del>{money(item.compareMinor)}</del>}</div>
    <div className="cart-quantity"><button type="button" onClick={() => onChangeQuantity(item.id, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}>−</button><b>{item.quantity}</b><button type="button" onClick={() => onChangeQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}>+</button></div>
    <strong className="cart-total">{money(lineTotal(item))}</strong>
  </article>
}

function OrderSummary({ subtotal, discount, cartCount, onCheckout }) {
  const [coupon, setCoupon] = useState('')
  const [couponMessage, setCouponMessage] = useState('')
  const applyCoupon = () => setCouponMessage(coupon.trim() ? 'Coupon validation is available at checkout.' : 'Enter a coupon code first.')
  return <aside className="order-summary"><h2>Order Summary</h2><div><span>Subtotal ({cartCount} items)</span><b>{money(subtotal)}</b></div>{discount > 0 && <div><span>Discount</span><b className="saving">-{money(discount)}</b></div>}<div><span>Shipping</span><b className="free">FREE</b></div><div className="summary-total"><span>Total</span><strong>{money(subtotal - discount)}</strong></div>{discount > 0 && <p className="saving-note"><FaIcon name="tag" /> &nbsp; You are saving {money(discount)} on this order!</p>}<button className="checkout-button" type="button" onClick={onCheckout}><FaIcon name="arrow-right" /> &nbsp; Proceed to Checkout</button><button className="continue-button" type="button" onClick={() => navigate('/')}>Continue Shopping</button><div className="coupon"><b>Have a coupon?</b><div><input value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="Enter coupon code" aria-label="Coupon code" /><button type="button" onClick={applyCoupon}>Apply</button></div>{couponMessage && <small role="status">{couponMessage}</small>}</div><div className="summary-benefits"><p><FaIcon name="shield-halved" /> <b>100% Secure Payments</b><small>Your transactions are safe with us</small></p><p><FaIcon name="box-open" /> <b>7 Days Return</b><small>Easy returns & refunds</small></p><p><FaIcon name="truck-fast" /> <b>Fast Delivery</b><small>Across Pakistan</small></p><p><FaIcon name="headset" /> <b>24/7 Support</b><small>We're here to help anytime</small></p></div></aside>
}

// The heading is a prop because this section carries different weight depending on the cart:
// alongside items it's a cross-sell ("You may also like"), but on an empty cart it is the only
// content on the page, so it leads with what it actually is — a starting point.
const SUGGESTION_COUNT = 5

function Recommendations({ onAddToCart, cartItems = [], title = 'You may also like' }) {
  // Scored against what this shopper has actually viewed, has in this cart, and (signed in)
  // has bought before — see src/lib/recommendations.js. excludeIds inside the hook already
  // covers everything in `cartItems` and past purchases, so no extra filtering is needed here.
  const { data: suggestions } = useRecommendedProducts({ cartItems, limit: SUGGESTION_COUNT })
  // Genuinely nothing left to suggest (the catalog is exhausted) is the only empty case now.
  if (suggestions.length === 0) return null
  return <section className="cart-recommendations"><div className="cart-section-heading"><h2>{title}</h2><button type="button" onClick={() => navigate('/explore')}>View all →</button></div><div className="cart-product-grid">{suggestions.map((product) => <article className="cart-recommendation" key={product.id}><img src={product.images[0]?.url} alt={product.images[0]?.alt ?? product.name} loading="lazy" /><h3>{product.name}</h3><small>{product.subtitle}</small><div className="recommend-price"><strong>{product.price.display}</strong>{product.compareAtPrice && <del>{product.compareAtPrice.display}</del>}</div>{product.rating.count > 0 && <p><FaIcon name="star" /> {product.rating.average.toFixed(1)} ({product.rating.count})</p>}<button className="recommend-add" type="button" onClick={() => onAddToCart(product)}><FaIcon name="cart-shopping" /> &nbsp; Add to cart</button></article>)}</div></section>
}

export default function CartPage({ cartItems, cartCount, onChangeQuantity, onRemove, onAddToCart, onCheckout }) {
  // Subtotal is the pre-discount list total, so subtotal - discount is the real price.
  const subtotal = cartItems.reduce((sum, item) => sum + lineListTotal(item), 0)
  const discount = cartItems.reduce((sum, item) => sum + lineSaving(item), 0)
  const isEmpty = cartItems.length === 0
  useEffect(() => { document.title = 'Shopping cart | Mirwal'; let meta = document.querySelector('meta[name="robots"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'robots'; document.head.appendChild(meta) }; meta.setAttribute('content', 'noindex,follow') }, [])
  // An empty cart drops the whole order/summary apparatus rather than rendering it zeroed out.
  // Previously it showed "Subtotal (0 items) Rs. 0", "You are saving Rs. 0 on this order!" and a
  // live "Proceed to Checkout" button next to column headers with no rows and a "Select All (0)"
  // control — a checkout CTA that cannot succeed, wrapped in maths about nothing. The suggestions
  // section already on this page becomes the page's content instead, which is the one thing a
  // shopper with an empty cart can actually act on.
  return <><Header cartCount={cartCount} /><main className="cart-page container"><div className="cart-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><span>›</span>Cart</div><div className="cart-title-row"><div><h1>Your Shopping Cart <span>({cartCount})</span></h1><p>{isEmpty ? 'Nothing in your cart yet — here are some products to start with.' : 'Review your items, update quantities or proceed to checkout.'}</p></div></div>{isEmpty ? <><div className="empty-cart"><h2>Your cart is empty</h2><p>Discover something you will love.</p><button className="checkout-button" type="button" onClick={() => navigate('/')}>Start Shopping →</button></div><Recommendations onAddToCart={onAddToCart} title="Popular on Mirwal right now" /></> : <div className="cart-layout"><div className="cart-main"><section className="cart-list"><div className="cart-list-head"><span>Product</span><span>Price</span><span>Quantity</span><span>Total</span></div>{cartItems.map((item) => <CartItem key={item.id} item={item} onChangeQuantity={onChangeQuantity} onRemove={onRemove} />)}<div className="cart-controls"><label><input type="checkbox" defaultChecked /> Select All ({cartCount})</label><div><button className="clear-cart-button" type="button" onClick={() => cartItems.forEach((item) => onRemove(item.id))}><FaIcon name="trash-can" /> &nbsp; Clear Cart</button><button type="button"><FaIcon name="rotate" /> &nbsp; Update Cart</button></div></div></section><Recommendations onAddToCart={onAddToCart} cartItems={cartItems} /></div><OrderSummary subtotal={subtotal} discount={discount} cartCount={cartCount} onCheckout={onCheckout} /></div>}</main><Footer /></>
}
