import { useState } from 'react'

const sections = [
  ['', [['dashboard', 'Dashboard', 'house', '/seller']]],
  ['PRODUCTS', [['all-products', 'My Products', 'box', '/seller/products'], ['add-product', 'Add New Product', 'plus-circle', '/seller/products/add'], ['categories', 'Categories', 'layer-group', '/seller/categories'], ['brands', 'Brands', 'tags', '/seller/brands'], ['reviews', 'Product Reviews', 'star', '/seller/reviews']]],
  ['ORDERS', [['all-orders', 'Orders', 'box', '/seller/orders'], ['returns', 'Returns & Refunds', 'rotate-left', '/seller/orders/returns'], ['cancelled', 'Cancellations', 'circle-xmark', '/seller/orders/cancelled']]],
  ['FINANCE', [['overview', 'Overview', 'chart-line', '/seller/finance'], ['withdrawals', 'Withdrawals', 'money-bill-transfer', '/seller/finance/withdrawals'], ['payment-methods', 'Payment Settings', 'credit-card', '/seller/finance/settings']]],
  ['MARKETING', [['marketing-overview', 'Marketing Overview', 'chart-line', '/seller/marketing'], ['promotions', 'Promotions', 'bullhorn', '/seller/marketing/promotions'], ['discounts', 'Discounts', 'tag', '/seller/marketing/discounts'], ['coupons', 'Coupons', 'ticket', '/seller/marketing/coupons'], ['ads', 'Ads Campaigns', 'rectangle-ad', '/seller/marketing/ads'], ['recommendations', 'Recommendations', 'wand-magic-sparkles', '/seller/marketing/recommendations'], ['performance', 'Marketing Performance', 'chart-line', '/seller/marketing/performance']]],
  ['SHOP MANAGEMENT', [['store-profile', 'Store Profile', 'store', '/seller/store/profile'], ['shipping-settings', 'Shipping Settings', 'truck', '/seller/store/shipping'], ['store-settings', 'Store Settings', 'gear', '/seller/store/settings']]],
  ['SUPPORT', [['support-page', 'Help Center', 'circle-question', '/seller/help'], ['seller-support', 'Seller Support', 'headset', '/seller/support']]],
]

const SellerSidebar = ({ activeItem, onNavigate }) => {
  const [collapsed, setCollapsed] = useState(false)
  return <aside className={`seller-sidebar ${collapsed ? 'collapsed' : ''}`}><div className="seller-sidebar-brand"><span className="seller-brand-mark">M</span><div><b>MIRWAL</b><small>All finds. You choose.</small></div><button type="button" onClick={() => setCollapsed((value) => !value)} aria-label="Toggle sidebar"><i className="fa-solid fa-bars" /></button></div><div className="seller-store-badge" onClick={() => onNavigate('/seller')}><span><i className="fa-solid fa-store" /></span><div><b>Mirwal Store</b><small>Verified Seller</small></div></div><nav className="seller-nav" aria-label="Seller navigation">{sections.map(([title, items]) => <section key={title}>{title && <h2>{title}</h2>}{items.map(([id, label, icon, path]) => <button className={`seller-nav-item ${activeItem === id ? 'active' : ''}`} type="button" key={id} onClick={() => onNavigate(path)}><i className={`fa-solid fa-${icon}`} /><span>{label}</span>{id === 'all-orders' && <em>24</em>}{id === 'returns' && <em>2</em>}{id === 'ads' && <em>New</em>}</button>)}</section>)}</nav><button className="seller-view-store" type="button" onClick={() => onNavigate('/store')}>View Store <i className="fa-solid fa-arrow-up-right-from-square" /></button></aside>
}

export default SellerSidebar
