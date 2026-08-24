import Header from './components/Header'
import Footer from './components/Footer'
import { products } from './data/mockData'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function money(value) {
  return `Rs. ${value.toLocaleString('en-PK')}`
}

function CartItem({ item, onChangeQuantity, onRemove }) {
  return <article className="cart-item">
    <input className="cart-check" type="checkbox" defaultChecked aria-label={`Select ${item.name}`} />
    <img src={item.image} alt={item.name} />
    <div className="cart-product-info"><h3>{item.name}</h3><p>{item.type}</p><small>Color: Black</small><div className="cart-item-actions"><button type="button"><FaIcon name="heart" /> &nbsp; Move to Wishlist</button><button className="remove-cart-button" type="button" onClick={() => onRemove(item.id)}><FaIcon name="trash-can" /> &nbsp; Remove</button></div></div>
    <div className="cart-price"><strong>{item.price}</strong>{item.old && <del>{item.old}</del>}<span>{item.badge || '-20%'}</span></div>
    <div className="cart-quantity"><button type="button" onClick={() => onChangeQuantity(item.id, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`}>−</button><b>{item.quantity}</b><button type="button" onClick={() => onChangeQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`}>+</button></div>
    <strong className="cart-total">{money(parseInt(item.price.replace(/\D/g, ''), 10) * item.quantity)}</strong>
  </article>
}

function OrderSummary({ subtotal, discount, cartCount, onCheckout }) {
  return <aside className="order-summary"><h2>Order Summary</h2><div><span>Subtotal ({cartCount} items)</span><b>{money(subtotal)}</b></div><div><span>Discount</span><b className="saving">-{money(discount)}</b></div><div><span>Shipping</span><b className="free">FREE</b></div><div className="summary-total"><span>Total (VAT incl.)</span><strong>{money(subtotal - discount)}</strong></div><p className="saving-note"><FaIcon name="tag" /> &nbsp; You are saving {money(discount)} on this order!</p><button className="checkout-button" type="button" onClick={onCheckout}><FaIcon name="arrow-right" /> &nbsp; Proceed to Checkout</button><button className="continue-button" type="button" onClick={() => navigate('/')}>Continue Shopping</button><div className="coupon"><b>Have a coupon?</b><div><input placeholder="Enter coupon code" aria-label="Coupon code" /><button type="button">Apply</button></div></div><div className="summary-benefits"><p><FaIcon name="shield-halved" /> <b>100% Secure Payments</b><small>Your transactions are safe with us</small></p><p><FaIcon name="box-open" /> <b>7 Days Return</b><small>Easy returns & refunds</small></p><p><FaIcon name="headset" /> <b>24/7 Customer Support</b><small>We're here to help you anytime</small></p></div></aside>
}

function Recommendations({ onAddToCart }) {
  return <section className="cart-recommendations"><div className="cart-section-heading"><h2>You may also like</h2><button type="button">View all →</button></div><div className="cart-product-grid">{products.slice(5, 10).map((product) => <article className="cart-recommendation" key={product.id}><button className="recommend-heart" type="button" aria-label={`Add ${product.name} to wishlist`}><FaIcon name="heart" /></button><img src={product.image} alt={product.name} /><h3>{product.name}</h3><small>{product.type}</small><div className="recommend-price"><strong>{product.price}</strong>{product.old && <del>{product.old}</del>}</div><p><FaIcon name="star" /> {product.rating}</p><button className="recommend-add" type="button" onClick={() => onAddToCart(product)}><FaIcon name="cart-shopping" /> &nbsp; Add to cart</button></article>)}</div></section>
}

export default function CartPage({ cartItems, cartCount, onChangeQuantity, onRemove, onAddToCart, onCheckout }) {
  const subtotal = cartItems.reduce((sum, item) => sum + parseInt(item.price.replace(/\D/g, ''), 10) * item.quantity, 0)
  const discount = Math.round(subtotal * 0.2)
  return <><Header cartCount={cartCount} /><main className="cart-page container"><div className="cart-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><span>›</span>Cart</div><div className="cart-title-row"><div><h1>Your Shopping Cart <span>({cartCount})</span></h1><p>Review your items, update quantities or proceed to checkout.</p></div><div className="secure-cart"><FaIcon name="shield-halved" /> <b>100% Secure Shopping</b><small>Your data is safe and protected</small></div></div><div className="cart-layout"><section className="cart-list"><div className="cart-list-head"><span>Product</span><span>Price</span><span>Quantity</span><span>Total</span></div>{cartItems.length ? cartItems.map((item) => <CartItem key={item.id} item={item} onChangeQuantity={onChangeQuantity} onRemove={onRemove} />) : <div className="empty-cart"><h2>Your cart is empty</h2><p>Discover something you will love.</p><button className="checkout-button" type="button" onClick={() => navigate('/')}>Start Shopping →</button></div>}<div className="cart-controls"><label><input type="checkbox" defaultChecked /> Select All ({cartCount})</label><div><button className="clear-cart-button" type="button" onClick={() => cartItems.forEach((item) => onRemove(item.id))}><FaIcon name="trash-can" /> &nbsp; Clear Cart</button><button type="button"><FaIcon name="rotate" /> &nbsp; Update Cart</button></div></div></section><OrderSummary subtotal={subtotal} discount={discount} cartCount={cartCount} onCheckout={onCheckout} /></div><Recommendations onAddToCart={onAddToCart} /><div className="cart-benefits"><div><FaIcon name="shield-halved" /> <b>100% Secure Payments</b><small>Safe & encrypted</small></div><div><FaIcon name="rotate" /> <b>Easy Returns</b><small>Hassle-free returns</small></div><div><FaIcon name="truck-fast" /> <b>Fast Delivery</b><small>Across Pakistan</small></div><div><FaIcon name="headset" /> <b>24/7 Support</b><small>We're here for you</small></div></div></main><Footer /></>
}
