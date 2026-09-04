import { useState } from 'react'
import { Link } from 'react-router-dom'
import Header from './components/Header'
import { useComparison } from './components/useComparison'
import { useSession } from './components/useSession'
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

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />
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
  const links = [['user', 'Profile', '/profile'], ['box', 'Orders', '/orders'], ['truck', 'Track Orders', '/track-orders'], ['heart', 'Wishlist', '/wishlist'], ['scale-balanced', 'Compare', '/compare'], ['location-dot', 'Addresses', '/addresses'], ['credit-card', 'Payment Methods', '/payment-methods'], ['bell', 'Notifications', '/notifications'], ['shield-halved', 'Security', '/security']]
  return <aside className="profile-sidebar"><b className="profile-sidebar-title">MY ACCOUNT</b>{links.map(([icon, label, path]) => <button className={label === active ? 'active' : ''} type="button" key={label} onClick={() => navigate(path)}><FaIcon name={icon} /> {label}{label === 'Compare' && compared.length > 0 && <i className="profile-count">{compared.length}</i>}</button>)}<button className="profile-logout" type="button" onClick={() => navigate('/logout')}><FaIcon name="right-from-bracket" /> Logout</button></aside>
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
    <div className="utility-card-heading"><h2>Compare Products ({compared.length})</h2><button type="button" onClick={clearProducts}>Clear All</button></div>
    <div className="compare-products">
      {compared.map((product) => (
        <article key={product.id}>
          <button type="button" aria-label={`Remove ${product.name}`} onClick={() => removeProduct(product.id)}><FaIcon name="xmark" /></button>
          <img src={product.images?.[0]?.url} alt={product.name} />
          <b>{product.name}</b>
          <strong>{product.price?.display}</strong>
          {product.availability && <em>{product.availability.inStock ? 'In Stock' : 'Out of stock'}</em>}
        </article>
      ))}
    </div>
    <div className="compare-actions">
      {compared.map((product) => <button type="button" key={product.id} onClick={() => navigate(`/product/${product.slug}`)}>View Product</button>)}
    </div>
    <Link className="utility-outline-action" to="/compare">Open full comparison <FaIcon name="arrow-right" /></Link>
  </section>
}

