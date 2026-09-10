import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import Header from './components/Header'
import Footer from './components/Footer'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import { navigateTo } from '@mirwal/shared/navigation'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

/**
 * Card payment page.
 *
 * Mirwal never sees the card. Stripe.js is loaded from Stripe's own CDN (a PCI requirement —
 * it cannot be bundled) and the PaymentElement collects the card directly into Stripe, so no
 * card number, CVV or expiry ever reaches Mirwal's frontend state or its server.
 *
 * `confirmPayment` here only reports what the browser saw. The order is marked paid by the
 * verified `payment_intent.succeeded` webhook, which is why the success screen re-reads the
 * real payment status from Mirwal's own API rather than trusting the redirect it arrived on.
 */

function CardForm({ orderId, onPaid }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setError('')
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/order-success/${orderId}` },
      // Keeps the shopper here unless the card genuinely needs an off-site 3-D Secure step.
      redirect: 'if_required',
    })

    if (stripeError) {
      setError(stripeError.message ?? 'That payment could not be completed.')
      setSubmitting(false)
      return
    }
    onPaid()
  }

  return (
    <form onSubmit={submit}>
      <div className="pay-element"><PaymentElement /></div>
      <button className="pay-submit" type="submit" disabled={!stripe || submitting}>
        {submitting ? 'Processing…' : 'Pay now'}
      </button>
      {error && <p className="pay-error" role="alert">{error}</p>}
      <p className="pay-secure"><FaIcon name="lock" /> Card details go straight to Stripe — Mirwal never sees or stores them.</p>
    </form>
  )
}

export default function PayPage({ cartCount }) {
  const { orderId } = useParams()
  const location = useLocation()
  const { clientSecret, publishableKey } = location.state ?? {}

  const { data: order, error, isLoading } = useApiQuery((signal) => api.orders.get(orderId, signal), [orderId])
  const [paid, setPaid] = useState(false)

  // loadStripe returns a promise that must be created once, not per render.
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey])

  useEffect(() => {
    document.title = 'Complete payment | Mirwal'
    let robots = document.querySelector('meta[name="robots"]')
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots) }
    robots.setAttribute('content', 'noindex,nofollow')
  }, [])

  useEffect(() => {
    if (paid) navigateTo(`/order-success/${orderId}`)
  }, [paid, orderId])

  const shell = (children) => <><Header cartCount={cartCount} /><main className="pay-page"><div className="pay-card">{children}</div></main><Footer /></>

  if (isLoading) return shell(<p>Loading your order…</p>)
  if (error) return shell(<><h1>We couldn't load this order</h1><p>{describeApiError(error)}</p></>)

  // Arriving here without a client secret means the payment was never actually started (a
  // direct visit, or a reload that dropped router state) — say so plainly rather than
  // rendering a card form that cannot work.
  if (!clientSecret || !stripePromise) {
    return shell(
      <>
        <h1>Payment session expired</h1>
        <p>This payment needs to be started again from your order.</p>
        <button className="pay-submit" type="button" onClick={() => navigateTo(`/order-success/${orderId}`)}>Back to order</button>
      </>,
    )
  }

  return shell(
    <>
      <h1>Complete your payment</h1>
      <p>Order {order.orderNumber}</p>
      <div className="pay-amount"><span>Amount due</span><strong>{order.total.display}</strong></div>
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <CardForm orderId={orderId} onPaid={() => setPaid(true)} />
      </Elements>
    </>,
  )
}
