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
  '/profile': { icon: 'circle-user', heading: 'Profile' },
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
function WishlistContent() {
  const { items, isSignedIn } = useWishlist()
  if (!isSignedIn) {
    return <NotConnected icon="heart" title="Sign in to see your wishlist" description="Your wishlist is saved to your account, so it follows you to any device." />
  }
  if (!items.length) {
    return <NotConnected icon="heart" title="Your wishlist is empty" description="Tap the heart on any product to save it here." />
  }
  return <section className="assistant-related-grid" aria-label="Wishlist">
    {items.map((product) => <div className="wishlist-tile" key={product.id}>
      <ProductTile product={product} />
      <WishlistHeart product={product} className="wishlist-tile-heart" savedClassName="is-saved" />
    </div>)}
  </section>
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

  const values = form ?? { fullName: user.fullName ?? '', phone: user.phone ?? '' }
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
    <form className="assistant-related-form" onSubmit={submit}>
      <label>
        Full name
        <input value={values.fullName} onChange={change('fullName')} maxLength={150} required />
      </label>
      <label>
        Phone
        <input value={values.phone} onChange={change('phone')} maxLength={20} placeholder="+92 300 1234567" />
      </label>
      <label>
        Email address
        <input value={user.email} readOnly disabled />
        <small className="profile-field-note">Your email identifies your account and can’t be changed here yet.</small>
      </label>
      {error && <p className="profile-form-error">{error}</p>}
      {saved && <p className="profile-form-saved"><FaIcon name="circle-check" /> Profile saved.</p>}
      <button className="assistant-related-action" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
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

export function AssistantRelatedContent({ path }) {
  const content = pageContent[path] || pageContent['/my-chats']
  return <>
    <section className="assistant-related-heading">
      <span><FaIcon name={content.icon} /></span>
      <div><h1>{content.heading}</h1></div>
    </section>
    {path === '/recently-viewed' ? <RecentlyViewedContent />
      : path === '/wishlist' ? <WishlistContent />
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
