import { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function money(value) {
  return `Rs. ${value.toLocaleString('en-PK')}`
}

function priceOf(item) {
  return parseInt(item.price.replace(/\D/g, ''), 10) * item.quantity
}

function Field({ label, required = false, children }) {
  return <label className="checkout-field"><span>{label}{required && <em> *</em>}</span>{children}</label>
}

function Choice({ title, detail, selected, onSelect, icon }) {
  return <button className={selected ? 'checkout-choice selected' : 'checkout-choice'} type="button" onClick={onSelect}><span className="choice-radio">{selected && <FaIcon name="check" />}</span><span className="choice-icon"><FaIcon name={icon} /></span><span><b>{title}</b><small>{detail}</small></span></button>
}

export default function CheckoutPage({ cartItems, cartCount, onOrderPlaced }) {
  const [delivery, setDelivery] = useState('standard')
  const [payment, setPayment] = useState('cod')
  const [coupon, setCoupon] = useState('')
  const [couponApplied, setCouponApplied] = useState(false)
  const [message, setMessage] = useState('')
  const subtotal = cartItems.reduce((sum, item) => sum + priceOf(item), 0)
  const discount = Math.round(subtotal * 0.2)
  const shipping = delivery === 'express' ? 250 : 0
  const total = subtotal - discount + shipping

  function placeOrder(event) {
    event.preventDefault()
    setMessage('Your order has been placed successfully.')
    onOrderPlaced('Order placed successfully')
  }

  return <><Header cartCount={cartCount} /><main className="checkout-page container"><div className="checkout-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><span>›</span><button type="button" onClick={() => navigate('/cart')}>Cart</button><span>›</span>Checkout</div><div className="checkout-heading"><div><h1>Checkout</h1><p>Complete your order by providing your details and choosing a payment method.</p></div><div className="checkout-secure"><FaIcon name="shield-halved" /><span><b>Secure checkout</b><small>256-bit encrypted</small></span></div></div><div className="checkout-progress"><span className="active"><b>1</b> Shipping</span><i /> <span><b>2</b> Payment</span><i /> <span><b>3</b> Review</span><i /> <span><b>4</b> Place Order</span></div><div className="checkout-layout"><form className="checkout-form" onSubmit={placeOrder}><section className="checkout-section"><div className="checkout-section-title"><h2><b>1</b> Shipping Information</h2><small>Returning customer? <button type="button">Login</button></small></div><div className="checkout-fields"><Field label="Full Name" required><input required defaultValue="Awais Ahmed" /></Field><Field label="Phone Number" required><input required defaultValue="+92 300 1234567" /></Field><Field label="Email Address" required><input required type="email" defaultValue="awaisahmed@example.com" /></Field><Field label="Shipping Address" required><input required defaultValue="Pakistan" /></Field><Field label="Street Address" required><input required defaultValue="House # 123, Street 45, Block A" /></Field><Field label="City" required><input required defaultValue="Lahore" /></Field><Field label="State / Province" required><select required defaultValue="Punjab"><option>Punjab</option><option>Sindh</option><option>Khyber Pakhtunkhwa</option><option>Balochistan</option></select></Field><Field label="Postal Code" required><input required defaultValue="54000" /></Field></div><label className="checkout-checkbox"><input type="checkbox" /> Save this address for next time</label></section><section className="checkout-section"><div className="checkout-section-title"><h2><b>2</b> Shipping Method</h2></div><div className="checkout-choices"><Choice title="Standard Delivery" detail="Delivery in 3-5 working days" icon="truck-fast" selected={delivery === 'standard'} onSelect={() => setDelivery('standard')} /><strong className="choice-price free">FREE</strong><Choice title="Express Delivery" detail="Delivery in 1-2 working days" icon="truck-fast" selected={delivery === 'express'} onSelect={() => setDelivery('express')} /><strong className="choice-price">Rs. 250</strong></div></section><section className="checkout-coupon"><div className="coupon-icon"><FaIcon name="tag" /></div><div><b>Have a coupon?</b><small>Enter your coupon code to get discount</small></div><input value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="Enter coupon code" aria-label="Coupon code" /><button type="button" onClick={() => setCouponApplied(Boolean(coupon.trim()))}>Apply</button>{couponApplied && <span className="coupon-success"><FaIcon name="check" /> Applied</span>}</section><section className="checkout-section"><div className="checkout-section-title"><h2><b>3</b> Payment Method</h2></div><div className="checkout-choices payment-choices"><Choice title="Cash on Delivery (COD)" detail="Pay when you receive your order" icon="money-bill" selected={payment === 'cod'} onSelect={() => setPayment('cod')} /><Choice title="Online Payment" detail="Pay securely using card, wallet or net banking" icon="credit-card" selected={payment === 'online'} onSelect={() => setPayment('online')} /><Choice title="Bank Transfer" detail="Make payment directly to our bank account" icon="building-columns" selected={payment === 'bank'} onSelect={() => setPayment('bank')} /></div></section><section className="checkout-section checkout-notes"><div className="checkout-section-title"><h2><b>4</b> Order Notes <small>(Optional)</small></h2></div><textarea placeholder="Add any special instructions for your order..." /></section><button className="place-order-button" type="submit">Place Order <FaIcon name="lock" /></button>{message && <p className="checkout-message" role="status">{message}</p>}</form><aside className="checkout-summary"><div className="summary-heading"><h2>Order Summary</h2><b>{cartCount} items</b></div><div className="checkout-items">{cartItems.map((item) => <div className="checkout-item" key={item.id}><img src={item.image} alt={item.name} /><span><b>{item.name}</b><small>{item.type}<br />Qty: {item.quantity}</small></span><strong>{money(priceOf(item))}</strong></div>)}</div><div className="checkout-totals"><p><span>Subtotal ({cartCount} items)</span><b>{money(subtotal)}</b></p><p><span>Discount</span><b className="saving">- {money(discount)}</b></p><p><span>Shipping</span><b className="free">{shipping ? money(shipping) : 'FREE'}</b></p><p className="summary-grand-total"><span>Total (VAT incl.)</span><strong>{money(total)}</strong></p></div><div className="checkout-saving"><FaIcon name="tag" /> You are saving {money(discount)} on this order!</div><div className="checkout-benefits"><p><FaIcon name="shield-halved" /><span><b>100% Secure Payments</b><small>Your transactions are safe with us</small></span></p><p><FaIcon name="rotate-left" /><span><b>7 Days Return</b><small>Easy returns & refunds</small></span></p><p><FaIcon name="headset" /><span><b>24/7 Customer Support</b><small>We're here to help you anytime</small></span></p></div></aside></div></main><Footer /></>
}
