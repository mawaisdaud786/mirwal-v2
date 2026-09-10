import { useState } from 'react'
import { Link } from 'react-router-dom'
import Header from './components/Header'
import { useComparison } from './components/useComparison'
import { useSession } from './components/useSession'
import { VerificationPanel } from '@mirwal/shared/VerificationPanel'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import './ai-assistant.css'
import { navigateTo } from '@mirwal/shared/navigation'

/**
 * Account utility pages (track orders, compare, addresses, payments, notifications, security,
 * logout).
 *
 * Track Orders, Addresses, Payments and Notifications were fully simulated: a specific fake
 * person's name, phone number and Lahore address; fake card numbers ("Visa ending in 4242",
 * "EasyPaisa 0333 1234567"); a fake order-tracking flow where typing an order ID containing the
 * substring "10482" or "10461" produced a fabricated shipment timeline with a real-looking
 * courier name and delivery address. None of this was backed by anything, and displaying it as
 * though it were the signed-in user's real data is exactly the fabricated-PII case the Mirwal
 * directive forbids. Every one of them is backed by a real endpoint now.
 *
 * Addresses is real (server/src/modules/addresses) — a genuine saved-address book, CRUD plus a
 * single enforced default, entirely separate from `orders.shipping_*`, which stays an immutable
 * per-order snapshot.
 *
 * Track Orders now shows the buyer's own real per-item order status. It deliberately shows no
 * courier, no map and no arrival estimate: Mirwal integrates with no courier's tracking, so all
 * three would be invented — which is precisely what was here before.
 *
 * Payment Methods lists what can be used at checkout rather than pretending to a wallet.
 * Mirwal stores no card, so there is nothing to save; availability comes from the server's own
 * view of which provider credentials exist.
 *
 * Security is real: password change (which ends every other session), TOTP two-factor with
 * single-use recovery codes, and the live session list.
 *
 * Compare had its own, entirely separate implementation from `/compare` (`ComparePage.jsx` +
 * `useComparison()`): it always showed the same 3 hard-coded mock products regardless of what
 * was actually selected, next to a spec-comparison table (display/processor/RAM/battery/camera)
 * for fields that don't exist anywhere in the product schema. It now reads the real shared
 * comparison context, so it agrees with `/compare` instead of contradicting it.
 *
 * Logout previously only called `navigate('/login')` — it never invalidated anything, real or
 * otherwise. It now calls the real `api.auth.logout()` first.
 */

const FaIcon = ({ name, className = '' }) => <i className={`fa-solid fa-${name} ${className}`.trim()} aria-hidden="true" />
const configs = {
  '/track-orders': ['truck', 'Track Your Order', 'Enter your order ID or tracking number to see the latest delivery status.'],
  '/compare': ['scale-balanced', 'Compare Products', 'Compare products side by side and choose with confidence.'],
  '/addresses': ['location-dot', 'My Addresses', 'Manage your saved delivery addresses.'],
  '/payment-methods': ['credit-card', 'My Payment Methods', 'Manage your saved cards and payment options.'],
  '/notifications': ['bell', 'Notifications', 'Stay up to date with your orders and smart shopping alerts.'],
  '/security': ['shield-halved', 'Security Settings', 'Keep your Mirwal account protected.'],
  '/logout': ['right-from-bracket', 'Logout', ''],
}

function navigate(path) { navigateTo(path) }

export function AccountSidebar({ active }) {
  const { products: compared } = useComparison()
  const links = [
    ['user', 'Profile', '/profile', 'profile'],
    ['box', 'Orders', '/orders', 'orders'],
    // Sits next to Orders because that is where a buyer goes looking for it. Before this
    // there was nowhere to see a return once it had been filed.
    ['rotate-left', 'Returns', '/my-returns', 'orders'],
    ['truck', 'Track Orders', '/track-orders', 'track'],
    ['heart', 'Wishlist', '/wishlist', 'wishlist'],
    ['clock-rotate-left', 'Compare History', '/compare-history', 'compare'],
    ['location-dot', 'Addresses', '/addresses', 'addresses'],
    ['credit-card', 'Payment Methods', '/payment-methods', 'payments'],
    ['bell', 'Notifications', '/notifications', 'notifications'],
    ['shield-halved', 'Security', '/security', 'security'],
  ]
  return <aside className="profile-sidebar"><b className="profile-sidebar-title">MY ACCOUNT</b>{links.map(([icon, label, path, tone]) => <button className={label === active ? 'active' : ''} type="button" key={label} data-tone={tone} onClick={() => navigate(path)}><FaIcon name={icon} className="profile-sidebar-icon" /> {label}{label === 'Compare' && compared.length > 0 && <i className="profile-count">{compared.length}</i>}</button>)}<button className="profile-logout" type="button" onClick={() => navigate('/logout')}><FaIcon name="right-from-bracket" className="profile-sidebar-icon" /> Logout</button></aside>
}

