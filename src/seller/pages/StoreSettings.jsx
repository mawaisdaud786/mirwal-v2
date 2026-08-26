import SellerLayout from '../SellerLayout'
import { navigateTo } from '../../navigation'
import './store-settings.css'

const quickAccessItems = [
  { label: 'Store Information', icon: 'fa-solid fa-shop', path: '/seller/store/information' },
  { label: 'Store Branding', icon: 'fa-solid fa-palette', path: '/seller/store/branding' },
  { label: 'Business Information', icon: 'fa-solid fa-building', path: '/seller/store/business' },
  { label: 'Contact Information', icon: 'fa-solid fa-user-tie', path: '/seller/store/contact' },
  { label: 'Store Policies', icon: 'fa-solid fa-file-contract', path: '/seller/store/policies' },
  { label: 'Store Hours', icon: 'fa-solid fa-clock', path: '/seller/store/hours' },
  { label: 'Store SEO', icon: 'fa-solid fa-magnifying-glass-chart', path: '/seller/store/seo' },
  { label: 'Store Preview', icon: 'fa-solid fa-eye', path: '/seller/store/preview' },
]

const completionChecklist = [
  { label: 'Store Information', status: 'Completed' },
  { label: 'Store Branding', status: 'Completed' },
  { label: 'Store Policies', status: 'Completed' },
  { label: 'Store Social Profiles', status: 'Pending' },
]

const recentUpdates = [
  { title: 'Updated store banner', date: 'Apr 17, 2026', status: 'Approved' },
  { title: 'Edited business details', date: 'Apr 02, 2026', status: 'Pending' },
  { title: 'Changed contact email', date: 'Mar 12, 2026', status: 'Approved' },
  { title: 'Updated return policy', date: 'Mar 07, 2026', status: 'Approved' },
]

const profileSummary = {
  logo: 'M',
  name: 'Mirwal Store',
  url: 'mirwal.store/mirwal-store',
  status: 'Active',
  rating: '4.8',
  products: '120',
  orders: '2,456',
  followers: '24,800',
}

function StoreSettings() {
  return (
    <SellerLayout
      activeItem="store-settings"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/seller') },
        { label: 'Store Settings' },
      ]}
    >
      <div className="store-settings-page">
        <div className="store-settings-header-row">
          <div>
            <h1 className="store-settings-page-title">Store Settings</h1>
          </div>
          <button type="button" className="store-settings-preview-button" onClick={() => navigateTo('/seller/store/preview')}>
            Preview Store
          </button>
        </div>

        <div className="store-settings-main-grid">
          <section className="store-settings-card store-settings-card-wide">
            <div className="store-settings-card-header">
              <h2>Store Profile Completion</h2>
            </div>
            <div className="completion-content">
              <div className="completion-ring" aria-label="Store completion 78 percent">
                <div className="completion-ring-inner">
                  <span>78%</span>
                </div>
              </div>
              <div className="completion-checklist">
                {completionChecklist.map((item) => (
                  <div key={item.label} className="completion-check-item">
                    <span className="completion-dot" />
                    <span>{item.label}</span>
                    <em className={item.status === 'Pending' ? 'pending' : 'complete'}>{item.status}</em>
                  </div>
                ))}
              </div>
            </div>
          </section>

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
                <div className="store-summary-logo">{profileSummary.logo}</div>
                <div className="store-summary-details">
                  <h3>{profileSummary.name}</h3>
                  <span className="store-summary-status">{profileSummary.status}</span>
                </div>
              </div>
              <div className="summary-property-row">
                <span>Store URL</span>
                <strong>{profileSummary.url}</strong>
              </div>
              <div className="summary-property-row">
                <span>Rating</span>
                <strong>★ {profileSummary.rating}</strong>
              </div>
              <div className="summary-metrics">
                <div><strong>{profileSummary.products}</strong><span>Products</span></div>
                <div><strong>{profileSummary.orders}</strong><span>Orders</span></div>
                <div><strong>{profileSummary.followers}</strong><span>Followers</span></div>
              </div>
            </div>
          </section>

          <section className="store-settings-card recent-updates-card">
            <div className="store-settings-card-header">
              <h2>Recent Updates</h2>
            </div>
            <div className="recent-updates-list">
              {recentUpdates.map((item) => (
                <div key={`${item.title}-${item.date}`} className="recent-update-item">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.date}</span>
                  </div>
                  <em className={item.status === 'Pending' ? 'pending' : 'complete'}>{item.status}</em>
                </div>
              ))}
            </div>
            <button type="button" className="recent-updates-link" onClick={() => navigateTo('/seller/store/preview')}>
              View all
            </button>
          </section>
        </div>
      </div>
    </SellerLayout>
  )
}

export default StoreSettings
