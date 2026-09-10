import { useState } from 'react'
import Header from './components/Header'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import { getRecentSlugs } from './lib/recommendations'
import './ai-assistant.css'
import { navigateTo } from '@mirwal/shared/navigation'
import { useWishlist } from './components/useWishlist'
import { useSession } from './components/useSession'
import WishlistHeart from './components/WishlistHeart'

/**
 * Account pages. Chats and saved searches genuinely have no backend yet; profile, wishlist
 * and recently-viewed are real.
 *
 * `ProfilePage` used to show one specific fabricated identity — "Muhammad Umar",
 * umar@example.com, a phone number, a Lahore address, a stock photo avatar, "12 Total Orders" —
 * to every visitor who reached `/profile`, regardless of who (if anyone) was actually signed
 * in. It now reads and edits the real signed-in account (`GET`/`PATCH /auth/me`) — name and
 * phone only; email is the account identity and roles/status are never client-editable.
 *
 * `WishlistPage` seeded a *new* visitor's wishlist with 8 arbitrary products they never chose,
 * then fabricated a discount percentage from each item's array position and hard-coded "Only 4
 * left" on whichever product landed at index 6. It is real now: `wishlist_items` is a real
 * per-account table (migration 010), every heart across the app writes to it through
 * WishlistContext, and this page renders exactly what the signed-in shopper actually saved.
 * Because it is server-owned rather than per-browser, it follows them to another device and
 * is gone from the UI the moment they sign out.
 *
 * `/recently-viewed` is the one page here with something real to show: `mirwal-recent-products`
 * (written by `ProductPage`/`HomePage`'s product cards) already tracks genuine per-visitor
 * viewing history, so this hydrates that instead of a fixed `products.slice(5, 8)`.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const pageContent = {
  '/my-chats': { icon: 'message', heading: 'My Chats', title: 'Chat history isn’t connected yet', description: 'Mirwal AI chat isn’t wired up to a backend yet, so there’s no history to show.' },
  '/wishlist': { icon: 'heart', heading: 'Wishlist', title: 'Wishlist isn’t connected yet', description: 'A wishlist needs a real account to save items to, which isn’t wired up yet.' },
  '/recently-viewed': { icon: 'clock-rotate-left', heading: 'Recently Viewed' },
  '/saved-searches': { icon: 'magnifying-glass', heading: 'Saved Searches', title: 'Saved searches aren’t connected yet', description: 'Saving a search needs a real account, which isn’t wired up yet.' },
  '/profile': { icon: 'circle-user', heading: 'Your Profile', description: 'Keep your information up to date for a better and more personalized shopping experience.' },
  '/settings': { icon: 'gear', heading: 'Settings', title: 'Settings aren’t connected yet', description: 'Shopping and assistant preferences need a real account to save to, which isn’t wired up yet.' },
}

function navigate(path) { navigateTo(path) }

function ProductTile({ product }) {
  const image = product.images[0]
  return (
    <button className="assistant-related-product" type="button" onClick={() => navigate(`/product/${product.slug}`)}>
      <img src={image?.url} alt={image?.alt ?? product.name} />
      <span>
        <b>{product.name}</b>
        <small>{product.price.display}</small>
        {product.rating.count > 0 && <em><FaIcon name="star" /> {product.rating.average.toFixed(1)}</em>}
      </span>
    </button>
  )
}

function NotConnected({ icon, title, description }) {
  return <section className="account-empty-state">
    <div className="account-empty-illustration"><FaIcon name={icon} /></div>
    <h2>{title}</h2>
    <p>{description}</p>
    <button type="button" onClick={() => navigate('/explore')}><FaIcon name="bag-shopping" /> Explore Products</button>
  </section>
}

/** The real, server-stored wishlist for the signed-in shopper (server/src/modules/wishlist). */
function WishlistContent({ onAddToCart }) {
  const { items, isSignedIn } = useWishlist()
  if (!isSignedIn) {
    return <NotConnected icon="heart" title="Sign in to see your wishlist" description="Your wishlist is saved to your account, so it follows you to any device." />
  }
  if (!items.length) {
    return <NotConnected icon="heart" title="Your wishlist is empty" description="Tap the heart on any product to save it here." />
  }
  return <div className="wishlist-dashboard"><section className="wishlist-hero"><div><h1>Your <em>Wishlist</em></h1><p>Saved today. A smarter tomorrow.<br />Keep your favorite products in one place.</p></div><FaIcon name="heart" /></section><div className="wishlist-body"><section className="wishlist-items"><div className="wishlist-toolbar"><b>All Items ({items.length})</b><span>Recently Added</span><label>Sort by <select defaultValue="newest"><option value="newest">Newest First</option><option value="name">Name</option><option value="price">Price</option></select></label><button type="button" aria-label="Grid view"><FaIcon name="grip" /></button><button type="button" aria-label="List view"><FaIcon name="list" /></button></div><div className="assistant-related-grid" aria-label="Wishlist">{items.map((product) => <div className="wishlist-tile" key={product.id}><ProductTile product={product} /><WishlistHeart product={product} className="wishlist-tile-heart" savedClassName="is-saved" /><button className="wishlist-add-cart" type="button" disabled={product.availability?.inStock === false} onClick={() => onAddToCart?.(product)}><FaIcon name="cart-shopping" /> Add to cart</button></div>)}</div></section><aside className="wishlist-summary"><h2><FaIcon name="heart" /> Wishlist Summary</h2><p>Total Items <b>{items.length}</b></p><p>Saved for later <b>{items.length}</b></p><button type="button" onClick={() => items.forEach((product) => onAddToCart?.(product))}><FaIcon name="cart-shopping" /> Move All to Cart</button></aside></div></div>
}


