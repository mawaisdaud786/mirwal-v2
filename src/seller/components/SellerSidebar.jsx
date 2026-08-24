import { useState } from 'react'

const SellerSidebar = ({ activeItem, onNavigate }) => {
  const [expandedSection, setExpandedSection] = useState(null)

  const navSections = [
    {
      id: 'main',
      title: '',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: '📊', path: '/seller' },
      ],
    },
    {
      id: 'orders',
      title: 'Orders',
      items: [
        { id: 'all-orders', label: 'All Orders', icon: '📋', path: '/seller/orders', badge: '128' },
        { id: 'new-orders', label: 'New Orders', icon: '🆕', path: '/seller/orders/new' },
        { id: 'processing', label: 'Processing', icon: '⏳', path: '/seller/orders/processing' },
        { id: 'ready-to-ship', label: 'Ready to Ship', icon: '📦', path: '/seller/orders/ready' },
        { id: 'shipped', label: 'Shipped', icon: '🚚', path: '/seller/orders/shipped' },
        { id: 'delivered', label: 'Delivered', icon: '✓', path: '/seller/orders/delivered' },
        { id: 'cancelled', label: 'Cancelled', icon: '✕', path: '/seller/orders/cancelled' },
        { id: 'returns', label: 'Returns', icon: '↩️', path: '/seller/orders/returns' },
        { id: 'refunds', label: 'Refunds', icon: '💰', path: '/seller/orders/refunds' },
      ],
    },
    {
      id: 'products',
      title: 'Products',
      items: [
        { id: 'all-products', label: 'All Products', icon: '📦', path: '/seller/products' },
        { id: 'add-product', label: 'Add Product', icon: '➕', path: '/seller/products/add' },
        { id: 'drafts', label: 'Drafts', icon: '📝', path: '/seller/products/drafts' },
        { id: 'pending-approval', label: 'Pending Approval', icon: '⏱️', path: '/seller/products/pending' },
        { id: 'active-products', label: 'Active Products', icon: '✓', path: '/seller/products/active' },
        { id: 'inactive-products', label: 'Inactive Products', icon: '❌', path: '/seller/products/inactive' },
        { id: 'out-of-stock', label: 'Out of Stock', icon: '📍', path: '/seller/products/out-of-stock' },
      ],
    },
    {
      id: 'management',
      title: 'Management',
      items: [
        { id: 'inventory', label: 'Inventory', icon: '📊', path: '/seller/inventory' },
        { id: 'customers', label: 'Customers', icon: '👥', path: '/seller/customers' },
        { id: 'reviews', label: 'Reviews', icon: '⭐', path: '/seller/reviews', badge: '23' },
        { id: 'analytics', label: 'Analytics', icon: '📈', path: '/seller/analytics' },
      ],
    },
    {
      id: 'finances',
      title: 'Finances',
      items: [
        { id: 'earnings', label: 'Earnings', icon: '💵', path: '/seller/earnings' },
        { id: 'payouts', label: 'Payouts', icon: '💳', path: '/seller/payouts' },
        { id: 'coupons', label: 'Coupons', icon: '🎟️', path: '/seller/coupons' },
      ],
    },
    {
      id: 'store',
      title: 'Store',
      items: [
        { id: 'store-settings', label: 'Store Settings', icon: '⚙️', path: '/seller/store/settings' },
        { id: 'store-profile', label: 'Store Profile', icon: '🏪', path: '/seller/store/profile' },
        { id: 'shipping-settings', label: 'Shipping Settings', icon: '📍', path: '/seller/store/shipping' },
        { id: 'payment-methods', label: 'Payment Methods', icon: '💳', path: '/seller/store/payments' },
      ],
    },
    {
      id: 'support',
      title: 'Support',
      items: [
        { id: 'notifications', label: 'Notifications', icon: '🔔', path: '/seller/notifications' },
        { id: 'staff-permissions', label: 'Staff & Permissions', icon: '👤', path: '/seller/staff' },
        { id: 'reports', label: 'Reports', icon: '📄', path: '/seller/reports' },
        { id: 'support-page', label: 'Support', icon: '💬', path: '/seller/support' },
        { id: 'seller-guide', label: 'Seller Guide', icon: '📚', path: '/seller/guide' },
      ],
    },
  ]

  const toggleSection = (sectionId) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId)
  }

  return (
    <div className="seller-sidebar">
      <div className="seller-sidebar-header">
        <div className="seller-store-badge" onClick={() => onNavigate('/seller')}>
          <div className="seller-store-badge-icon">🏪</div>
          <div className="seller-store-badge-text">
            <div className="seller-store-name">Awais Store</div>
            <div className="seller-store-type">Seller</div>
          </div>
        </div>
      </div>

      <div className="seller-nav">
        {navSections.map((section) => (
          <div key={section.id} className="seller-nav-section">
            {section.title && (
              <div className="seller-nav-section-title">{section.title}</div>
            )}
            {section.items.map((item) => (
              <div key={item.id}>
                <div
                  className={`seller-nav-item ${activeItem === item.id ? 'active' : ''}`}
                  onClick={() => onNavigate(item.path)}
                >
                  <div className="seller-nav-icon">{item.icon}</div>
                  <div className="seller-nav-label">{item.label}</div>
                  {item.badge && <div className="seller-nav-badge">{item.badge}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="seller-sidebar-footer">
        <div className="seller-sidebar-growth">
          <div className="seller-sidebar-growth-icon">📈</div>
          <div className="seller-sidebar-growth-title">Grow Your Business</div>
          <div className="seller-sidebar-growth-text">Use ads and promotions to increase your sales.</div>
          <button className="seller-sidebar-growth-button">Promote Store ➜</button>
        </div>
      </div>
    </div>
  )
}

export default SellerSidebar
