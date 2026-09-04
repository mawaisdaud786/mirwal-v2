import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import './store-settings.css'

/**
 * Store settings hub. Previously showed a fixed "Mirwal Store" profile — the same name,
 * "★4.8", "120 products", "2,456 orders" and "24,800 followers" regardless of which seller was
 * actually signed in — plus a fabricated 78% completion ring, a checklist marked "Completed"
 * regardless of reality, and a fake change-approval history with invented dates. "Followers"
 * isn't a real concept in the schema at all (no seller-follow feature exists).
 *
 * Real now: store name, slug and status from `GET /seller/me/store`; product count and
 * aggregate rating computed from `GET /seller/me/products`, the same real weighted aggregate
 * `Reviews.jsx` uses. Order and revenue totals come from `GET /seller/me/finance`, the same
 * endpoint the Finance page reads.
 *
 * Followers is gone rather than rebuilt: there is no seller-follow feature in the schema, so
 * a follower count could only ever be invented. A completion ring and a change-approval
 * history are gone for the same reason — nothing tracks settings changes per store.
 */
const quickAccessItems = [
  { label: 'Store Information', icon: 'fa-solid fa-shop', path: '/store/information' },
  { label: 'Store Branding', icon: 'fa-solid fa-palette', path: '/store/branding' },
  { label: 'Business Information', icon: 'fa-solid fa-building', path: '/store/business' },
  { label: 'Contact Information', icon: 'fa-solid fa-user-tie', path: '/store/contact' },
  { label: 'Store Policies', icon: 'fa-solid fa-file-contract', path: '/store/policies' },
  { label: 'Store Hours', icon: 'fa-solid fa-clock', path: '/store/hours' },
  { label: 'Store SEO', icon: 'fa-solid fa-magnifying-glass-chart', path: '/store/seo' },
  { label: 'Store Preview', icon: 'fa-solid fa-eye', path: '/store/preview' },
]

function StoreSettings() {
  const { data: store } = useApiQuery((signal) => api.seller.store(signal), [])
  const { data: products } = useApiQuery((signal) => api.seller.products(signal), [])
  // Real trading figures, replacing a panel that said orders were not connected. The same
  // endpoint Finance uses, over all time rather than a window.
  const finance = useApiQuery((signal) => api.seller.finance({ range: 'all' }, signal), [])
  const items = products ?? []
  const rated = items.filter((p) => p.rating.count > 0)
  const totalReviews = rated.reduce((sum, p) => sum + p.rating.count, 0)
  const avgRating = rated.length ? (rated.reduce((sum, p) => sum + p.rating.average * p.rating.count, 0) / totalReviews).toFixed(1) : null

  return (
    <SellerLayout
      activeItem="store-settings"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/') },
        { label: 'Store Settings' },
      ]}
    >
      <div className="store-settings-page">
        <div className="store-settings-header-row">
          <div>
            <h1 className="store-settings-page-title">Store Settings</h1>
          </div>
          <button type="button" className="store-settings-preview-button" onClick={() => navigateTo('/store/preview')}>
            Preview Store
          </button>
        </div>

        <div className="store-settings-main-grid">
          <section className="store-settings-card store-settings-card-wide">
            <div className="store-settings-card-header">
              <h2>Quick Access</h2>
            </div>
            <div className="quick-access-grid">
              {quickAccessItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="quick-access-item"
                  onClick={() => navigateTo(item.path)}
                >
                  <span className="quick-access-icon">
                    <i className={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="store-settings-card store-summary-card">
            <div className="store-settings-card-header">
              <h2>Store Summary</h2>
            </div>
            <div className="store-summary-body">
              <div className="store-summary-top">
                <div className="store-summary-logo">{store?.name?.charAt(0).toUpperCase() || '?'}</div>
                <div className="store-summary-details">
                  <h3>{store?.name || 'Loading…'}</h3>
                  <span className="store-summary-status">{store?.status || ''}</span>
                </div>
              </div>
              <div className="summary-property-row">
                <span>Store URL</span>
                {store?.slug
                  ? <button type="button" className="store-summary-link" onClick={() => navigateTo(`/seller/${store.slug}`)}><strong>/seller/{store.slug}</strong></button>
                  : <strong>—</strong>}
              </div>
              <div className="summary-property-row">
                <span>Rating</span>
                <strong>{avgRating ? `★ ${avgRating}` : 'No reviews yet'}</strong>
              </div>
              <div className="summary-metrics">
                <div><strong>{items.length}</strong><span>Products</span></div>
              </div>
            </div>
          </section>

          <section className="store-settings-card store-settings-card-wide">
            <div className="store-settings-card-header">
              <h2>Trading</h2>
            </div>
            {finance.isLoading ? (
              <p className="store-settings-note">Loading your figures...</p>
            ) : finance.isError || !finance.data ? (
              <EmptyState
                icon={<Icon name="chart-line" />}
                title="Could not load your figures"
                text="Your order and revenue totals are temporarily unavailable. Finance has the full breakdown."
              />
            ) : (
              <>
                <div className="summary-metrics store-settings-trading">
                  <div><strong>{Number(finance.data.kpis.orders.value ?? 0).toLocaleString('en-PK')}</strong><span>Delivered orders</span></div>
                  <div><strong>{finance.data.kpis.revenue.value.display}</strong><span>Revenue</span></div>
                  <div><strong>{finance.data.kpis.availableBalance.value.display}</strong><span>Available to withdraw</span></div>
                  <div><strong>{totalReviews.toLocaleString('en-PK')}</strong><span>Reviews</span></div>
                </div>
                <button type="button" className="store-settings-link" onClick={() => navigateTo('/finance')}>
                  <Icon name="arrow-right" /> Full breakdown in Finance
                </button>
                {/* Followers is not a concept in Mirwal's schema — there is no seller-follow
                    feature — so the panel reports what the store actually has instead of a
                    metric that would have to be invented. */}
              </>
            )}
          </section>
        </div>
      </div>
    </SellerLayout>
  )
}

export default StoreSettings
