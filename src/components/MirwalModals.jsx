import { useState } from 'react'
import './mirwal-modals.css'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function ModalFrame({ title, children, onClose, className = '' }) {
  return <div className="mirwal-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`mirwal-modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><button className="mirwal-modal-close" type="button" onClick={onClose} aria-label="Close modal"><FaIcon name="xmark" /></button>{children}</section></div>
}

export function LoginModal({ onClose, onLogin }) {
  const [showPassword, setShowPassword] = useState(false)
  return <ModalFrame title="Welcome back" onClose={onClose} className="login-modal"><div className="modal-art modal-bag"><strong>M</strong></div><div className="modal-copy"><h2>Welcome back!</h2><p>Login to continue shopping<br />at MIRWAL</p><form onSubmit={(event) => { event.preventDefault(); onLogin() }}><label>Email or Phone<input required placeholder="Enter email or phone" /></label><label>Password<div className="modal-password"><input required type={showPassword ? 'text' : 'password'} placeholder="Enter password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><FaIcon name={showPassword ? 'eye-slash' : 'eye'} /></button></div></label><button className="modal-primary" type="submit">Login</button></form><div className="modal-divider">or continue with</div><div className="modal-social"><button type="button"><FaIcon name="google" /> Google</button><button type="button"><FaIcon name="facebook" /> Facebook</button></div><small>Don't have an account? <button type="button" onClick={onLogin}>Register</button></small></div></ModalFrame>
}

export function AddToCartModal({ product, onClose, onViewCart }) {
  return <ModalFrame title="Added to cart" onClose={onClose} className="success-cart-modal"><div className="modal-status-icon success"><FaIcon name="check" /></div><h2>Added to cart!</h2><p>{product.name} has been added<br />to your cart successfully.</p><div className="modal-product-row"><img src={product.image} alt={product.name} /><span><b>{product.name}</b><small>{product.type}</small></span><strong>{product.price}</strong></div><div className="modal-actions"><button type="button" onClick={onClose}>View Cart</button><button className="modal-primary" type="button" onClick={onViewCart}>Go to Cart</button></div></ModalFrame>
}

export function ConfirmDeleteModal({ onClose, onConfirm }) {
  return <ModalFrame title="Delete this item" onClose={onClose} className="confirm-modal"><div className="modal-status-icon danger"><FaIcon name="trash" /></div><h2>Delete this item?</h2><p>Are you sure you want to remove this item?<br />This action cannot be undone.</p><div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="modal-primary danger-button" type="button" onClick={onConfirm}>Yes, Delete</button></div></ModalFrame>
}

export function NewsletterModal({ onClose }) {
  const [submitted, setSubmitted] = useState(false)
  return <ModalFrame title="Subscribe to our newsletter" onClose={onClose} className="newsletter-modal"><div className="modal-art modal-envelope"><FaIcon name="envelope" /></div><div className="modal-copy"><h2>Subscribe to our newsletter</h2><p>Get exclusive deals, new arrivals and more<br />straight to your inbox.</p>{submitted ? <p className="modal-success-copy">You are subscribed. Watch your inbox for the next update.</p> : <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true) }}><label>Email address<input required type="email" placeholder="Enter your email address" /></label><button className="modal-primary" type="submit">Subscribe</button><small><FaIcon name="lock" /> We respect your privacy. Unsubscribe anytime.</small></form>}</div></ModalFrame>
}

export function LocationModal({ onClose }) {
  const [location, setLocation] = useState('Lahore, Pakistan')
  return <ModalFrame title="Select your location" onClose={onClose} className="location-modal"><div className="modal-status-icon"><FaIcon name="location-dot" /></div><h2>Select Your Location</h2><p>Please select your delivery location<br />to see accurate products and offers.</p><label className="modal-select"><FaIcon name="location-dot" /><select value={location} onChange={(event) => setLocation(event.target.value)}><option>Lahore, Pakistan</option><option>Karachi, Pakistan</option><option>Islamabad, Pakistan</option></select><FaIcon name="chevron-down" /></label><button className="modal-primary" type="button" onClick={onClose}>Save Location</button></ModalFrame>
}

export function SuccessModal({ orderId = '#MW12345678', onClose, onViewOrders }) {
  return <ModalFrame title="Order placed successfully" onClose={onClose} className="success-order-modal"><div className="modal-status-icon success"><FaIcon name="file-circle-check" /></div><h2>Order Placed Successfully!</h2><p>Your order has been placed. You will receive<br />an email confirmation shortly.</p><b>Order ID: <span>{orderId}</span></b><button className="modal-primary" type="button" onClick={onClose}>Continue Shopping</button><button className="modal-link" type="button" onClick={onViewOrders}>View Orders</button></ModalFrame>
}
