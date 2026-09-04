import Header from './components/Header'
import { AccountSidebar } from './AccountUtilityPage'
import { useState } from 'react'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import './ai-assistant.css'
import { navigateTo } from '@mirwal/shared/navigation'

/**
 * Order history. Checkout now creates real orders (see CheckoutPage.jsx / the
 * server/src/modules/orders module), so this fetches them via `GET /orders` instead of
 * showing the honest not-connected state it used to. A shopper who genuinely has no orders
 * yet still sees an honest empty state — never fabricated rows.
 *
 * `.order-row`/`.order-id`/`.order-status` etc. in ai-assistant.css were already built for a
 * real order list before this page was collapsed to "not connected" — reused as-is.
 *
 * An order's overall status is a rollup of its items, because a multi-seller order ships
 * per seller: "Delivered" only once every item is, "Cancelled" only if every item is, and
 * "Shipped" if any item has gone out, otherwise "Processing".
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function rollupStatus(items) {
  if (items.every((item) => item.status === 'delivered')) return 'delivered'
  if (items.every((item) => item.status === 'cancelled')) return 'cancelled'
  if (items.some((item) => item.status === 'shipped')) return 'shipped'
  return 'processing'
}

const STATUS_LABEL = { delivered: 'Delivered', cancelled: 'Cancelled', shipped: 'Shipped', processing: 'Processing' }


/**
 * "Leave a review" for delivered items the shopper has not reviewed yet.
 *
 * This is the write half of the reviews system (server/src/modules/reviews). It only ever
 * lists items the server says are reviewable — delivered, belonging to this buyer, not yet
 * reviewed — so the form can never be shown for a purchase that would be rejected.
 */
function PendingReviews() {
  const { data, isLoading, refetch } = useApiQuery((signal) => api.reviews.pending(signal), [])
  const [openFor, setOpenFor] = useState(null)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const items = data?.items ?? []
  if (isLoading || items.length === 0) return null

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await api.reviews.create({ orderItemId: openFor.orderItemId, rating, body })
      setOpenFor(null); setBody(''); setRating(5)
      refetch()
    } catch (submitError) {
      setError(describeApiError(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="pending-reviews">
      <h2><FaIcon name="star" /> Review your purchases</h2>
      <p>You have {items.length} delivered {items.length === 1 ? 'item' : 'items'} you haven't reviewed yet.</p>
      <ul>
        {items.map((item) => (
          <li key={item.orderItemId}>
            <span><b>{item.productName}</b><small>{item.orderNumber}</small></span>
            <button type="button" onClick={() => { setOpenFor(item); setError('') }}>Write a review</button>
          </li>
        ))}
      </ul>

      {openFor && (
        <div className="review-modal-overlay" role="presentation" onClick={() => setOpenFor(null)}>
          <form className="review-modal" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
            <h3>Review {openFor.productName}</h3>
            <fieldset className="review-rating-picker">
              <legend>Your rating</legend>
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} type="button" className={star <= rating ? 'is-on' : ''} onClick={() => setRating(star)} aria-label={`${star} star${star === 1 ? '' : 's'}`} aria-pressed={star === rating}>
                  <FaIcon name="star" />
                </button>
              ))}
            </fieldset>
            <label>
              Your review
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} minLength={10} required placeholder="What did you think of it? Anything a future buyer should know?" />
            </label>
            {error && <p className="review-modal-error">{error}</p>}
            <div className="review-modal-actions">
              <button type="button" onClick={() => setOpenFor(null)}>Cancel</button>
              <button type="submit" disabled={saving || body.trim().length < 10}>{saving ? 'Posting…' : 'Post review'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

export function OrdersContent() {
  const { data: orders, error, isLoading, refetch } = useApiQuery((signal) => api.orders.list(signal), [])

  return (
    <div className="orders-content">
      <header className="orders-heading">
        <div><h1>My Orders</h1><p>View and manage all your orders in one place.</p></div>
      </header>

      <PendingReviews />

      {isLoading && <section className="orders-panel tracking-empty"><div><FaIcon name="spinner" /></div><h2>Loading your orders…</h2></section>}

      {error && !isLoading && (
        <section className="orders-panel tracking-empty">
          <div><FaIcon name="triangle-exclamation" /></div>
          <h2>Couldn't load your orders</h2>
          <p>{describeApiError(error)}</p>
          <button type="button" onClick={refetch}>Try again</button>
        </section>
      )}

      {!isLoading && !error && (orders.length === 0 ? (
        <section className="orders-panel tracking-empty">
          <div><FaIcon name="box" /></div>
          <h2>You haven't placed any orders yet</h2>
          <p>Once you check out, your orders will show up here.</p>
          <button type="button" onClick={() => navigateTo('/explore')}>Start Shopping</button>
        </section>
      ) : (
        <section className="orders-panel">
          {orders.map((order) => {
            const status = rollupStatus(order.items)
            return (
              <div className="order-row" key={order.id}>
                <div className="order-id"><b>{order.orderNumber}</b><span>{new Date(order.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <div className="order-items">
                  {order.items.slice(0, 3).map((item) => <img key={item.id} src={item.image} alt={item.product.name} />)}
                  {order.items.length > 3 && <em>+{order.items.length - 3}</em>}
                </div>
                <div className="order-summary"><b>{order.items[0].product.name}</b><small>{order.items.length > 1 ? `+${order.items.length - 1} more item${order.items.length > 2 ? 's' : ''}` : 'Qty: ' + order.items[0].quantity}</small></div>
                <div className="order-total"><b>{order.total.display}</b><small>{order.paymentMethod === 'cod' ? 'Cash on Delivery' : order.paymentMethod}</small></div>
                <div className="order-status"><em className={status}>{STATUS_LABEL[status]}</em></div>
                <div className="order-actions"><button type="button" onClick={() => navigateTo(`/order-success/${order.id}`)}>View Details</button></div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

export default function ProfileOrdersPage({ cartCount }) {
  return <div className="assistant-page"><Header cartCount={cartCount} /><main className="orders-page container"><div className="profile-breadcrumb"><button type="button" onClick={() => navigateTo('/')}>Home</button><FaIcon name="chevron-right" /><button type="button" onClick={() => navigateTo('/profile')}>My Account</button><FaIcon name="chevron-right" /><b>Orders</b></div><div className="profile-layout"><AccountSidebar active="Orders" /><OrdersContent /></div></main></div>
}