function NotConnected({ icon, title, description }) {
  return <section className="utility-card tracking-empty">
    <div><FaIcon name={icon} /></div>
    <h2>{title}</h2>
    <p>{description}</p>
    <button type="button" onClick={() => navigate('/explore')}>Explore products</button>
  </section>
}

/**
 * The stages an order line moves through, in order.
 *
 * `pending` is included even though it is only the moment between checkout and the seller
 * acknowledging the order: leaving it out made a just-placed order render with no stage
 * reached at all, which reads as "nothing has happened" rather than "placed, awaiting the
 * seller". Cancelled is absent because a cancelled item leaves the track entirely and is
 * filtered out before this is used.
 */
const TRACK_STAGES = [
  ['pending', 'Placed', 'receipt'],
  ['confirmed', 'Confirmed', 'circle-check'],
  ['processing', 'Being prepared', 'box'],
  ['shipped', 'On its way', 'truck'],
  ['delivered', 'Delivered', 'house'],
]

/**
 * Track a delivery.
 *
 * This replaces a fabricated flow where typing an order id containing "10482" produced an
 * invented courier, timeline and delivery address. What is shown now is the real per-item
 * status from the buyer's own orders.
 *
 * Deliberately not shown: a courier name, a live GPS position or a delivery estimate. Mirwal
 * does not integrate with any courier's tracking, so all three would be invented — which is
 * exactly what was here before.
 */
function TrackOrders() {
  const { user } = useSession()
  const { data: orders, error, isLoading } = useApiQuery((signal) => api.orders.list(signal), [], { enabled: !!user })

  if (!user) {
    return <NotConnected icon="truck" title="Sign in to track a delivery" description="Your orders are tied to your Mirwal account, so we can show you exactly where each item is." />
  }
  if (isLoading) return <section className="utility-card"><p>Loading your orders…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load your orders" description={describeApiError(error)} />

  // Only orders with something still moving. A delivered order belongs in Orders, not here.
  const live = (orders ?? [])
    .map((order) => ({ ...order, items: order.items.filter((item) => item.status !== 'cancelled' && item.status !== 'delivered') }))
    .filter((order) => order.items.length > 0)

  if (live.length === 0) {
    return <NotConnected icon="truck" title="Nothing on its way" description="Every item you have ordered has arrived or was cancelled. Your full history is under Orders." />
  }

  return (
    <section className="utility-card tracking-utility">
      <div className="utility-card-heading"><h2>On its way</h2></div>
      {live.map((order) => (
        <article key={order.id} className="track-order">
          <header>
            <b>{order.orderNumber}</b>
            <span>Placed {new Date(String(order.createdAt).replace(' ', 'T')).toLocaleDateString('en-PK', { dateStyle: 'medium' })}</span>
          </header>
          {order.items.map((item) => {
            const reached = TRACK_STAGES.findIndex(([key]) => key === item.status)
            return (
              <div className="track-item" key={item.id}>
                <p className="track-item-name">{item.product.name} <small>× {item.quantity}</small></p>
                <ol className="track-steps">
                  {TRACK_STAGES.map(([key, label, icon], index) => (
                    <li key={key} className={index <= reached ? 'done' : ''}>
                      <span><FaIcon name={icon} /></span>
                      <small>{label}</small>
                    </li>
                  ))}
                </ol>
              </div>
            )
          })}
          <p className="track-note">
            Delivering to {order.shippingAddress.city}. Mirwal does not connect to courier tracking, so there is no
            live position or arrival time to show — the seller updates each item as it moves.
          </p>
        </article>
      ))}
    </section>
  )
}

