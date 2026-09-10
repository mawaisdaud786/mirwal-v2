import { useCallback, useEffect, useRef, useState } from 'react'
import { navigateTo } from '@mirwal/shared/navigation'
import { useSellerSession } from '../SellerSession'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

const NOTIFICATION_ICON = { new_order: 'bag-shopping', return_requested: 'rotate-left', item_cancelled: 'circle-xmark' }

/**
 * The notification bell used to show four hard-coded rows ("Order #MW1254876", "Payout
 * processed") to every seller regardless of what had actually happened in their store —
 * fabricated data sitting right next to SellerNotifications.jsx, which already reads the
 * real feed correctly. This reuses that same `GET /notifications` data instead of a second,
 * fake copy of it.
 *
 * Logout previously just navigated to `/login` without ending the session — the refresh
 * token stayed valid server-side. It now calls the real `useSellerSession().logout()` (revokes the
 * token, clears the httpOnly cookie) before navigating, the same real sign-out every other
 * part of the app uses.
 */
const SellerHeader = ({ storeName, breadcrumbs, onMenu }) => {
  const { logout } = useSellerSession()
  const { data: notifications, refetch } = useApiQuery((signal) => api.notifications.list(signal), [])
  const [menu, setMenu] = useState(null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const headerRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    const close = (event) => { if (!headerRef.current?.contains(event.target)) setMenu(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  /**
   * Cmd/Ctrl+K focuses search, matching the shortcut chip drawn in the box. Skipped while the
   * shopper is already typing somewhere else — the shortcut fires on this page, not mid-form.
   */
  const focusSearch = useCallback((event) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable
    if (typing && document.activeElement !== searchRef.current) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [])
  useEffect(() => {
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [focusSearch])

  const items = notifications ?? []
  const unread = items.filter((item) => !item.read).length

  const openNotification = async (notification) => {
    setMenu(null)
    if (!notification.read) {
      try { await api.notifications.markRead(notification.id) } catch { /* not fatal, still navigate */ }
      refetch()
    }
    navigateTo(notification.link || '/notifications')
  }

  const markAllRead = async (event) => {
    event.stopPropagation()
    try { await api.notifications.markAllRead(); refetch() } catch (error) { describeApiError(error) }
  }

  const confirmLogout = async () => {
    setLoggingOut(true); setLogoutError('')
    try { await logout(); navigateTo('/login') }
    catch (error) { setLogoutError(describeApiError(error)); setLoggingOut(false) }
  }

  return <header className="seller-header" ref={headerRef}>
    <div className="seller-header-left">
      <button type="button" className="seller-menu-btn" aria-label="Open navigation" onClick={onMenu}><i className="fa-solid fa-bars" aria-hidden="true" /></button>
      {breadcrumbs && breadcrumbs.length > 0 && <nav className="seller-breadcrumb" aria-label="Breadcrumb">
        {breadcrumbs.map((crumb, index) => <span key={crumb.label}>
          {index > 0 && <i className="seller-breadcrumb-sep" aria-hidden="true" />}
          {crumb.onClick ? <button type="button" onClick={crumb.onClick}>{crumb.label}</button> : <b>{crumb.label}</b>}
        </span>)}
      </nav>}
      <label className="seller-search-box">
        <span className="seller-search-icon"><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /></span>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search orders, products, customers…"
          aria-label="Search seller dashboard"
          onKeyDown={(event) => event.key === 'Enter' && navigateTo(`/products?search=${encodeURIComponent(event.currentTarget.value)}`)}
        />
        <kbd className="seller-search-kbd">{navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
      </label>
    </div>

    <div className="seller-header-right">
      <button className="seller-header-action-btn seller-view-store-btn" type="button" title="View your public store" onClick={() => navigateTo('/store')}>
        <i className="fa-solid fa-eye" aria-hidden="true" /><span className="seller-view-store-label">View Store</span>
      </button>

      <div className="seller-header-dropdown-wrap">
        <button className="seller-header-action-btn" type="button" title="Notifications" aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`} onClick={() => setMenu(menu === 'notifications' ? null : 'notifications')}>
          <i className="fa-solid fa-bell" aria-hidden="true" />
          {unread > 0 && <span className="seller-header-action-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {menu === 'notifications' && <div className="seller-dropdown">
          <div className="seller-dropdown-heading"><strong>Notifications</strong>{unread > 0 && <button type="button" onClick={markAllRead}>Mark all read</button>}</div>
          {items.length === 0
            ? <p className="seller-dropdown-empty">Nothing yet — new orders and returns will show up here.</p>
            : <div className="seller-dropdown-list">
                {items.slice(0, 6).map((item) => <button type="button" className={item.read ? 'seller-notification-item' : 'seller-notification-item is-unread'} key={item.id} onClick={() => openNotification(item)}>
                  <span className="seller-notification-icon"><i className={`fa-solid fa-${NOTIFICATION_ICON[item.type] ?? 'bell'}`} aria-hidden="true" /></span>
                  <span className="seller-notification-body"><strong>{item.title}</strong><small>{item.body}</small></span>
                </button>)}
              </div>}
          <button type="button" className="seller-dropdown-footer" onClick={() => { setMenu(null); navigateTo('/notifications') }}>View all notifications</button>
        </div>}
      </div>

      <div className="seller-header-dropdown-wrap">
        <button type="button" className="seller-user-menu" aria-label="Open seller account menu" aria-expanded={menu === 'profile'} onClick={() => setMenu(menu === 'profile' ? null : 'profile')}>
          <span className="seller-user-avatar">{storeName?.trim()?.charAt(0)?.toUpperCase() || 'S'}</span>
          <span className="seller-user-info"><span className="seller-user-name">{storeName}</span><span className="seller-user-role">Seller</span></span>
          <i className="fa-solid fa-chevron-down seller-user-chevron" aria-hidden="true" />
        </button>
        {menu === 'profile' && <div className="seller-dropdown seller-dropdown-menu">
          {[['store', 'Store Profile', '/store/profile'], ['gear', 'Store Settings', '/store/settings'], ['circle-question', 'Help Center', '/help']].map(([icon, label, path]) => (
            <button type="button" key={label} onClick={() => { setMenu(null); navigateTo(path) }}><i className={`fa-solid fa-${icon}`} aria-hidden="true" /> {label}</button>
          ))}
          <hr />
          <button type="button" className="seller-dropdown-danger" onClick={() => { setMenu(null); setLogoutOpen(true) }}><i className="fa-solid fa-right-from-bracket" aria-hidden="true" /> Log out</button>
        </div>}
      </div>
    </div>

    {logoutOpen && <div className="seller-modal-backdrop" role="presentation" onMouseDown={() => !loggingOut && setLogoutOpen(false)}>
      <div className="seller-modal" role="dialog" aria-modal="true" aria-labelledby="seller-logout-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="seller-logout-title">Log out of your seller account?</h2>
        <p>You'll need to sign in again to manage your store.</p>
        {logoutError && <p className="seller-modal-error">{logoutError}</p>}
        <div className="seller-modal-actions">
          <button type="button" className="seller-btn-secondary" onClick={() => setLogoutOpen(false)} disabled={loggingOut}>Cancel</button>
          <button type="button" className="seller-btn-danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
        </div>
      </div>
    </div>}
  </header>
}

export default SellerHeader