const EMPTY_ADDRESS = { fullName: '', phone: '', line1: '', line2: '', city: '', region: '', postalCode: '', isDefault: false }

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
      if (mode === 'add') await api.addresses.create(form)
      else await api.addresses.update(mode, form)
      setMode(null)
      refetch()
    } catch (requestError) {
      setActionError(describeApiError(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setActionError('')
    try { await api.addresses.remove(id); refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
  }

  async function handleSetDefault(address) {
    setActionError('')
    try { await api.addresses.update(address.id, { ...address, isDefault: true }); refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
  }

  if (isLoading) return <section className="utility-card address-utility"><p>Loading your addresses…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load your addresses" description={describeApiError(error)} />

  if (mode === 'add' || addresses.some((address) => address.id === mode)) {
    const editing = addresses.find((address) => address.id === mode)
    return (
      <section className="utility-card address-utility">
        <div className="utility-card-heading"><h2>{editing ? 'Edit Address' : 'Add New Address'}</h2></div>
        <AddressForm initial={editing} onCancel={() => setMode(null)} onSave={handleSave} saving={saving} />
      </section>
    )
  }

  return (
    <section className="utility-card address-utility">
      <div className="utility-card-heading"><h2>Saved Addresses</h2><button type="button" onClick={() => setMode('add')}>Add New Address</button></div>
      {actionError && <p className="address-error" role="alert">{actionError}</p>}
      {addresses.length === 0 ? (
        <p>You haven't saved any addresses yet.</p>
      ) : addresses.map((address) => (
        <div className="address-item" key={address.id}>
          <div>
            {address.isDefault && <b>DEFAULT</b>}
            <strong>{address.fullName}</strong>
            <small>{address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city}{address.region ? `, ${address.region}` : ''} · {address.phone}</small>
          </div>
          <span>
            {!address.isDefault && <button type="button" onClick={() => handleSetDefault(address)}>Set Default</button>}
            <button type="button" onClick={() => setMode(address.id)}>Edit</button>
            <button type="button" onClick={() => handleDelete(address.id)}>Delete</button>
          </span>
        </div>
      ))}
    </section>
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

  if (isLoading) return <section className="utility-card"><p>Loading payment options…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load payment options" description={describeApiError(error)} />

  return (
    <section className="utility-card payment-utility">
      <div className="utility-card-heading"><h2>How you can pay</h2></div>
      <p className="payment-intro">
        Mirwal does not store your card. Payments are handled by the provider at checkout, and nothing
        card-shaped is ever kept on your account — which is why there is no wallet to manage here.
      </p>
      {methods.map((method) => (
        <article className={`payment-method ${method.available ? '' : 'unavailable'}`} key={method.method}>
          <span><FaIcon name={PAYMENT_ICON[method.method] ?? 'credit-card'} /></span>
          <div>
            <b>{method.label}</b>
            <small>{method.description}</small>
          </div>
          {/* Availability is the server's own view of which provider credentials are present,
              so an unconfigured gateway is never shown as though it worked. */}
          <em className={method.available ? 'on' : 'off'}>{method.available ? 'Available' : 'Not offered'}</em>
        </article>
      ))}
    </section>
  )
}

const NOTIFICATION_ICON = {
  order_placed: 'bag-shopping',
  order_status_changed: 'truck',
  return_requested: 'rotate-left',
  return_resolved: 'circle-check',
  item_cancelled: 'circle-xmark',
}

function Notifications() {
  const { data: notifications, error, isLoading, refetch } = useApiQuery((signal) => api.notifications.list(signal), [])
  const [actionError, setActionError] = useState('')

  async function openNotification(notification) {
    if (!notification.read) {
      try { await api.notifications.markRead(notification.id); refetch() }
      catch (requestError) { setActionError(describeApiError(requestError)) }
    }
    if (notification.link) navigate(notification.link)
  }

  async function markAllRead() {
    setActionError('')
    try { await api.notifications.markAllRead(); refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
  }

  if (isLoading) return <section className="utility-card notification-utility"><p>Loading your notifications…</p></section>
  if (error) return <NotConnected icon="triangle-exclamation" title="Couldn't load notifications" description={describeApiError(error)} />

  const unreadCount = notifications.filter((notification) => !notification.read).length

  return (
    <section className="utility-card notification-utility">
      <div className="utility-card-heading">
        <h2>Notifications</h2>
        {unreadCount > 0 && <button type="button" onClick={markAllRead}>Mark all as read</button>}
      </div>
      {actionError && <p className="address-error" role="alert">{actionError}</p>}
      {notifications.length === 0 ? (
        <p>You don't have any notifications yet. Order and account updates will show up here.</p>
      ) : notifications.map((notification) => (
        <article
          key={notification.id}
          style={{ opacity: notification.read ? 0.65 : 1, cursor: notification.link ? 'pointer' : 'default' }}
          onClick={() => openNotification(notification)}
        >
          <span><FaIcon name={NOTIFICATION_ICON[notification.type] ?? 'bell'} /></span>
          <div>
            <b>{notification.title}</b>
            <p>{notification.body}</p>
          </div>
          <small>{new Date(notification.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</small>
        </article>
      ))}
    </section>
  )
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
            <code className="security-secret">{enrolment.secret}</code>
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
  return <section className="utility-card logout-utility">
    <div><FaIcon name="lock" /></div>
    <h2>Are you sure you want to logout?</h2>
    <p>You will be logged out of your account on this device.</p>
    <button type="button" onClick={submit}>Logout</button>
    <button type="button" onClick={() => navigate('/profile')}>Cancel</button>
  </section>
}

export function AccountUtilityContent({ path }) { const config = configs[path] || configs['/track-orders']; return <div className="utility-content"><section className="utility-heading"><span><FaIcon name={config[0]} /></span><div><h1>{config[1]}</h1><p>{config[2]}</p></div></section>{path === '/track-orders' && <TrackOrders />}{path === '/compare' && <Compare />}{path === '/addresses' && <Addresses />}{path === '/payment-methods' && <Payments />}{path === '/notifications' && <Notifications />}{path === '/security' && <Security />}{path === '/logout' && <Logout />}</div> }
export default function AccountUtilityPage({ path, cartCount }) { const config = configs[path] || configs['/track-orders']; const active = config[1].replace('Your ', '').replace('My ', ''); return <div className="assistant-page"><Header cartCount={cartCount} /><main className="account-utility-page container"><div className="profile-breadcrumb"><button type="button" onClick={() => navigate('/')}>Home</button><FaIcon name="chevron-right" /><button type="button" onClick={() => navigate('/profile')}>My Account</button><FaIcon name="chevron-right" /><b>{config[1]}</b></div><div className="profile-layout"><AccountSidebar active={active} /><AccountUtilityContent path={path} /></div></main></div> }