function Compare() {
  const { products: compared, removeProduct, clearProducts } = useComparison()
  if (!compared.length) {
    return <NotConnected icon="scale-balanced" title="Nothing to compare yet" description="Use Compare on any product to add it here — you can compare up to 4 at once." />
  }
  return <section className="utility-card compare-utility">
    <div className="compare-heading"><div><h2><FaIcon name="scale-balanced" /> Compare Products</h2><p>Compare your selected products side by side.</p></div><button type="button" onClick={clearProducts}><FaIcon name="trash-can" /> Clear All</button></div>
    <div className="compare-products">
      {compared.map((product) => (
        <article key={product.id}>
          <button type="button" aria-label={`Remove ${product.name}`} onClick={() => removeProduct(product.id)}><FaIcon name="xmark" /></button>
          <img src={product.images?.[0]?.url} alt={product.name} />
          <b>{product.name}</b>
          <strong>{product.price?.display}</strong>
          {product.availability && <em>{product.availability.inStock ? 'In Stock' : 'Out of stock'}</em>}
          <small><FaIcon name="circle-check" /> {product.rating?.count ? `${product.rating.average.toFixed(1)} rating` : 'No ratings yet'}</small>
        </article>
      ))}
    </div>
    <div className="compare-actions">
      {compared.map((product) => <button type="button" key={product.id} onClick={() => navigate(`/product/${product.slug}`)}>View Product</button>)}
    </div>
    <Link className="utility-outline-action" to="/compare">Open full comparison <FaIcon name="arrow-right" /></Link>
  </section>
}

function CompareHistory() {
  const { history, clearHistory, loadProducts } = useComparison()
  return <section className="compare-history-page"><div className="compare-history-hero"><h1><span>⚖</span> Compare <em>History</em></h1><p>Review your recent product comparisons and continue where you left off.</p></div><div className="compare-history-heading"><h2>Compare History</h2><button type="button" onClick={clearHistory} disabled={!history.length}>Clear All History</button></div>{history.length ? history.map((entry) => <article className="compare-history-row" key={entry.id}><div><small>{new Date(entry.createdAt).toLocaleString()}</small><h3>{entry.products.length} products compared</h3></div><div className="compare-history-products">{entry.products.map((product) => <img key={product.id} src={product.images?.[0]?.url} alt={product.name} />)}</div><button type="button" onClick={() => { loadProducts(entry.products); navigate('/compare') }}>View Comparison <FaIcon name="arrow-right" /></button></article>) : <div className="compare-history-empty"><FaIcon name="scale-balanced" /><h3>No comparison history yet</h3><p>Add products to the general compare page and your comparison snapshots will appear here.</p><button type="button" onClick={() => navigate('/explore')}>Start Comparing</button></div>}</section>
}

const EMPTY_ADDRESS = { fullName: '', phone: '', line1: '', line2: '', city: '', region: '', postalCode: '', isDefault: false }

function normalizeAddress(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') }

function AddressForm({ initial, onCancel, onSave, saving }) {
  const [form, setForm] = useState(initial ?? EMPTY_ADDRESS)
  const setField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
      <div className="address-form-grid">
        <label>Full Name<input required value={form.fullName} onChange={setField('fullName')} /></label>
        <label>Phone Number<input required type="tel" value={form.phone} onChange={setField('phone')} /></label>
        <label>Street Address<input required value={form.line1} onChange={setField('line1')} /></label>
        <label>Apartment / Area (Optional)<input value={form.line2} onChange={setField('line2')} /></label>
        <label>City<input required value={form.city} onChange={setField('city')} /></label>
        <label>Province<input value={form.region} onChange={setField('region')} /></label>
        <label>Postal Code<input value={form.postalCode} onChange={setField('postalCode')} /></label>
      </div>
      <label className="address-form-default"><input type="checkbox" checked={form.isDefault} onChange={setField('isDefault')} /> Set as default address</label>
      <div className="address-form-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Address'}</button>
      </div>
    </form>
  )
}

