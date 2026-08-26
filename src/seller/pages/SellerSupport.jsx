import SellerLayout from '../SellerLayout'
import { navigateTo } from '../../navigation'
import './seller-help-center.css'

const categoryCards = [
  { title: 'Orders', description: 'Learn how to manage your orders and track their status.', icon: 'fa-solid fa-box', accent: 'orange', count: 28 },
  { title: 'Products', description: 'Discover product listings, updates, and inventory guidance.', icon: 'fa-solid fa-cube', accent: 'purple', count: 25 },
  { title: 'Shipping & Delivery', description: 'Learn about shipment methods, deliveries, and order timing.', icon: 'fa-solid fa-truck', accent: 'blue', count: 17 },
  { title: 'Payments & Payouts', description: 'Manage earnings, withdrawals and payment settings.', icon: 'fa-solid fa-wallet', accent: 'green', count: 21 },
  { title: 'Returns & Refunds', description: 'Resolve returns, cancellations, and refund requests quickly.', icon: 'fa-solid fa-rotate-left', accent: 'red', count: 18 },
  { title: 'Store Management', description: 'Update your storefront, profile, and business details.', icon: 'fa-solid fa-store', accent: 'amber', count: 12 },
  { title: 'Account & Security', description: 'Keep your account and seller access secure and verified.', icon: 'fa-solid fa-shield-halved', accent: 'steel', count: 16 },
  { title: 'Policies', description: 'Review policies, rules, and operational requirements.', icon: 'fa-solid fa-file-lines', accent: 'gray', count: 14 },
]

const supportRequests = [
  { id: '#SR-1256', subject: 'Payment rejected', category: 'Payments', created: 'May 20, 2024', status: 'In progress', updated: 'May 23, 2024' },
  { id: '#SR-1254', subject: 'Unable to update shipping rates', category: 'Shipping', created: 'May 18, 2024', status: 'Resolved', updated: 'May 20, 2024' },
  { id: '#SR-1252', subject: 'Store verification issue', category: 'Account', created: 'May 12, 2024', status: 'Waiting for review', updated: 'May 14, 2024' },
  { id: '#SR-1248', subject: 'Refund request for order #1024', category: 'Returns', created: 'May 08, 2024', status: 'Closed', updated: 'May 09, 2024' },
  { id: '#SR-1240', subject: 'How to update product details', category: 'Products', created: 'May 02, 2024', status: 'Resolved', updated: 'May 03, 2024' },
]

const topics = [
  'Orders & Shipments',
  'Products',
  'Payments & Payouts',
  'Returns & Refunds',
  'Store Management',
  'Account Security',
  'Policies',
  'Seller Support',
]

const requestDetail = {
  id: '#SR-1256',
  status: 'In progress',
  category: 'Payments',
  subject: 'Payment rejected',
  created: 'May 20, 2024',
  updated: 'May 23, 2024',
  description: 'I attempted to withdraw my payout but the payment was rejected. Please help review the transaction and confirm why it did not process successfully.',
  resolution: 'We are reviewing your payout account settings and bank verification details. An update will be shared within 24 hours.',
}

