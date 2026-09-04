import { useEffect, useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import { useSession } from './components/useSession'
import { navigateTo } from '@mirwal/shared/navigation'
import api from './api'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { formatMinorUnits, lineSaving, lineListTotal, lineTotal } from '@mirwal/shared/money'

/**
 * Checkout previously had no backend to submit to: `placeOrder` just showed "Checkout is not
 * connected" and the four-step progress bar above the form was decorative. It also offered
 * Express Delivery (Rs. 250), Online Payment and Bank Transfer as if real, and a "Save this
 * address for next time" checkbox with nowhere to save to — none of that exists.
 *
 * Now `placeOrder` calls the real `POST /orders`, which re-prices and re-validates stock for
 * every line server-side (see server/src/modules/orders/orders.service.js) before creating
 * anything. Only what's real is offered: Cash on Delivery (the only payment method Mirwal has
 * ever supported — there is no gateway integration), and free shipping (there is no carrier
 * pricing model, so charging an invented Rs. 250 for "Express" would be fabricated, not just
 * unconnected).
 *
 * Shipping Information now also offers a real saved address (server/src/modules/addresses) —
 * the "Save this address for next time" checkbox this page always had now actually saves one.
 * The manual form only renders for "a new address," picked explicitly or because the shopper
 * has none saved yet; a selected saved address is used as-is rather than copied into editable
 * form state, which avoids syncing fetched data into state via an effect.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const money = (minor) => formatMinorUnits(minor)
const priceOf = (item) => lineTotal(item)

function Field({ label, required = false, children }) {
  return <label className="checkout-field"><span>{label}{required && <em> *</em>}</span>{children}</label>
}

const REGIONS = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Gilgit-Baltistan', 'Islamabad Capital Territory']

const PAYMENT_ICON = { cod: 'money-bill', card: 'credit-card', easypaisa: 'mobile-screen', jazzcash: 'mobile-screen' }

export default function CheckoutPage({ cartItems, cartCount, onOrderPlaced }) {
  const { user } = useSession()
  const { data: addresses } = useApiQuery((signal) => api.addresses.list(signal), [])
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [saveAddress, setSaveAddress] = useState(true)
  const [form, setForm] = useState({
    fullName: user?.fullName ?? '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postalCode: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Only methods whose gateway credentials are actually configured server-side. An
  // unconfigured provider is shown as unavailable rather than silently omitted, so the
  // absence is legible instead of looking like Mirwal simply doesn't support it.
  const { data: paymentMethods } = useApiQuery((signal) => api.payments.methods(signal), [])
  const [selectedMethod, setSelectedMethod] = useState(null)
  const availableMethods = paymentMethods?.filter((option) => option.available) ?? []
  // COD is the fallback because it is the one method that always works.
  const effectiveMethod = selectedMethod ?? 'cod'

  // Selecting "new address" is a real choice; otherwise fall back to the saved default, and
  // only fall back further to "new" once the (settled, empty) list confirms there's nothing
  // to default to — computed inline rather than synced via an effect.
  const defaultAddressId = addresses?.find((address) => address.isDefault)?.id
  const effectiveAddressId = selectedAddressId
    ?? defaultAddressId
    ?? (addresses && addresses.length === 0 ? 'new' : null)
  const usingNewAddress = effectiveAddressId === 'new'

  const subtotal = cartItems.reduce((sum, item) => sum + lineListTotal(item), 0)
  const discount = cartItems.reduce((sum, item) => sum + lineSaving(item), 0)
  const total = subtotal - discount

  const setField = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  async function placeOrder(event) {
    event.preventDefault()
    if (!cartItems.length) { setError('Your cart is empty. Add a product before checkout.'); return }

    const shippingAddress = usingNewAddress
      ? { fullName: form.fullName, phone: form.phone, line1: form.line1, line2: form.line2, city: form.city, region: form.region, postalCode: form.postalCode }
      : (() => {
        const saved = addresses.find((address) => address.id === effectiveAddressId)
        return { fullName: saved.fullName, phone: saved.phone, line1: saved.line1, line2: saved.line2, city: saved.city, region: saved.region, postalCode: saved.postalCode }
      })()

    setSubmitting(true)
    setError(null)
    try {
      if (usingNewAddress && saveAddress) {
        // Best-effort: a failed save shouldn't block placing the order itself.
        try { await api.addresses.create({ ...shippingAddress, isDefault: (addresses?.length ?? 0) === 0 }) } catch { /* not fatal */ }
      }
      const order = await api.orders.create({
        items: cartItems.map((item) => ({
          productId: item.id,
          sku: item.variantSku ?? undefined,
          quantity: item.quantity,
        })),
        shippingAddress,
        notes: form.notes,
        paymentMethod: effectiveMethod,
      })

      // The order exists either way; only the payment step differs. COD is settled on
      // delivery, so there is nothing further to do here.
      if (effectiveMethod !== 'cod') {
        const payment = await api.payments.start(order.id, effectiveMethod)
        onOrderPlaced?.()

        if (payment.kind === 'redirect_form') {
          // EasyPaisa/JazzCash hosted checkout: the browser POSTs the server-signed fields
          // to the wallet's own page. Built and submitted rather than linked because these
          // gateways require a form post, not a GET.
          const gatewayForm = document.createElement('form')
          gatewayForm.method = 'POST'
          gatewayForm.action = payment.postUrl
          for (const [name, value] of Object.entries(payment.fields)) {
            const input = document.createElement('input')
            input.type = 'hidden'
            input.name = name
            input.value = value
            gatewayForm.appendChild(input)
          }
          document.body.appendChild(gatewayForm)
          gatewayForm.submit()
          return
        }

        // Card: hand off to the dedicated payment page, which loads Stripe.js and collects
        // the card there. The client secret never lets anyone move money elsewhere.
        navigateTo(`/pay/${order.id}`, { state: { clientSecret: payment.clientSecret, publishableKey: payment.publishableKey } })
        return
      }

      onOrderPlaced?.()
      navigateTo(`/order-success/${order.id}`)
    } catch (requestError) {
      setError(describeApiError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => { document.title = 'Secure checkout | Mirwal'; let meta = document.querySelector('meta[name="robots"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'robots'; document.head.appendChild(meta) }; meta.setAttribute('content', 'noindex,nofollow') }, [])

  return <><Header cartCount={cartCount} /><main className="checkout-page container"><div className="checkout-breadcrumb"><button type="button" onClick={() => navigateTo('/')}>Home</button><span>›</span><button type="button" onClick={() => navigateTo('/cart')}>Cart</button><span>›</span>Checkout</div><div className="checkout-heading"><div><h1>Checkout</h1><p>Complete your order by providing your details and choosing a payment method.</p></div></div><div className="checkout-layout"><form className="checkout-form" onSubmit={placeOrder}><section className="checkout-section"><div className="checkout-section-title"><h2><b>1</b> Shipping Information</h2></div>{addresses?.length > 0 && <div className="checkout-choices address-choices">{addresses.map((address) => <button key={address.id} type="button" className={effectiveAddressId === address.id ? 'checkout-choice selected' : 'checkout-choice'} onClick={() => setSelectedAddressId(address.id)}><span className="choice-radio">{effectiveAddressId === address.id && <FaIcon name="check" />}</span><span className="choice-icon"><FaIcon name="location-dot" /></span><span><b>{address.fullName}{address.isDefault && ' · Default'}</b><small>{address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city}{address.region ? `, ${address.region}` : ''} · {address.phone}</small></span></button>)}<button type="button" className={usingNewAddress ? 'checkout-choice selected' : 'checkout-choice'} onClick={() => setSelectedAddressId('new')}><span className="choice-radio">{usingNewAddress && <FaIcon name="check" />}</span><span className="choice-icon"><FaIcon name="plus" /></span><span><b>Use a new address</b></span></button></div>}{usingNewAddress && <><div className="checkout-fields"><Field label="Full Name" required><input required autoComplete="name" placeholder="Your full name" value={form.fullName} onChange={setField('fullName')} /></Field><Field label="Phone Number" required><input required type="tel" autoComplete="tel" placeholder="03XX XXXXXXX" value={form.phone} onChange={setField('phone')} /></Field><Field label="Street Address" required><input required autoComplete="street-address" placeholder="House number, street, area" value={form.line1} onChange={setField('line1')} /></Field><Field label="Apartment / Area (Optional)"><input autoComplete="address-line2" placeholder="Apartment, floor, landmark" value={form.line2} onChange={setField('line2')} /></Field><Field label="City" required><input required autoComplete="address-level2" placeholder="City" value={form.city} onChange={setField('city')} /></Field><Field label="Province" required><select required autoComplete="address-level1" value={form.region} onChange={setField('region')}><option value="" disabled>Select province</option>{REGIONS.map((region) => <option key={region}>{region}</option>)}</select></Field><Field label="Postal Code"><input autoComplete="postal-code" inputMode="numeric" placeholder="Postal code" value={form.postalCode} onChange={setField('postalCode')} /></Field></div><label className="checkout-checkbox"><input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} /> Save this address for next time</label></>}</section><section className="checkout-section"><div className="checkout-section-title"><h2><b>2</b> Shipping Method</h2></div><div className="checkout-choices"><div className="checkout-choice selected"><span className="choice-radio"><FaIcon name="check" /></span><span className="choice-icon"><FaIcon name="truck-fast" /></span><span><b>Standard Delivery</b><small>Delivery in 3-5 working days — Mirwal has no carrier integration yet, so this is the only option and it's free</small></span></div><strong className="choice-price free">FREE</strong></div></section><section className="checkout-section"><div className="checkout-section-title"><h2><b>3</b> Payment Method</h2></div><div className="checkout-choices payment-choices">{availableMethods.map((option) => <button key={option.method} type="button" className={effectiveMethod === option.method ? 'checkout-choice selected' : 'checkout-choice'} onClick={() => setSelectedMethod(option.method)}><span className="choice-radio">{effectiveMethod === option.method && <FaIcon name="check" />}</span><span className="choice-icon"><FaIcon name={PAYMENT_ICON[option.method] ?? 'money-bill'} /></span><span><b>{option.label}</b><small>{option.description}</small></span></button>)}{paymentMethods?.some((option) => !option.available) && <p className="checkout-payment-note">{paymentMethods.filter((option) => !option.available).map((option) => option.label).join(', ')} {paymentMethods.filter((option) => !option.available).length > 1 ? 'are' : 'is'} not available right now.</p>}</div></section><section className="checkout-section checkout-notes"><div className="checkout-section-title"><h2><b>4</b> Order Notes <small>(Optional)</small></h2></div><textarea placeholder="Add any special instructions for your order..." value={form.notes} onChange={setField('notes')} /></section><button className="place-order-button" type="submit" disabled={submitting}>{submitting ? 'Placing order…' : <>Place Order <FaIcon name="lock" /></>}</button>{error && <p className="checkout-message" role="alert">{error}</p>}</form><aside className="checkout-summary"><div className="summary-heading"><h2>Order Summary</h2><b>{cartCount} items</b></div><div className="checkout-items">{cartItems.map((item) => <div className="checkout-item" key={item.id}><img src={item.image} alt={item.name} /><span><b>{item.name}</b><small>{item.subtitle}<br />Qty: {item.quantity}</small></span><strong>{money(priceOf(item))}</strong></div>)}</div><div className="checkout-totals"><p><span>Subtotal ({cartCount} items)</span><b>{money(subtotal)}</b></p>{discount > 0 && <p><span>Discount</span><b className="saving">- {money(discount)}</b></p>}<p><span>Shipping</span><b className="free">FREE</b></p><p className="summary-grand-total"><span>Total</span><strong>{money(total)}</strong></p></div>{discount > 0 && <div className="checkout-saving"><FaIcon name="tag" /> You are saving {money(discount)} on this order!</div>}<div className="checkout-benefits"><p><FaIcon name="shield-halved" /><span><b>Secure Checkout</b><small>Your details are only used for this order</small></span></p><p><FaIcon name="headset" /><span><b>Need help?</b><small>Contact support from the Help Center</small></span></p></div></aside></div></main><Footer /></>
}
