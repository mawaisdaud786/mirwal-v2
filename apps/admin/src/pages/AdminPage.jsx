import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { EmptyState } from './AdminStates'
import { navigateTo } from '@mirwal/shared/navigation'

/**
 * The catch-all for an `/admin/*` path with no page of its own.
 *
 * Backup & Restore and Maintenance Mode used to land here as not-connected states. Both are
 * real now and routed to `AdminPlatformPages`, so this file is what it says it is: a
 * not-found page. It names the segment that was asked for and offers a way back, rather than
 * inventing a screen for a URL nobody built.
 */

const labels = {
  analytics: 'Analytics Overview',
  products: 'Products',
  categories: 'Categories',
  sellers: 'All Sellers',
  orders: 'All Orders',
  customers: 'All Customers',
  notifications: 'Notifications',
  promotions: 'Promotions',
  settings: 'General Settings',
}

export default function AdminPage() {
  const { pathname } = useLocation()
  const segment = pathname.split('/').filter(Boolean).pop() ?? ''
  const title = labels[segment] || segment.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

  return (
    <AdminLayout>
      <section className="admin-page-placeholder">
        <div className="admin-page-heading"><h1>{title || 'Page not found'}</h1></div>
        <EmptyState
          icon="compass"
          title="There is no page at this address"
          description={`Nothing in the admin panel is served from ${pathname}. If you followed a link from inside Mirwal, it is out of date — everything reachable is in the sidebar.`}
          actionLabel="Back to the dashboard"
          onAction={() => navigateTo('/')}
        />
      </section>
    </AdminLayout>
  )
}
