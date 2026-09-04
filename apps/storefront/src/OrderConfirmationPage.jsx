import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import './order-confirmation.css'

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const RETURN_REASONS = ['Wrong item received', 'Item damaged or defective', 'Item not as described', 'No longer needed', 'Other']
const RETURN_STATUS_LABEL = { requested: 'Return requested', approved: 'Return approved', rejected: 'Return rejected' }

function ItemActions({ item, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [returnFormOpen, setReturnFormOpen] = useState(false)
  const [reason, setReason] = useState(RETURN_REASONS[0])
  const [description, setDescription] = useState('')

  async function cancel() {
    setBusy(true)
    setError('')
    try { await api.orders.cancelItem(item.id); onChanged() }
    catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  async function submitReturn(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await api.orders.requestReturn(item.id, { reason, description }); setReturnFormOpen(false); onChanged() }
    catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  if (item.returnRequest) {
    return <small className={`order-item-return-status ${item.returnRequest.status}`}>{RETURN_STATUS_LABEL[item.returnRequest.status] ?? item.returnRequest.status}</small>
  }

  if (returnFormOpen) {
    return (
      <form className="order-item-return-form" onSubmit={submitReturn}>
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          {RETURN_REASONS.map((option) => <option key={option}>{option}</option>)}
        </select>
        <textarea placeholder="Tell us more (optional)" value={description} onChange={(event) => setDescription(event.target.value)} />
        <div>
          <button type="button" onClick={() => setReturnFormOpen(false)} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit Return Request'}</button>
        </div>
        {error && <small className="order-item-action-error">{error}</small>}
      </form>
    )
  }

  return (
    <span className="order-item-actions">
      {item.canCancel && <button type="button" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel Item'}</button>}
      {item.canRequestReturn && <button type="button" onClick={() => setReturnFormOpen(true)}>Request Return</button>}
      {error && <small className="order-item-action-error">{error}</small>}
    </span>
  )
}

/**
 * Previously this page never had a real order to confirm, so it always showed an honest
 * "unavailable" message — the .order-confirmed/.order-confirmed-summary CSS below was already
 * written for a real confirmation but had nothing to render it for. Now checkout creates a
 * real order and routes here with its id, so this fetches that order via `GET /orders/:id`
 * and shows what was actually placed. The unavailable state is kept as a real fallback: it now
 * covers a stale/invalid id or an order that belongs to a different account, not "there is no
 * backend."
 *
 * Also doubles as the order-detail page linked from `/orders`, which is why each item now
 * offers a real Cancel or Request Return action (server/src/modules/orders): cancelling is the
 * buyer's own right before anything ships, a return needs the seller's review and is only
 * possible after delivery — `item.canCancel`/`item.canRequestReturn` reflect exactly what the
 * server will actually allow, computed the same way server-side.
 */
export default function OrderConfirmationPage({ cartCount }) {
  const { orderId } = useParams()
  const { data: order, error, isLoading, refetch } = useApiQuery((signal) => api.orders.get(orderId, signal), [orderId])

  useEffect(() => {
    document.title = order ? `Order ${order.orderNumber} confirmed | Mirwal` : 'Order confirmation | Mirwal'
    let robots = document.querySelector('meta[name="robots"]')
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots) }
    robots.setAttribute('content', 'noindex,nofollow')
  }, [order])

  const breadcrumb = <nav aria-label="Breadcrumb"><a href="/">Home</a><Icon name="chevron-right" /><span aria-current="page">Order confirmation</span></nav>

  if (isLoading) {
    return <><Header cartCount={cartCount} /><main className="order-confirmation-page"><div className="order-confirmation-container">{breadcrumb}<p>Loading your order…</p></div></main><Footer /></>
  }

  if (error || !order) {
    return <><Header cartCount={cartCount} /><main className="order-confirmation-page"><div className="order-confirmation-container">{breadcrumb}<section className="order-unavailable"><Icon name="lock" /><h1>Order confirmation unavailable</h1><p>{error ? describeApiError(error) : 'No matching order was found for this link.'}</p><a href="/orders">Go to orders</a><a href="/help-center">Contact support</a></section></div></main><Footer /></>
  }

  return <><Header cartCount={cartCount} /><main className="order-confirmation-page"><div className="order-confirmation-container">{breadcrumb}<section className="order-confirmed"><div className="order-confirmed-icon"><Icon name="check" /></div><span>ORDER PLACED</span><h1>Thank you, your order is confirmed</h1><p>{order.paymentMethod === 'cod'
    ? `You'll pay ${order.total.display} in cash when it's delivered. Track its progress from your orders page.`
    : order.paymentStatus === 'paid'
      ? `Payment of ${order.total.display} received. Track its progress from your orders page.`
      : `Payment of ${order.total.display} hasn't been confirmed yet. If you've just paid, this updates as soon as your bank or wallet confirms it.`}</p><strong>{order.orderNumber}</strong><div className="order-confirmed-summary"><h2>Order summary</h2>{order.items.map((item) => <div key={item.id}><img src={item.image} alt={item.product.name} /><span><b>{item.product.name}</b><small>Sold by {item.seller?.name ?? 'Mirwal'} · Qty {item.quantity} · {item.status}</small><ItemActions item={item} onChanged={refetch} /></span><b>{item.lineTotal.display}</b></div>)}<div><span><b>Subtotal</b></span><b>{order.subtotal.display}</b></div><div><span><b>Shipping</b></span><b>{order.shippingFee.display}</b></div><div><span><b>Total</b></span><b>{order.total.display}</b></div><div><span><b>Shipping to</b><small>{order.shippingAddress.fullName} · {order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}{order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ''} · {order.shippingAddress.phone}</small></span></div></div><div className="order-confirmed-actions"><a href="/orders">View my orders</a><a href="/explore">Continue shopping</a></div></section></div></main><Footer /></>
}
