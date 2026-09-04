import SellerSidebar from './components/SellerSidebar'
import SellerHeader from './components/SellerHeader'
import './seller-layout.css'
// Shared StatCard/DataTable/StatusBadge/EmptyState styles for every seller page — previously
// only reachable through an `@import` buried in finance.css, so any page that didn't happen
// to load finance.css (or a future rewrite of it) silently rendered these unstyled. Loaded
// once here, at the shell every seller page renders through.
import './seller-components.css'
import { navigateTo } from '@mirwal/shared/navigation'
import { createContext, useContext, useState } from 'react'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from './api'

const SellerShellContext = createContext(false)

/**
 * `storeName` used to default to the literal string "Awais Store" and nothing ever overrode
 * it, so every seller — regardless of which store they actually run — saw someone else's store
 * name in their own panel header. `GET /seller/me/store` already exists and is
 * ownership-scoped to the authenticated seller; this is the first thing in the seller panel to
 * actually call it.
 */
const SellerLayout = ({ children, activeItem, breadcrumbs }) => {
  const isNested = useContext(SellerShellContext)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data: store } = useApiQuery((signal) => api.seller.store(signal), [])
  // Real count for the sidebar's "Orders" badge — it previously hard-coded 24 regardless of
  // how many orders (or whether any order at all) the signed-in seller actually had.
  const { data: orderItems } = useApiQuery((signal) => api.seller.orders(signal), [])
  const openOrderCount = orderItems?.filter((item) => !['delivered', 'cancelled'].includes(item.status)).length
  if (isNested) return children

  const handleNavigation = (path) => navigateTo(path)

  return <SellerShellContext.Provider value={true}>
    <div className="seller-container">
      <SellerSidebar activeItem={activeItem} onNavigate={handleNavigation} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} openOrderCount={openOrderCount} store={store} />
      {mobileOpen && <div className="seller-backdrop" role="presentation" onClick={() => setMobileOpen(false)} />}
      <div className="seller-main">
        <SellerHeader storeName={store?.name || 'Your store'} breadcrumbs={breadcrumbs} onMenu={() => setMobileOpen(true)} />
        <div className="seller-content">{children}</div>
      </div>
    </div>
  </SellerShellContext.Provider>
}

export default SellerLayout