function SellerSupport({ view = 'overview' }) {
  const currentView = view || 'overview'
  const openPage = (path) => navigateTo(path)

  const navItems = [
    { label: 'Seller Support', path: '/seller/support' },
    { label: 'Support Categories', path: '/seller/support/categories' },
    { label: 'My Support Requests', path: '/seller/support/requests' },
    { label: 'Create Support Request', path: '/seller/support/create' },
  ]

  const renderOverview = () => (
    <div className="seller-help-grid">
      <section className="seller-help-panel seller-help-panel-large">
        <div className="seller-help-panel-header">
          <h2>Help Categories</h2>
        </div>
        <div className="seller-category-grid">
          {categoryCards.map((card) => (
            <button type="button" key={card.title} className="seller-category-card" onClick={() => openPage('/seller/support/categories')}>
              <span className={`seller-category-icon ${card.accent}`}><i className={card.icon} /></span>
              <div className="seller-category-main">
                <strong>{card.title}</strong>
                <small>{card.description}</small>
              </div>
              <em>{card.count}</em>
            </button>
          ))}
        </div>
      </section>

      <aside className="seller-help-panel seller-help-sidebar">
        <div className="seller-help-panel-header">
          <h2>Support Navigation</h2>
        </div>
        <div className="seller-nav-list">
          {navItems.map((item) => (
            <button type="button" key={item.label} className={`seller-side-link ${currentView === 'overview' && item.label === 'Seller Support' ? 'active' : ''}`} onClick={() => openPage(item.path)}>
              <i className="fa-solid fa-circle" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="seller-help-cta">
          <div className="seller-help-cta-icon"><i className="fa-solid fa-headset" /></div>
          <strong>Need immediate help?</strong>
          <button type="button" onClick={() => openPage('/seller/support/create')}>Create Support Request</button>
        </div>
      </aside>

      <section className="seller-help-panel seller-help-panel-wide">
        <div className="seller-help-panel-header">
          <h2>My Support Requests</h2>
        </div>
        <div className="seller-request-row seller-request-row-header">
          <span>Ticket ID</span>
          <span>Subject</span>
          <span>Category</span>
          <span>Created</span>
          <span>Status</span>
          <span>Last Update</span>
        </div>
        {supportRequests.slice(0, 4).map((request) => (
          <button type="button" key={request.id} className="seller-request-row" onClick={() => openPage(`/seller/support/request/${request.id.replace('#', '').toLowerCase()}`)}>
            <span>{request.id}</span>
            <span>{request.subject}</span>
            <span>{request.category}</span>
            <span>{request.created}</span>
            <span className={`status-pill ${request.status.toLowerCase().replace(/\s+/g, '-')}`}>{request.status}</span>
            <span>{request.updated}</span>
          </button>
        ))}
      </section>
    </div>
  )

  const renderCategories = () => (
    <div className="seller-help-single-panel">
      <div className="seller-help-panel-header">
        <h2>Support Categories</h2>
      </div>
      <div className="seller-category-grid large-grid">
        {categoryCards.map((card) => (
          <button type="button" key={card.title} className="seller-category-card" onClick={() => openPage('/seller/support/requests')}>
            <span className={`seller-category-icon ${card.accent}`}><i className={card.icon} /></span>
            <div className="seller-category-main">
              <strong>{card.title}</strong>
              <small>{card.description}</small>
            </div>
            <em>{card.count}</em>
          </button>
        ))}
      </div>
    </div>
  )

  const renderRequests = () => (
    <div className="seller-help-single-panel">
      <div className="seller-help-panel-header">
        <h2>My Support Requests</h2>
      </div>
      <div className="seller-requests-toolbar">
        <div className="seller-search-box small-search">
          <span className="seller-search-icon"><i className="fa-solid fa-magnifying-glass" /></span>
          <input type="text" placeholder="Search in requests..." />
        </div>
        <button type="button" className="seller-primary-btn" onClick={() => openPage('/seller/support/create')}>Create Support Request</button>
      </div>
      <div className="seller-request-table">
        <div className="seller-request-row seller-request-row-header">
          <span>Ticket ID</span>
          <span>Subject</span>
          <span>Category</span>
          <span>Created</span>
          <span>Status</span>
          <span>Last Update</span>
        </div>
        {supportRequests.map((request) => (
          <button type="button" key={request.id} className="seller-request-row" onClick={() => openPage(`/seller/support/request/${request.id.replace('#', '').toLowerCase()}`)}>
            <span>{request.id}</span>
            <span>{request.subject}</span>
            <span>{request.category}</span>
            <span>{request.created}</span>
            <span className={`status-pill ${request.status.toLowerCase().replace(/\s+/g, '-')}`}>{request.status}</span>
            <span>{request.updated}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const renderCreate = () => (
    <div className="seller-help-single-panel form-panel">
      <div className="seller-help-panel-header">
        <h2>Create Support Request</h2>
      </div>
      <div className="seller-help-form-grid">
        <label>
          <span>Ticket Category</span>
          <select defaultValue="Orders & Shipping">
            <option>Orders & Shipping</option>
            <option>Products</option>
            <option>Payments & Payouts</option>
            <option>Returns & Refunds</option>
            <option>Store Management</option>
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select defaultValue="High">
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </label>
        <label className="full-line">
          <span>Subject</span>
          <input type="text" defaultValue="Payment rejected" />
        </label>
        <label className="full-line">
          <span>Description</span>
          <textarea rows="7" defaultValue="I attempted to withdraw my payout but the payment was rejected. Please review the issue and advise on the best next step." />
        </label>
      </div>
      <div className="seller-help-form-footer">
        <button type="button" className="seller-secondary-btn" onClick={() => openPage('/seller/support/requests')}>Cancel</button>
        <button type="button" className="seller-primary-btn" onClick={() => openPage('/seller/support/requests')}>Submit Request</button>
      </div>
    </div>
  )

  const renderDetail = () => (
    <div className="seller-help-single-panel">
      <div className="seller-help-panel-header">
        <h2>Request Details</h2>
      </div>
      <div className="seller-request-detail-header">
        <div>
          <span className="seller-detail-badge">{requestDetail.category}</span>
          <h3>{requestDetail.subject}</h3>
        </div>
        <span className={`status-pill ${requestDetail.status.toLowerCase().replace(/\s+/g, '-')}`}>{requestDetail.status}</span>
      </div>
      <div className="seller-detail-meta">
        <span>Request ID: {requestDetail.id}</span>
        <span>Created: {requestDetail.created}</span>
        <span>Last Updated: {requestDetail.updated}</span>
      </div>
      <div className="seller-detail-body">
        <div className="seller-detail-section">
          <h4>Issue description</h4>
          <p>{requestDetail.description}</p>
        </div>
        <div className="seller-detail-section">
          <h4>Current update</h4>
          <p>{requestDetail.resolution}</p>
        </div>
      </div>
      <div className="seller-help-form-footer">
        <button type="button" className="seller-secondary-btn" onClick={() => openPage('/seller/support/requests')}>Back to Requests</button>
      </div>
    </div>
  )

  const renderByView = () => {
    switch (currentView) {
      case 'categories':
        return renderCategories()
      case 'requests':
        return renderRequests()
      case 'create':
        return renderCreate()
      case 'detail':
        return renderDetail()
      case 'overview':
      default:
        return renderOverview()
    }
  }

  return (
    <SellerLayout
      activeItem="seller-support"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/seller') },
        { label: 'Seller Support' },
      ]}
    >
      <div className="seller-help-page">
        <div className="seller-help-topbar">
          <div>
            <h1>Seller Support</h1>
            <p>Manage tickets, get help with seller issues, and keep track of open requests.</p>
          </div>
          <button type="button" className="seller-secondary-btn" onClick={() => openPage('/seller/support/create')}>Create a Request</button>
        </div>

        <div className="seller-help-search-wrap">
          <div className="seller-search-box seller-help-search">
            <span className="seller-search-icon"><i className="fa-solid fa-magnifying-glass" /></span>
            <input type="text" placeholder="Search support articles, topics or tickets..." />
          </div>
          <button type="button" className="seller-primary-btn">Search</button>
        </div>

        <div className="seller-help-tag-row">
          {topics.map((topic) => (
            <button key={topic} type="button" className="seller-help-tag" onClick={() => openPage('/seller/support/categories')}>
              {topic}
            </button>
          ))}
        </div>

        {renderByView()}
      </div>
    </SellerLayout>
  )
}

export default SellerSupport