function Addresses() {
  const { data: addresses, error, isLoading, refetch } = useApiQuery((signal) => api.addresses.list(signal), [])
  const [mode, setMode] = useState(null) // null | 'add' | address id being edited
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  async function handleSave(form) {
    setSaving(true)
    setActionError('')
    try {
      const duplicate = addresses.some((address) => address.id !== mode && ['fullName', 'phone', 'line1', 'line2', 'city', 'region', 'postalCode'].every((field) => normalizeAddress(address[field]) === normalizeAddress(form[field])))
      if (duplicate) {
        setActionError('This address is already saved.')
        return
      }
      if (mode === 'add' || mode === null) await api.addresses.create(form)
      else await api.addresses.update(mode, form)
      await refetch()
      setMode(null)
    } catch (requestError) {
      setActionError(describeApiError(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setActionError('')
    try { await api.addresses.remove(id); await refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
  }

  async function handleSetDefault(address) {
    setActionError('')
    try { await api.addresses.update(address.id, { ...address, isDefault: true }); await refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
  }

  if (isLoading) return <section className="utility-card address-utility"><p>Loading your addresses…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load your addresses" description={describeApiError(error)} />

  const editing = addresses.find((address) => address.id === mode)
  return (
    <div className="address-dashboard">
      <section className="utility-card address-utility address-saved-panel">
        <div className="utility-card-heading"><h2><FaIcon name="location-dot" /> Saved Addresses ({addresses.length})</h2><button type="button" onClick={() => setMode('add')}><FaIcon name="plus" /> Add New Address</button></div>
        {actionError && <p className="address-error" role="alert">{actionError}</p>}
        {addresses.length === 0 ? <p>You haven't saved any addresses yet.</p> : addresses.map((address) => (
          <div className={`address-item${address.isDefault ? ' is-default' : ''}`} key={address.id}>
            <div className="address-item-icon"><FaIcon name={address.isDefault ? 'house' : 'briefcase'} /></div>
            <div className="address-item-copy">{address.isDefault && <b>DEFAULT</b>}<strong>{address.fullName}</strong><small>{address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city}{address.region ? `, ${address.region}` : ''}</small><small><FaIcon name="phone" /> {address.phone}</small></div>
            <span className="address-item-actions">{!address.isDefault && <button type="button" onClick={() => handleSetDefault(address)}>Set Default</button>}<button type="button" onClick={() => setMode(address.id)}>Edit</button><button type="button" onClick={() => handleDelete(address.id)}>Delete</button></span>
          </div>
        ))}
      </section>
      <section className="utility-card address-utility address-form-panel">
        <div className="utility-card-heading"><h2><FaIcon name="plus" /> {editing ? 'Edit Address' : 'Add New Address'}</h2><p>Fill in the details to save a new address.</p></div>
        <AddressForm key={`${mode || 'add'}-${addresses.length}`} initial={editing} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} />
      </section>
    </div>
  )
}

/**
 * How you can pay.
 *
 * Mirwal deliberately saves nothing here. Storing a card means holding card data, and holding
 * card data is a PCI obligation nobody takes on by accident — so this lists the methods
 * available at checkout instead of pretending to a wallet.
 *
 * `configured` comes from the server's own view of which provider credentials are present, so
 * the list changes with the deployment rather than being hard-coded optimism.
 */
const PAYMENT_ICON = { cod: 'money-bill-wave', card: 'credit-card', easypaisa: 'mobile-screen', jazzcash: 'mobile-screen' }

function Payments() {
  const { data: methods, error, isLoading } = useApiQuery((signal) => api.payments.methods(signal), [])
  const { user, refresh } = useSession()
  const [savingDefault, setSavingDefault] = useState(false)

  if (isLoading) return <section className="utility-card"><p>Loading payment options…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load payment options" description={describeApiError(error)} />

  const available = methods.filter((method) => method.available)
  async function setDefault(method) {
    setSavingDefault(true)
    try { await api.auth.updateMe({ fullName: user.fullName, phone: user.phone ?? '', paymentMethod: method }); await refresh?.() }
    finally { setSavingDefault(false) }
  }
  return <>
    <section className="payment-hero"><div><h1>Secure &amp; Flexible <em>Payments</em></h1><p>Choose your preferred payment method and enjoy<br />a hassle-free shopping experience.</p><div className="payment-benefits"><span><b><FaIcon name="shield-halved" /></b>100% Secure<br />Transactions</span><span><b><FaIcon name="bolt" /></b>Multiple<br />Payment Options</span><span><b><FaIcon name="lock" /></b>Your Payment<br />Information is Safe</span></div></div><div className="payment-hero-art"><FaIcon name="credit-card" /><FaIcon name="mobile-screen" /><FaIcon name="shield-halved" /></div></section>
    <div className="payment-dashboard"><section className="utility-card payment-utility"><div className="utility-card-heading"><h2><FaIcon name="credit-card" /> Your Payment Methods</h2><p>Manage your available payment methods for faster checkout.</p></div>{available.map((method) => <article className="payment-method" key={method.method}><span><FaIcon name={PAYMENT_ICON[method.method] ?? 'credit-card'} /></span><div><b>{method.label}</b><small>{method.description}</small><em className="on">{user?.paymentMethod === method.method ? 'Default' : 'Available at checkout'}</em></div><button type="button" disabled={savingDefault || user?.paymentMethod === method.method} onClick={() => setDefault(method.method)}>Set as Default</button></article>)}</section><section className="utility-card payment-add-panel"><div className="utility-card-heading"><h2><FaIcon name="plus" /> Add New Payment Method</h2><p>Choose a payment method to use at checkout.</p></div><div className="payment-choice-grid">{methods.map((method) => <div className={method.available ? 'is-available' : 'is-disabled'} key={method.method}><FaIcon name={PAYMENT_ICON[method.method] ?? 'credit-card'} />{method.label}</div>)}</div><p className="payment-security-note"><FaIcon name="lock" /> Card details are entered securely through the payment provider. Mirwal never stores full card numbers.</p></section></div>
  </>
}

const NOTIFICATION_ICON = {
  order_placed: 'bag-shopping',
  order_status_changed: 'truck',
  return_requested: 'rotate-left',
  return_resolved: 'circle-check',
  item_cancelled: 'circle-xmark',
}

const CHANNEL_ICON = { inApp: 'bell', email: 'envelope', sms: 'mobile-screen' }
const CATEGORY_ICON = {
  orders: 'truck', returns: 'rotate-left', account: 'user',
  security: 'shield-halved', marketing: 'tag',
}

function Notifications() {
  const { data: notifications, error, isLoading, refetch } = useApiQuery((signal) => api.notifications.list(signal), [])
  const [actionError, setActionError] = useState('')
  const [selectedNotification, setSelectedNotification] = useState(null)
  /**
   * Preferences come from the server, and so does the list of them.
   *
   * They used to be read out of `localStorage` and written to two opaque JSON blobs on the
   * profile PATCH, with the browser inventing their shape — which is how this panel ended up
   * offering five toggles taken from an icon lookup table, none of which anything read. The
   * server now owns the categories, says which are compulsory, and honours the rest.
   */
  const prefs = useApiQuery((signal) => api.notifications.preferences(signal), [])
  const [saving, setSaving] = useState(null)

  const savePreference = async (kind, key, enabled) => {
    setSaving(key)
    setActionError('')
    try {
      await api.notifications.setPreferences({ [kind]: { [key]: enabled } })
      await prefs.refetch()
    } catch (error) { setActionError(describeApiError(error)) } finally { setSaving(null) }
  }

  async function openNotification(notification) {
    if (!notification.read) {
      try { await api.notifications.markRead(notification.id); await refetch() }
      catch (requestError) { setActionError(describeApiError(requestError)) }
    }
    setSelectedNotification(notification)
  }

  async function markAllRead() {
    setActionError('')
    try { await api.notifications.markAllRead(); await refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
  }

  if (isLoading) return <section className="utility-card notification-utility"><p>Loading your notifications…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load notifications" description={describeApiError(error)} />

  const unreadCount = notifications.filter((notification) => !notification.read).length

  return <section className="notification-dashboard">
    <div className="notification-hero"><div><h1><em>Notifications</em></h1><p>Stay updated with everything that matters.<br />Get real-time updates about your orders, deals, price drops and more.</p></div><div className="notification-hero-icon"><FaIcon name="bell" /></div></div>
    <div className="notification-columns">
      <section className="utility-card notification-utility"><div className="utility-card-heading"><h2><FaIcon name="bell" /> Recent Notifications <small>({notifications.length})</small></h2><button type="button" onClick={markAllRead} disabled={!unreadCount}>Mark all as read</button></div>{actionError && <p className="address-error" role="alert">{actionError}</p>}{notifications.length === 0 ? <p>You don't have any notifications yet. Order and account updates will show up here.</p> : notifications.map((notification) => <article className={`notification-item ${notification.read ? 'is-read' : 'is-unread'}`} key={notification.id} onClick={() => openNotification(notification)}><span><FaIcon name={NOTIFICATION_ICON[notification.type] ?? 'bell'} /></span><div><b>{notification.title}</b><p>{notification.body}</p></div><small>{new Date(notification.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</small></article>)}</section>
      <aside className="notification-side">
        <section className="notification-side-card">
          <h2><FaIcon name="sliders" /> How we reach you</h2>
          <p>Turn a channel off and nothing in it is sent — except security alerts.</p>
          <div>
            {(prefs.data?.channels ?? []).map((channel) => (
              <button
                className="notification-channel"
                type="button"
                key={channel.key}
                disabled={channel.forced || saving === channel.key}
                onClick={() => savePreference('channels', channel.key, !channel.enabled)}
              >
                <FaIcon name={CHANNEL_ICON[channel.key] ?? 'bell'} />
                <b>{channel.label}{channel.forced && <small>Always on &mdash; this is your record of what happened.</small>}</b>
                <i>{channel.enabled ? 'On' : 'Off'}</i>
              </button>
            ))}
          </div>
        </section>
        <section className="notification-side-card">
          <h2><FaIcon name="gear" /> What we tell you about</h2>
          <p>Choose what you hear from Mirwal about.</p>
          {(prefs.data?.categories ?? []).map((category) => (
            <button
              className="notification-preference"
              type="button"
              key={category.key}
              disabled={category.forced || saving === category.key}
              onClick={() => savePreference('categories', category.key, !category.enabled)}
            >
              <FaIcon name={CATEGORY_ICON[category.key] ?? 'bell'} />
              {/* Security says why it cannot be turned off rather than simply refusing: an
                  alert about a sign-in you did not make is no use to the person who did. */}
              <b>{category.label}<small>{category.forced ? 'Always on — these warn you about things you did not do.' : category.description}</small></b>
              <i>{category.enabled ? 'On' : 'Off'}</i>
            </button>
          ))}
        </section>
      </aside>
    </div>
    {selectedNotification && <div className="notification-modal-backdrop" role="presentation" onClick={() => setSelectedNotification(null)}><section className="notification-modal" role="dialog" aria-modal="true" aria-labelledby="notification-modal-title" onClick={(event) => event.stopPropagation()}><button className="notification-modal-close" type="button" aria-label="Close notification" onClick={() => setSelectedNotification(null)}><FaIcon name="xmark" /></button><div className="notification-modal-icon"><FaIcon name={NOTIFICATION_ICON[selectedNotification.type] ?? 'bell'} /></div><small>{new Date(selectedNotification.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-PK')}</small><h2 id="notification-modal-title">{selectedNotification.title}</h2><p>{selectedNotification.body}</p>{selectedNotification.link && <button type="button" onClick={() => navigate(selectedNotification.link)}>View details <FaIcon name="arrow-right" /></button>}</section></div>}
  </section>
}

/**
 * Account security: password, two-factor, and the devices you are signed in on.
 *
 * All three were disabled buttons under a line admitting nothing was connected. They are real
 * now — the same endpoints and the same TOTP implementation the admin panel uses, because a
 * shopper with saved addresses and an order history has something worth protecting too.
 *
 * Deliberately absent: "Delete Account". Erasing an account cascades through orders, reviews
 * and payouts that other people's records depend on, and a self-service button that quietly
 * did something narrower than the words on it would be worse than not having it. Support
 * handles it, and this says so.
 */
/**
 * The enrolment key, in the two forms people actually use.
 *
 * The API has returned an `otpauthUri` alongside the raw secret since migration 018 and both
 * panels ignored it, showing only a 32-character base32 string to be typed by hand into a
 * phone. That is the step where enrolment goes wrong: one mistyped character produces codes
 * that never match, and the failure looks like a broken feature rather than a typo.
 *
 * On a phone the `otpauth://` link opens the authenticator directly. On a desktop the secret
 * is grouped in fours, which is how every authenticator app formats it for manual entry, with
 * a copy button so it need not be transcribed at all.
 *
 * A QR code would be better still and needs a rendering library; this is the useful part of
 * that improvement with no new dependency.
 */
function TwoFactorKey({ enrolment }) {
  const [copied, setCopied] = useState(false)
  const grouped = String(enrolment.secret).replace(/(.{4})/g, '$1 ').trim()

  return (
    <div className="security-key">
      {enrolment.otpauthUri && (
        <a className="security-key-link" href={enrolment.otpauthUri}>
          <FaIcon name="mobile-screen" /> Open in my authenticator app
        </a>
      )}
      <p className="security-key-or">or enter the key by hand</p>
      <code className="security-secret">{grouped}</code>
      <button
        type="button"
        className="security-key-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(enrolment.secret)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          } catch {
            // Clipboard access is refused in some browsers and over plain http. The key is
            // on screen either way, so this is a convenience failing, not the flow failing.
          }
        }}
      >
        <FaIcon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy key'}
      </button>
    </div>
  )
}

function Security() {
  const { user } = useSession()
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' })
  const [enrolment, setEnrolment] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [confirmPassword, setConfirmPassword] = useState('')

  const twoFactor = useApiQuery((signal) => api.auth.twoFactor(signal), [], { enabled: !!user })
  const sessions = useApiQuery((signal) => api.auth.sessions(signal), [], { enabled: !!user })

  if (!user) {
    return <NotConnected icon="shield-halved" title="Sign in to manage your security" description="Your password, two-factor settings and signed-in devices are tied to your Mirwal account." />
  }

  const run = async (action) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Done.' })
      return result
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
      return null
    } finally { setBusy(false) }
  }

  const changePassword = async (event) => {
    event.preventDefault()
    const result = await run(() => api.auth.changePassword(passwords))
    if (result) {
      setPasswords({ currentPassword: '', newPassword: '' })
      sessions.refetch()
    }
  }

  const status = twoFactor.data

  return (
    <section className="utility-card security-utility">
      <h2>Security</h2>

      {flash && <p className={`security-flash ${flash.tone}`} role="status">{flash.text}</p>}

      {codes && (
        <div className="security-codes">
          <b>Save your recovery codes</b>
          <p>Each one signs you in once if you lose your phone. They are stored hashed — this is the only time they can be shown.</p>
          <ol>{codes.map((backupCode) => <li key={backupCode}><code>{backupCode}</code></li>)}</ol>
          <button type="button" onClick={() => setCodes(null)}>I have saved these</button>
        </div>
      )}

      {/*
        --- Contact details ---

        Placed first on purpose. Confirming that the email and phone on the account actually
        reach this person is what makes everything below it useful: a password reset, a 2FA
        recovery, and every security alert Mirwal sends all depend on it. It is also the gate
        on applying to sell.
      */}
      <div className="security-block">
        <div className="security-block-head">
          <span><FaIcon name="address-card" /></span>
          <b>Your contact details</b>
        </div>
        <p>Confirming these lets us reach you about orders, reset your password, and recover your account if you lose your phone.</p>
        <VerificationPanel api={api.verification} phoneHint="Add a mobile number on your Profile page, then come back here to confirm it." />
      </div>

      {/* --- Password --- */}
      <div className="security-block">
        <div className="security-block-head"><span><FaIcon name="key" /></span><b>Change your password</b></div>
        <p>Changing it signs you out everywhere else — which is the point if you think someone else has it.</p>
        <form onSubmit={changePassword}>
          <label>
            Current password
            <input type="password" autoComplete="current-password" required value={passwords.currentPassword}
              onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} />
          </label>
          <label>
            New password <small>At least 8 characters.</small>
            <input type="password" autoComplete="new-password" required minLength={8} value={passwords.newPassword}
              onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </div>

      {/* --- Two-factor --- */}
      <div className="security-block">
        <div className="security-block-head">
          <span><FaIcon name="shield-halved" /></span>
          <b>Two-factor authentication</b>
          <em className={status?.enabled ? 'on' : 'off'}>{status?.enabled ? 'On' : 'Off'}</em>
        </div>
        <p>A six-digit code from an authenticator app, on top of your password. Works with Google Authenticator, Authy, 1Password and any other app that follows the standard.</p>

        {twoFactor.isLoading ? <p>Checking…</p> : status?.enabled ? (
          <>
            <p>{status.backupCodesRemaining} of {status.backupCodesIssued} recovery codes unused.</p>
            <form onSubmit={(event) => { event.preventDefault() }}>
              <label>
                Your password <small>Required to change either of these.</small>
                <input type="password" autoComplete="current-password" value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
              <div className="security-actions">
                <button
                  type="button"
                  disabled={busy || !confirmPassword}
                  onClick={async () => {
                    const result = await run(() => api.auth.regenerateBackupCodes(confirmPassword))
                    if (result?.data) { setCodes(result.data.backupCodes); setConfirmPassword('') }
                  }}
                >
                  New recovery codes
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy || !confirmPassword}
                  onClick={async () => {
                    const result = await run(() => api.auth.disableTwoFactor(confirmPassword))
                    if (result) { setConfirmPassword(''); twoFactor.refetch() }
                  }}
                >
                  Turn off
                </button>
              </div>
            </form>
          </>
        ) : enrolment ? (
          <div className="security-enrol">
            <p>Add this key to your authenticator app, then enter the code it shows.</p>
            <TwoFactorKey enrolment={enrolment} />
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                const result = await run(() => api.auth.confirmTwoFactor(code))
                if (result?.data) { setCodes(result.data.backupCodes); setEnrolment(null); setCode(''); twoFactor.refetch() }
              }}
            >
              <label>
                Code from your app
                <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric"
                  autoComplete="one-time-code" maxLength={7} placeholder="123456" required />
              </label>
              <div className="security-actions">
                <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Confirm'}</button>
                <button type="button" onClick={() => { setEnrolment(null); setCode('') }}>Cancel</button>
              </div>
            </form>
            {/* Nothing is switched on until a working code proves the app holds the same key —
                enrolling on a key that was never scanned is how people lock themselves out. */}
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const result = await run(() => api.auth.beginTwoFactor())
              if (result?.data) setEnrolment(result.data)
            }}
          >
            Set up two-factor
          </button>
        )}
      </div>

      {/* --- Devices --- */}
      <div className="security-block">
        <div className="security-block-head"><span><FaIcon name="laptop" /></span><b>Where you are signed in</b></div>
        <p>Every device with a live session. Ending one signs that device out immediately.</p>
        {sessions.isLoading ? <p>Loading…</p> : (sessions.data ?? []).length === 0 ? <p>No other sessions.</p> : (
          <ul className="security-sessions">
            {sessions.data.map((session) => (
              <li key={session.id}>
                <div>
                  <b>{session.device}{session.isCurrent && <em> This device</em>}</b>
                  <small>
                    {session.ip ?? 'Unknown address'} · since{' '}
                    {new Date(String(session.startedAt).replace(' ', 'T')).toLocaleDateString('en-PK', { dateStyle: 'medium' })}
                  </small>
                </div>
                {/* No button on the current session: it would sign you out mid-click. */}
                {!session.isCurrent && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const result = await run(() => api.auth.revokeSession(session.id))
                      if (result) sessions.refetch()
                    }}
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="delete-account">
        <span>
          <b>Delete your account</b>
          <small>
            Handled by support rather than a button here: your account is attached to orders and reviews that
            sellers and other shoppers rely on, so it needs a person to unpick it properly.
          </small>
        </span>
        <button type="button" onClick={() => navigate('/help-center')}>Contact support</button>
      </div>
    </section>
  )
}

function Logout() {
  const { logout } = useSession()
  const submit = async () => {
    await logout()
    navigate('/login')
  }
  return <div className="logout-overlay"><section className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title">
    <div><FaIcon name="lock" /></div>
    <h2 id="logout-title">Sign out of Mirwal?</h2>
    <p>You will be logged out of your account on this device.</p>
    <button type="button" onClick={submit}>Logout</button>
    <button type="button" onClick={() => navigate('/profile')}>Cancel</button>
  </section></div>
}

export function AccountUtilityContent({ path }) { if (path === '/logout') return <Logout />; if (path === '/compare-history') return <CompareHistory />; const config = configs[path] || configs['/track-orders']; return <div className={`utility-content${path === '/addresses' ? ' addresses-content' : ''}${path === '/security' ? ' security-content' : ''}`}>{path === '/addresses' ? <section className="address-hero"><div><h1>Your <em>Addresses</em></h1><p>Save your addresses for faster checkout<br />and a smoother shopping experience.</p><div className="address-benefits"><span><b><FaIcon name="bolt" /></b>Faster<br />Checkout</span><span><b><FaIcon name="location-dot" /></b>Multiple<br />Addresses</span><span><b><FaIcon name="shield-halved" /></b>Secure<br />&amp; Private</span><span><b><FaIcon name="house" /></b>Deliver to<br />All Over Pakistan</span></div></div><div className="address-hero-art"><FaIcon name="location-dot" /><span>Delivering<br />Happiness<br />Across Pakistan</span></div></section> : path === '/security' ? <section className="security-hero"><div><h1>Security <em>Settings</em></h1><p>Keep your Mirwal account protected.</p><div className="security-benefits"><span><b><FaIcon name="shield-halved" /></b>Secure<br />Account</span><span><b><FaIcon name="lock" /></b>Your Data<br />Our Priority</span><span><b><FaIcon name="users" /></b>Safe<br />Shopping</span><span><b><FaIcon name="circle-check" /></b>Always<br />Protected</span></div></div><div className="security-hero-art"><FaIcon name="shield-halved" /><FaIcon name="lock" /></div></section> : <section className="utility-heading"><span><FaIcon name={config[0]} /></span><div><h1>{config[1]}</h1><p>{config[2]}</p></div></section>}{path === '/track-orders' && <TrackOrders />}{path === '/compare' && <Compare />}{path === '/addresses' && <Addresses />}{path === '/payment-methods' && <Payments />}{path === '/notifications' && <Notifications />}{path === '/security' && <Security />}</div> }
export default function AccountUtilityPage({ path, cartCount }) { const config = configs[path] || configs['/track-orders']; const active = config[1].replace('Your ', '').replace('My ', ''); return <div className="assistant-page"><Header cartCount={cartCount} /><main className="account-utility-page container"><div className="profile-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><FaIcon name="chevron-right" /><button type="button" onClick={() => navigate('/profile')}>My Account</button><FaIcon name="chevron-right" /><b>{config[1]}</b></div><div className="profile-layout"><AccountSidebar active={active} /><AccountUtilityContent path={path} /></div></main></div> }
