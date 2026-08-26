import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

const groups = [
  ['OVERVIEW', [['Dashboard', 'gauge-high', '/admin'], ['Analytics Overview', 'chart-line', '/admin/analytics'], ['Notifications', 'bell', '/admin/notifications', '12']]],
  ['MARKETPLACE', [['Products', 'box', '/admin/products'], ['Categories', 'layer-group', '/admin/categories'], ['Brands', 'tags', '/admin/brands'], ['Attributes', 'sliders', '/admin/attributes'], ['Inventory', 'boxes-stacked', '/admin/inventory'], ['Product Approvals', 'clipboard-check', '/admin/product-approvals', '18'], ['Product Reports', 'flag', '/admin/product-reports']]],
  ['SELLERS', [['All Sellers', 'users', '/admin/sellers'], ['Applications', 'user-plus', '/admin/seller-applications', '42'], ['Verification', 'user-shield', '/admin/verification'], ['Seller Performance', 'chart-column', '/admin/seller-performance'], ['Payouts', 'money-bill-transfer', '/admin/payouts']]],
  ['STORES', [['All Stores', 'store', '/admin/stores'], ['Store Applications', 'shop', '/admin/store-applications']]],
  ['CUSTOMERS', [['All Customers', 'user-group', '/admin/customers'], ['Reviews', 'star', '/admin/reviews'], ['Complaints', 'circle-exclamation', '/admin/complaints'], ['Blocked Accounts', 'user-lock', '/admin/blocked-accounts']]],
  ['ORDERS', [['All Orders', 'bag-shopping', '/admin/orders'], ['Returns', 'rotate-left', '/admin/returns'], ['Refunds', 'arrow-rotate-left', '/admin/refunds'], ['Disputes', 'scale-balanced', '/admin/disputes']]],
  ['MIRWAL AI', [['AI Overview', 'robot', '/admin/ai'], ['Shopping Queries', 'magnifying-glass', '/admin/ai/queries'], ['Recommendations', 'wand-magic-sparkles', '/admin/ai/recommendations'], ['Comparisons', 'code-compare', '/admin/ai/comparisons'], ['AI Analytics', 'brain', '/admin/ai/analytics']]],
  ['MARKETING & GROWTH', [['Promotions', 'bullhorn', '/admin/promotions'], ['Campaigns', 'rectangle-ad', '/admin/campaigns'], ['Coupons', 'ticket', '/admin/coupons'], ['Flash Sales', 'bolt', '/admin/flash-sales'], ['Banners', 'images', '/admin/banners'], ['Financial Sections', 'chart-pie', '/admin/financial-sections']]],
  ['FINANCES', [['Finances', 'wallet', '/admin/finances'], ['Business Analytics', 'chart-line', '/admin/business-analytics'], ['Marketplace Analytics', 'chart-column', '/admin/marketplace-analytics'], ['Seller Analytics', 'chart-area', '/admin/seller-analytics'], ['Customer Analytics', 'users', '/admin/customer-analytics'], ['AI Analytics', 'brain', '/admin/ai/analytics']]],
  ['ADMINISTRATION', [['Admin Users', 'user-gear', '/admin/users'], ['Roles & Permissions', 'user-shield', '/admin/roles'], ['Teams', 'users-gear', '/admin/teams'], ['Access Control', 'key', '/admin/access-control'], ['Login Sessions', 'right-to-bracket', '/admin/sessions'], ['Admin Activity', 'clock-rotate-left', '/admin/activity'], ['Audit Logs', 'file-shield', '/admin/audit-logs']]],
  ['SYSTEM', [['General Settings', 'gear', '/admin/settings'], ['Platform Settings', 'sliders', '/admin/platform-settings'], ['Payment Settings', 'credit-card', '/admin/payment-settings'], ['Shipping & Delivery', 'truck', '/admin/shipping'], ['Tax & Commission', 'percent', '/admin/tax'], ['Email & SMS', 'envelope', '/admin/messaging'], ['Notifications', 'bell', '/admin/notifications'], ['Integrations', 'plug', '/admin/integrations'], ['API & Webhooks', 'code', '/admin/api'], ['AI Configuration', 'robot', '/admin/ai/configuration'], ['Search Configuration', 'magnifying-glass', '/admin/search'], ['Security', 'shield-halved', '/admin/security'], ['System Logs', 'list', '/admin/system-logs'], ['Error Logs', 'triangle-exclamation', '/admin/error-logs'], ['Backup & Restore', 'database', '/admin/backup'], ['Maintenance Mode', 'screwdriver-wrench', '/admin/maintenance']]],
]

export default function AdminSidebar({ mobileOpen, onCollapse, onNavigate, onClose }) {
  const { pathname } = useLocation()
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('mirwal-admin-open-groups'))
      return new Set(Array.isArray(saved) ? saved : ['OVERVIEW', 'MARKETPLACE', 'SELLERS', 'CUSTOMERS', 'ORDERS', 'MIRWAL AI'])
    } catch {
      return new Set(['OVERVIEW', 'MARKETPLACE', 'SELLERS', 'CUSTOMERS', 'ORDERS', 'MIRWAL AI'])
    }
  })

  useEffect(() => {
    window.localStorage.setItem('mirwal-admin-open-groups', JSON.stringify([...openGroups]))
  }, [openGroups])

  const toggleGroup = (title) => setOpenGroups((current) => {
    const next = new Set(current)
    next.has(title) ? next.delete(title) : next.add(title)
    return next
  })

  return <aside className={`admin-sidebar ${mobileOpen ? 'mobile-open' : ''}`}><div className="admin-brand"><span>M</span><div><strong>MIRWAL</strong><small>Super Admin Panel</small></div><button type="button" aria-label="Close navigation" onClick={onClose}><i className="fa-solid fa-xmark" /></button></div><nav aria-label="Super admin navigation">{groups.map(([title, items]) => <section key={title}><button type="button" className="admin-group-toggle" aria-expanded={openGroups.has(title)} onClick={() => toggleGroup(title)}><h2>{title}</h2><i className={`fa-solid fa-chevron-${openGroups.has(title) ? 'down' : 'right'}`} /></button>{openGroups.has(title) && items.map(([label, icon, path, badge]) => <button type="button" key={`${title}-${label}`} className={`admin-nav-item ${pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`)) ? 'active' : ''}`} onClick={() => { onNavigate(path); onClose() }}><i className={`fa-solid fa-${icon}`} /><span>{label}</span>{badge && <em>{badge}</em>}</button>)}</section>)}</nav><div className="admin-sidebar-footer"><button type="button" onClick={onCollapse}><i className="fa-solid fa-chevron-left" /><span>Collapse</span></button></div></aside>
}
