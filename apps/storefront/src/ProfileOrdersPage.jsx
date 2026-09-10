import Header from './components/Header'
import { AccountSidebar } from './AccountUtilityPage'
import { useState } from 'react'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import './ai-assistant.css'
import { navigateTo } from '@mirwal/shared/navigation'
import OrderTracking from './components/OrderTracking'
import { RETURN_REASONS } from './returnReasons'

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
  const [filter, setFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const visibleOrders = (orders ?? []).filter((order) => filter === 'all' || rollupStatus(order.items) === filter)
  const [actionError, setActionError] = useState('')
  const [busyItem, setBusyItem] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  // The item a return is being filed against, and the reason chosen for it.
  const [returnTarget, setReturnTarget] = useState(null)
  const [returnReason, setReturnReason] = useState('damaged')
  /**
   * Cancel an item.
   *
   * Called with no second argument from the row buttons, which opens the confirmation; the
   * modal then calls it again to actually cancel. The password parameter this used to carry is
   * gone — the API no longer accepts one, and re-authenticating to cancel your own unshipped
   * item is friction with nothing behind it.
   */
  async function cancelItem(item, confirmed) {
    if (!confirmed) { setCancelTarget(item); return }
    setBusyItem(item.id)
    setActionError('')
    try {
      await api.orders.cancelItem(item.id)
      await refetch()
      setSelectedOrder(null)
      setCancelTarget(null)
    } catch (error) {
      setActionError(describeApiError(error))
    } finally {
      setBusyItem(null)
    }
  }
  /**
   * Filing a return from the orders list.
   *
   * This used to send "No longer needed" for every return anyone ever filed, whatever their
   * actual reason — the button asked nothing. The reason decides who pays return carriage and
   * whether the store's return rate counts against it, so it is now asked for, and the buyer
   * follows the return on its own page rather than watching a single word beside a line.
   */
  async function requestReturn(item, reason) {
    setBusyItem(item.id)
    setActionError('')
    try {
      await api.orders.requestReturn(item.id, { reason })
      setReturnTarget(null)
      await refetch()
      navigateTo('/my-returns')
    } catch (error) { setActionError(describeApiError(error)) } finally { setBusyItem(null) }
  }

  return (
    <div className="orders-content">
      <header className="orders-heading">
        <div><h1>My Orders</h1><p>View and manage all your orders in one place.</p></div>
        <div className="orders-reassurance"><FaIcon name="shield-halved" /><span><b>Shopping with confidence</b><small>Secure payments and easy returns</small></span></div>
      </header>
      {!isLoading && !error && orders?.length > 0 && <nav className="orders-status-tabs" aria-label="Order filters">{[['all', 'All Orders'], ['pending', 'Pending'], ['processing', 'Processing'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']].map(([key, label]) => <button type="button" className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>{label} ({key === 'all' ? orders.length : orders.filter((order) => rollupStatus(order.items) === key).length})</button>)}</nav>}

      <PendingReviews />
      {actionError && <p className="address-error" role="alert">{actionError}</p>}

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
          {visibleOrders.map((order) => {
            const status = rollupStatus(order.items)
            return (
              <div className={`order-row${selectedOrder?.id === order.id ? ' is-selected' : ''}`} key={order.id} onClick={() => setSelectedOrder(order)}>
                <div className="order-id"><b>{order.orderNumber}</b><span>{new Date(order.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <div className="order-items">
                  {order.items.slice(0, 3).map((item) => <img key={item.id} src={item.image} alt={item.product.name} />)}
                  {order.items.length > 3 && <em>+{order.items.length - 3}</em>}
                </div>
                <div className="order-summary"><b>{order.items[0].product.name}</b><small>{order.items.length > 1 ? `+${order.items.length - 1} more item${order.items.length > 2 ? 's' : ''}` : 'Qty: ' + order.items[0].quantity}</small></div>
                <div className="order-total"><b>{order.total.display}</b><small>{order.paymentMethod === 'cod' ? 'Cash on Delivery' : order.paymentMethod}</small></div>
                <div className="order-status"><em className={status}>{STATUS_LABEL[status]}</em></div>
                <div className="order-actions">{order.items.some((item) => item.canCancel) && <button type="button" onClick={() => setCancelTarget(order.items.find((item) => item.canCancel))} disabled={!!busyItem}>Cancel</button>}{order.items.some((item) => item.canRequestReturn) && <button type="button" onClick={() => setReturnTarget(order.items.find((item) => item.canRequestReturn))} disabled={!!busyItem}>Return &amp; Refund</button>}<button type="button" onClick={() => navigateTo(`/order-success/${order.id}`)}>View Details</button></div>
              </div>
            )
          })}
        </section>
      ))}
      {selectedOrder && <aside className="order-details-drawer"><button className="order-drawer-close" type="button" aria-label="Close order details" onClick={() => setSelectedOrder(null)}><FaIcon name="xmark" /></button><h2>Order {selectedOrder.orderNumber}</h2><small>Placed {new Date(selectedOrder.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-PK')}</small><div className="order-drawer-items">{selectedOrder.items.map((item) => <div key={item.id}><img src={item.image} alt={item.product.name} /><span><b>{item.product.name}</b><small>{item.quantity} × {item.price?.display ?? ''}</small><em>{item.canCancel ? 'Cancellation available' : item.canRequestReturn ? 'Return eligible' : item.status}</em></span>{item.canCancel && <button type="button" onClick={() => cancelItem(item)}>Cancel</button>}{item.canRequestReturn && <button type="button" onClick={() => setReturnTarget(item)}>Return</button>}</div>)}</div>{/* Was five hard-coded steps with "done" inferred from the order's rollup status — so
    "Packed" and "Out for Delivery" were never reached whatever actually happened, and the
    whole strip was decoration. Real shipment data replaces it, and renders nothing at all
    when there is no shipment yet rather than showing an empty promise. */}
<OrderTracking orderId={selectedOrder.id} /><div className="order-drawer-actions"><button type="button" onClick={() => navigateTo('/track-orders')}><FaIcon name="truck" /> Track Package</button><button type="button" onClick={() => navigateTo('/help-center')}><FaIcon name="headset" /> Contact Support</button><button type="button" onClick={() => navigateTo(`/order-success/${selectedOrder.id}`)}><FaIcon name="file-invoice" /> View Invoice</button></div><section className="order-drawer-info"><h3><FaIcon name="location-dot" /> Shipping Information</h3><p>{selectedOrder.shippingAddress?.fullName}<br />{selectedOrder.shippingAddress?.line1}<br />{selectedOrder.shippingAddress?.city}{selectedOrder.shippingAddress?.region ? `, ${selectedOrder.shippingAddress.region}` : ''}</p><h3><FaIcon name="credit-card" /> Payment Information <strong>{selectedOrder.total.display}</strong></h3><p>{selectedOrder.paymentMethod === 'cod' ? 'Cash on Delivery' : selectedOrder.paymentMethod}</p></section></aside>}
      {/* No password here.
    Cancelling an unshipped item is the buyer's own right, it is reversible — the stock goes
    straight back — and the API stopped accepting a password for it. Re-authentication is
    reserved for actions where a hijacked session does lasting damage, such as changing a
    payout destination. Confirmation is still warranted: this cannot be undone from here. */}
{returnTarget && <div className="cancel-modal-backdrop"><form className="cancel-modal" onSubmit={(event) => { event.preventDefault(); requestReturn(returnTarget, returnReason) }}><button type="button" className="order-drawer-close" onClick={() => setReturnTarget(null)}><FaIcon name="xmark" /></button><div className="cancel-modal-icon"><FaIcon name="rotate-left" /></div><h2>Return this item?</h2><p>Why are you returning <b>{returnTarget.product?.name}</b>?</p>{/* The reason decides who pays return postage — a fault is the seller's, a change of mind is yours — so it is asked rather than assumed. */}<select value={returnReason} onChange={(event) => setReturnReason(event.target.value)} aria-label="Reason for return">{RETURN_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div><button type="button" onClick={() => setReturnTarget(null)}>Never mind</button><button type="submit" disabled={!!busyItem}>{busyItem ? 'Filing…' : 'File the return'}</button></div>{actionError && <small>{actionError}</small>}</form></div>}

{cancelTarget && <div className="cancel-modal-backdrop"><form className="cancel-modal" onSubmit={(event) => { event.preventDefault(); cancelItem(cancelTarget, true) }}><button type="button" className="order-drawer-close" onClick={() => setCancelTarget(null)}><FaIcon name="xmark" /></button><div className="cancel-modal-icon"><FaIcon name="triangle-exclamation" /></div><h2>Cancel this item?</h2><p>Cancel <b>{cancelTarget.product?.name}</b>? This cannot be undone &mdash; you would need to order it again.</p><div><button type="button" onClick={() => setCancelTarget(null)}>Keep it</button><button type="submit" disabled={!!busyItem}>{busyItem ? 'Cancelling…' : 'Yes, cancel it'}</button></div>{actionError && <small>{actionError}</small>}</form></div>}
    </div>
  )
}

export default function ProfileOrdersPage({ cartCount }) {
  return <div className="assistant-page"><Header cartCount={cartCount} /><main className="orders-page container"><div className="profile-breadcrumb"><button type="button" onClick={() => navigateTo('/')}>Home</button><FaIcon name="chevron-right" /><button type="button" onClick={() => navigateTo('/profile')}>My Account</button><FaIcon name="chevron-right" /><b>Orders</b></div><div className="profile-layout"><AccountSidebar active="Orders" /><OrdersContent /></div></main></div>
}
