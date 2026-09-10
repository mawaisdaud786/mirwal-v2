import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import './order-confirmation.css'
import OrderTracking from './components/OrderTracking'
import { RETURN_REASONS, RETURN_STATUS_LABEL } from './returnReasons'
import OrderAfterSale from './components/OrderAfterSale'

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />


function ItemActions({ item, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [returnFormOpen, setReturnFormOpen] = useState(false)
  const [reason, setReason] = useState(RETURN_REASONS[0][0])
  const [description, setDescription] = useState('')
  /**
   * Cancelling asks for confirmation, not a password.
   *
   * The API briefly required the account password here. That was removed: cancelling an
   * unshipped item is the buyer's own right, it is reversible — the stock goes straight back —
   * and no marketplace asks someone to re-authenticate for it. Re-auth is reserved for actions
   * where a hijacked session does lasting damage, such as changing the payout destination.
   *
   * A confirmation step is still worth having, because the action cannot be undone from this
   * page: the item is gone from the order and would have to be bought again.
   */
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  /**
   * How many to cancel.
   *
   * A buyer who ordered three and wants one fewer used to have to void the line and re-order,
   * losing their place in the dispatch queue and any coupon that needed the original basket.
   * The picker only appears when there is more than one, so the ordinary case is unchanged.
   */
  const [quantity, setQuantity] = useState(1)
  const ordered = Number(item.quantity ?? 1)

  async function cancel() {
    setBusy(true)
    setError('')
    try {
      await api.orders.cancelItem(item.id, ordered > 1 ? { quantity } : {})
      setConfirmingCancel(false)
      onChanged()
    }
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
          {RETURN_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
      {item.canCancel && !confirmingCancel && <button type="button" onClick={() => setConfirmingCancel(true)} disabled={busy}>Cancel Item</button>}
      {item.canCancel && confirmingCancel && (
        <div className="cancel-confirm" role="group" aria-label="Confirm cancellation">
          <p>
            Cancel <b>{item.product.name}</b>? This cannot be undone — you would need to order
            {ordered > 1 ? ' them' : ' it'} again.
          </p>
          {ordered > 1 && (
            <label className="cancel-confirm-qty">
              How many of the {ordered}?
              <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} disabled={busy}>
                {Array.from({ length: ordered }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>{value === ordered ? `All ${value}` : value}</option>
                ))}
              </select>
            </label>
          )}
          <div className="cancel-confirm-actions">
            <button type="button" className="cancel-confirm-yes" onClick={cancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Yes, cancel it'}
            </button>
            <button type="button" onClick={() => setConfirmingCancel(false)} disabled={busy}>Keep it</button>
          </div>
        </div>
      )}
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
      : `Payment of ${order.total.display} hasn't been confirmed yet. If you've just paid, this updates as soon as your bank or wallet confirms it.`}</p><strong>{order.orderNumber}</strong><div className="order-confirmed-summary"><h2>Order summary</h2>{order.items.map((item) => <div key={item.id}><img src={item.image} alt={item.product.name} /><span><b>{item.product.name}</b><small>Sold by {item.seller?.name ?? 'Mirwal'} · Qty {item.quantity} · {item.status}</small><ItemActions item={item} onChanged={refetch} /></span><b>{item.lineTotal.display}</b></div>)}<div><span><b>Subtotal</b></span><b>{order.subtotal.display}</b></div><div><span><b>Shipping</b></span><b>{order.shippingFee.display}</b></div><div><span><b>Total</b></span><b>{order.total.display}</b></div><div><span><b>Shipping to</b><small>{order.shippingAddress.fullName} · {order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}{order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ''} · {order.shippingAddress.phone}</small></span></div></div><OrderTracking orderId={order.id} /><OrderAfterSale order={order} /><div className="order-confirmed-actions"><a href="/orders">View my orders</a><a href="/explore">Continue shopping</a></div></section></div></main><Footer /></>
}