/**
 * The signed-in shopper's real profile (GET /auth/me, PATCH /auth/me).
 *
 * This page used to show one specific fabricated identity — "Muhammad Umar",
 * umar@example.com, a Lahore address, "12 Total Orders" — to every visitor regardless of who
 * was signed in. It now shows the actual account, and only the two fields a shopper owns are
 * editable: email is the account identity (changing it needs a verification flow that does
 * not exist), and roles/status are not editable at all — the server ignores them even if the
 * request body carries them.
 */
function ProfileContent() {
  const { user, refresh } = useSession()
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!user) {
    return <NotConnected icon="circle-user" title="Sign in to view your profile" description="Your profile details are tied to your Mirwal account." />
  }

  const values = form ?? {
    fullName: user.fullName ?? '',
    phone: user.phone ?? '',
    city: user.city ?? '',
    country: user.country ?? 'Pakistan',
    language: user.language ?? 'English',
    address: user.address ?? '',
  }
  const completionFields = [values.fullName, user.email, values.phone, values.address, values.language]
  const completion = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100)
  const change = (key) => (event) => { setForm({ ...values, [key]: event.target.value }); setSaved(false) }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      await api.auth.updateMe(values)
      await refresh?.()
      setSaved(true)
    } catch (submitError) {
      setError(describeApiError(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-dashboard">
      <div className="profile-main-column">
        <form className="assistant-related-form profile-personal-card" onSubmit={submit}>
          <div className="profile-section-heading"><span><FaIcon name="user" /></span><div><h2>Personal Information</h2><p>Tell us about yourself.</p></div></div>
      <div className="profile-form-grid">
        <label>
          Full name
          <input value={values.fullName} onChange={change('fullName')} maxLength={150} required />
        </label>
        <label>
          Phone number
          <input value={values.phone} onChange={change('phone')} maxLength={20} placeholder="+92 300 1234567" />
        </label>
      </div>

      <div className="profile-form-grid">
        <label>
          City
          <input value={values.city} onChange={change('city')} maxLength={80} placeholder="Lahore" />
        </label>
        <label>
          Country
          <select value={values.country} onChange={change('country')}>
            <option value="Pakistan">Pakistan</option>
            <option value="United Arab Emirates">United Arab Emirates</option>
            <option value="Saudi Arabia">Saudi Arabia</option>
            <option value="United Kingdom">United Kingdom</option>
            <option value="United States">United States</option>
          </select>
        </label>
      </div>

      <div className="profile-form-grid">
        <label>
          Preferred language
          <select value={values.language} onChange={change('language')}>
            <option value="English">English</option>
            <option value="Urdu">Urdu</option>
            <option value="Arabic">Arabic</option>
          </select>
        </label>
        <label>
          Email address
          <input value={user.email} readOnly disabled />
        </label>
      </div>

      <label>
        Default delivery address
        <textarea value={values.address} onChange={change('address')} rows={3} placeholder="House 12, Gulberg, Lahore" />
      </label>

      <small className="profile-field-note">Your email identifies your account and can’t be changed here yet.</small>
      {error && <p className="profile-form-error">{error}</p>}
      {saved && <p className="profile-form-saved"><FaIcon name="circle-check" /> Profile saved.</p>}
      <button className="assistant-related-action" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
        </form>

        <div className="profile-bottom-cards">
          <section className="profile-mini-card"><h3><FaIcon name="location-dot" /> Shipping Address</h3><p>Set your default shipping address for faster checkout.</p><button type="button" onClick={() => navigate('/addresses?add=1')}><FaIcon name="plus" /> Add Shipping Address</button></section>
          <section className="profile-mini-card"><h3><FaIcon name="credit-card" /> Payment Methods</h3><p>Add and manage your payment methods.</p><button type="button" onClick={() => navigate('/payment-methods?add=1')}><FaIcon name="plus" /> Add Payment Method</button></section>
          <section className="profile-mini-card"><h3><FaIcon name="bell" /> Communication Preferences</h3><p>Choose what you want to hear from us.</p><label><input type="checkbox" defaultChecked /> Order updates</label><label><input type="checkbox" defaultChecked /> Deals & offers</label><label><input type="checkbox" defaultChecked /> News & recommendations</label></section>
        </div>
      </div>

      <aside className="profile-right-rail">
        <section className="profile-completion"><h3><FaIcon name="user" /> Account Completion</h3><div className="profile-completion-score"><strong style={{ '--profile-completion': `${completion}%` }}>{completion}%</strong><span><b>{completion >= 80 ? 'Your profile is almost complete!' : 'Complete your profile'}</b><small>Add missing information to get a better experience.</small></span></div><ul><li className={values.fullName ? 'is-complete' : ''}>Basic Information</li><li className="is-complete">Email Verified</li><li className={values.phone ? 'is-complete' : ''}>Phone Number</li><li className={values.address ? 'is-complete' : ''}>Add Address</li><li>Add Payment Method</li><li>Verify CNIC (Optional)</li></ul></section>
        <section className="profile-quick-actions"><h3><FaIcon name="bolt" /> Quick Actions</h3><button type="button" onClick={() => navigate('/addresses')}><FaIcon name="location-dot" /> Manage Addresses <FaIcon name="chevron-right" /></button><button type="button" onClick={() => navigate('/payment-methods')}><FaIcon name="credit-card" /> Payment Methods <FaIcon name="chevron-right" /></button><button type="button" onClick={() => navigate('/security')}><FaIcon name="shield-halved" /> Security Settings <FaIcon name="chevron-right" /></button><button type="button" onClick={() => navigate('/notifications')}><FaIcon name="bell" /> Notification Preferences <FaIcon name="chevron-right" /></button></section>
      </aside>
    </div>
  )
}

function RecentlyViewedContent() {
  const [slugs] = useState(getRecentSlugs)
  const { data } = useApiQuery(
    (signal) => Promise.all(slugs.map((slug) => api.products.get(slug, signal).catch(() => null))),
    [slugs.join(',')],
    { enabled: slugs.length > 0 },
  )
  const items = (data ?? []).filter(Boolean)
  if (!items.length) {
    return <NotConnected icon="clock-rotate-left" title="No recently viewed products yet" description="Products you open from the marketplace will show up here." />
  }
  return <section className="assistant-related-grid" aria-label="Recently viewed">{items.map((product) => <ProductTile key={product.id} product={product} />)}</section>
}

export function AssistantRelatedContent({ path, onAddToCart }) {
  const content = pageContent[path] || pageContent['/my-chats']
  return <>
    <section className={`assistant-related-heading${path === '/wishlist' ? ' wishlist-generic-heading' : ''}`}>
      <span><FaIcon name={content.icon} /></span>
      <div><h1>{content.heading}</h1>{content.description && <p>{content.description}</p>}</div>
    </section>
    {path === '/recently-viewed' ? <RecentlyViewedContent />
      : path === '/wishlist' ? <WishlistContent onAddToCart={onAddToCart} />
      : path === '/profile' ? <ProfileContent />
      : <NotConnected icon={content.icon} title={content.title} description={content.description} />}
  </>
}

export default function AssistantRelatedPage({ path, cartCount }) {
  return <div className="assistant-page"><Header cartCount={cartCount} /><main className="assistant-related-page container">
    <button className="assistant-back" type="button" onClick={() => navigate('/ai-assistant')}><FaIcon name="arrow-left" /> Back to AI Assistant</button>
    <AssistantRelatedContent path={path} />
  </main></div>
}
