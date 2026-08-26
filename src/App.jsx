import './App.css'
import HomePage from './HomePage'
import ProductPage from './ProductPage'
import CartPage from './CartPage'
import CheckoutPage from './CheckoutPage'
import AuthPage from './AuthPage'
import ProductsPage from './ProductsPage'
import DealsPage from './DealsPage'
import ComparePage from './ComparePage'
import StorePage from './StorePage'
import SellerPage from './SellerPage'
import SellerFormPage from './SellerFormPage'
import AiAssistantPage from './AiAssistantPage'
import AssistantRelatedPage from './AssistantRelatedPage'
import ProfileOrdersPage from './ProfileOrdersPage'
import AccountUtilityPage from './AccountUtilityPage'
import AccountShell from './AccountShell'
import BlogPage from './BlogPage'
import HelpCenterPage from './HelpCenterPage'
import AboutUsPage from './AboutUsPage'
import { AddToCartModal, SuccessModal } from './components/MirwalModals'
import Dashboard from './seller/pages/Dashboard'
import AdminDashboard from './admin/AdminDashboard'
import AdminErrorPage from './admin/AdminErrorPage'
import AdminPage from './admin/AdminPage'
import AdminAnalytics from './admin/AdminAnalytics'
import AdminNotifications from './admin/AdminNotifications'
import AdminProducts from './admin/AdminProducts'
import AdminCategories from './admin/AdminCategories'
import AdminMarketplacePage from './admin/AdminMarketplacePages'
import AdminSellerPages from './admin/AdminSellerPages'
import AdminCustomerPages from './admin/AdminCustomerPages'
import AdminOrderPages from './admin/AdminOrderPages'
import AdminAIPages from './admin/AdminAIPages'
import AdminFinancePages from './admin/AdminFinancePages'
import AdminAdministrationPages from './admin/AdminAdministrationPages'
import AdminMarketingPages from './admin/AdminMarketingPages'
import AdminSettingsPages from './admin/AdminSettingsPages'
import AdminPlatformSettings from './admin/AdminPlatformSettings'
import AdminPaymentSettings from './admin/AdminPaymentSettings'
import AdminShippingPages from './admin/AdminShippingPages'
import AdminTaxCommission from './admin/AdminTaxCommission'
import AdminMessagingPages from './admin/AdminMessagingPages'
import AdminSystemLogs from './admin/AdminSystemLogs'
import AdminNotificationSettings from './admin/AdminNotificationSettings'
import AdminIntegrations from './admin/AdminIntegrations'
import AdminAPIWebhooks from './admin/AdminAPIWebhooks'
import AdminAIConfiguration from './admin/AdminAIConfiguration'
import AdminSearchConfiguration from './admin/AdminSearchConfiguration'
import AdminSecurityPages from './admin/AdminSecurityPages'
import AdminStorePages from './admin/AdminStorePages'
import Orders from './seller/pages/Orders'
import Products from './seller/pages/Products'
import AddProduct from './seller/pages/AddProduct'
import FinancePage from './seller/pages/FinancePage'
import StoreProfile from './seller/pages/StoreProfile'
import StoreSettings from './seller/pages/StoreSettings'
import ShippingSettings from './seller/pages/ShippingSettings'
import SellerHelpCenter from './seller/pages/SellerHelpCenter'
import SellerSupport from './seller/pages/SellerSupport'
import SellerNotFound from './seller/pages/SellerNotFound'
import Marketing from './seller/pages/Marketing'
import Reviews from './seller/pages/Reviews'
import ReturnsRefunds from './seller/pages/ReturnsRefunds'
import RequestDetails from './seller/pages/RequestDetails'
import Customers from './seller/pages/Customers'
import CatalogPage from './seller/pages/CatalogPage'
import SellerNotifications from './seller/pages/SellerNotifications'
import { products } from './data/mockData'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { navigateTo, setRouterNavigate } from './navigation'
import { SiteChromeContext } from './navigation'
import Header from './components/Header'
import Footer from './components/Footer'
import SellerLayout from './seller/SellerLayout'

const accountPaths = ['/my-chats', '/profile', '/orders', '/track-orders', '/wishlist', '/recently-viewed', '/saved-searches', '/addresses', '/payment-methods', '/notifications', '/security', '/settings', '/logout']

function App() {
  const location = useLocation()
  const routerNavigate = useNavigate()
  const path = location.pathname
  const [cartItems, setCartItems] = useState(() => products.slice(0, 4).map((product) => ({ ...product, quantity: 1 })))
  const [cartMessage, setCartMessage] = useState('')
  const [modal, setModal] = useState(null)

  useEffect(() => setRouterNavigate(routerNavigate), [routerNavigate])

  const productId = path.match(/^\/products\/([^/]+)/)?.[1]
  const product = products.find((item) => item.id === productId)
  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0)
  const addToCart = (item, quantity = 1) => {
    setCartItems((items) => items.some((cartItem) => cartItem.id === item.id)
      ? items.map((cartItem) => cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + quantity } : cartItem)
      : [...items, { ...item, quantity }])
    setCartMessage(`${item.name} added to cart`)
    setModal({ type: 'cart', product: item })
    window.setTimeout(() => setCartMessage(''), 2400)
  }
  const changeQuantity = (id, quantity) => setCartItems((items) => items.map((item) => item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item))
  const removeFromCart = (id) => setCartItems((items) => items.filter((item) => item.id !== id))
  const checkout = () => {
    navigateTo('/checkout')
  }
  const orderPlaced = (message) => {
    setCartMessage(message)
    setModal({ type: 'success' })
    window.setTimeout(() => setCartMessage(''), 2400)
  }

  // Determine page based on path
  let page
  
  // Seller Panel Routes
  if (path === '/admin/notifications') {
    page = <AdminNotifications />
  } else if (path.startsWith('/admin/notifications/')) {
    page = <AdminNotificationSettings />
  } else if (path === '/admin/settings' || path.startsWith('/admin/settings/')) {
    page = <AdminSettingsPages />
  } else if (path === '/admin/security' || path.startsWith('/admin/security/')) {
    page = <AdminSecurityPages />
  } else if (path === '/admin/search' || path.startsWith('/admin/search/')) {
    page = <AdminSearchConfiguration />
  } else if (path === '/admin/ai/configuration' || path.startsWith('/admin/ai/configuration/')) {
    page = <AdminAIConfiguration />
  } else if (path === '/admin/api' || path.startsWith('/admin/api/')) {
    page = <AdminAPIWebhooks />
  } else if (path === '/admin/integrations' || path.startsWith('/admin/integrations/')) {
    page = <AdminIntegrations />
  } else if (path === '/admin/messaging' || path.startsWith('/admin/messaging/')) {
    page = <AdminMessagingPages />
  } else if (path === '/admin/error-logs' || path.startsWith('/admin/error-logs/')) {
    page = <AdminSystemLogs />
  } else if (path === '/admin/system-logs' || path.startsWith('/admin/system-logs/')) {
    page = <AdminSystemLogs />
  } else if (path === '/admin/tax' || path.startsWith('/admin/tax/')) {
    page = <AdminTaxCommission />
  } else if (path === '/admin/shipping' || path.startsWith('/admin/shipping/')) {
    page = <AdminShippingPages />
  } else if (path === '/admin/payment-settings' || path.startsWith('/admin/payment-settings/')) {
    page = <AdminPaymentSettings />
  } else if (path === '/admin/platform-settings' || path.startsWith('/admin/platform-settings/')) {
    page = <AdminPlatformSettings />
  } else if (path === '/admin/promotions') {
    page = <AdminMarketingPages type="promotions" />
  } else if (path === '/admin/promotions/new') {
    page = <AdminMarketingPages type="promotions" create />
  } else if (path === '/admin' || path.startsWith('/admin/')) {
    page = path === '/admin' ? <AdminDashboard /> : path === '/admin/analytics' ? <AdminAnalytics /> : path === '/admin/notifications' ? <AdminNotifications /> : path === '/admin/products' ? <AdminProducts /> : path === '/admin/categories' ? <AdminCategories /> : path === '/admin/brands' ? <AdminMarketplacePage type="brands" /> : path === '/admin/attributes' ? <AdminMarketplacePage type="attributes" /> : path === '/admin/inventory' ? <AdminMarketplacePage type="inventory" /> : path === '/admin/product-approvals' ? <AdminMarketplacePage type="approvals" /> : path === '/admin/product-reports' ? <AdminMarketplacePage type="reports" /> : path === '/admin/sellers' ? <AdminSellerPages type="sellers" /> : path.startsWith('/admin/sellers/') ? <AdminSellerPages detail /> : path === '/admin/seller-applications' ? <AdminSellerPages type="applications" /> : path === '/admin/verification' ? <AdminSellerPages type="verification" /> : path === '/admin/seller-performance' ? <AdminSellerPages type="performance" /> : path === '/admin/payouts' ? <AdminSellerPages type="payouts" /> : path === '/admin/customers' ? <AdminCustomerPages /> : path.startsWith('/admin/customers/') ? <AdminCustomerPages detail /> : path === '/admin/reviews' ? <AdminCustomerPages type="reviews" /> : path === '/admin/complaints' ? <AdminCustomerPages type="complaints" /> : path === '/admin/blocked-accounts' ? <AdminCustomerPages type="blocked" /> : path === '/admin/orders' ? <AdminOrderPages /> : path.startsWith('/admin/orders/') ? <AdminOrderPages detail mode="order" /> : path === '/admin/disputes' ? <AdminOrderPages type="disputes" /> : path.startsWith('/admin/disputes/') ? <AdminOrderPages detail mode="dispute" /> : path === '/admin/returns' ? <AdminOrderPages detail mode="return" /> : path.startsWith('/admin/returns/') ? <AdminOrderPages detail mode="return" /> : path === '/admin/refunds' ? <AdminOrderPages detail mode="refund" /> : path.startsWith('/admin/refunds/') ? <AdminOrderPages detail mode="refund" /> : path === '/admin/finances' ? <AdminFinancePages /> : path === '/admin/business-analytics' ? <AdminFinancePages type="business" /> : path === '/admin/marketplace-analytics' ? <AdminFinancePages type="marketplace" /> : path === '/admin/seller-analytics' ? <AdminFinancePages type="seller" /> : path === '/admin/customer-analytics' ? <AdminFinancePages type="customer" /> : path === '/admin/ai' ? <AdminAIPages type="overview" /> : path === '/admin/ai/queries' ? <AdminAIPages type="queries" /> : path === '/admin/ai/recommendations' ? <AdminAIPages type="recommendations" /> : path === '/admin/ai/comparisons' ? <AdminAIPages type="comparisons" /> : path === '/admin/ai/analytics' ? <AdminAIPages type="analytics" /> : path === '/admin/users' ? <AdminAdministrationPages type="users" /> : path === '/admin/roles' ? <AdminAdministrationPages type="roles" /> : path === '/admin/teams' ? <AdminAdministrationPages type="teams" /> : path === '/admin/access-control' ? <AdminAdministrationPages type="access" /> : path === '/admin/sessions' ? <AdminAdministrationPages type="sessions" /> : path === '/admin/activity' ? <AdminAdministrationPages type="activity" /> : path === '/admin/audit-logs' ? <AdminAdministrationPages type="audit" /> : path === '/admin/flash-sales' ? <AdminMarketingPages type="flash" /> : path === '/admin/flash-sales/new' ? <AdminMarketingPages type="flash" create /> : path === '/admin/banners' ? <AdminMarketingPages type="banners" /> : path === '/admin/banners/new' ? <AdminMarketingPages type="banners" create /> : path === '/admin/financial-sections' ? <AdminMarketingPages type="financial" /> : path === '/admin/financial-sections/new' ? <AdminMarketingPages type="financial" create /> : path === '/admin/campaigns' ? <AdminMarketingPages type="campaigns" /> : path === '/admin/campaigns/new' ? <AdminMarketingPages type="campaigns" create /> : path === '/admin/coupons' ? <AdminMarketingPages type="coupons" /> : path.startsWith('/admin/coupons/') ? <AdminMarketingPages type="coupons" detail /> : path === '/admin/stores' ? <AdminStorePages /> : path.startsWith('/admin/stores/') ? <AdminStorePages detail /> : path === '/admin/error' ? <AdminErrorPage /> : <AdminPage />
  } else if (path.startsWith('/seller/products/add')) {
    page = <AddProduct />
  } else if (path === '/seller/categories') {
    page = <CatalogPage type="categories" />
  } else if (path === '/seller/brands') {
    page = <CatalogPage type="brands" />
  } else if (path.match(/^\/seller\/products\/edit\/[^/]+/)) {
    page = <AddProduct editMode={true} productId={path.split('/').pop()} />
  } else if (path === '/seller/products/reviews') {
    page = <Reviews />
  } else if (path === '/seller/products' || path.startsWith('/seller/products')) {
    page = <Products />
  } else if (path === '/seller/finance' || path === '/seller/finance/overview') {
    page = <FinancePage type="overview" />
  } else if (path === '/seller/finance/withdrawals' || path === '/seller/withdrawals') {
    page = <FinancePage type="withdrawals" />
  } else if (path === '/seller/finance/settings' || path === '/seller/store/payments') {
    page = <FinancePage type="settings" />
  } else if (path === '/seller/store/profile') {
    page = <StoreProfile page="information" />
  } else if (['/seller/store/information', '/seller/store/business', '/seller/store/branding', '/seller/store/contact', '/seller/store/policies', '/seller/store/hours', '/seller/store/seo', '/seller/store/preview'].includes(path)) {
    page = <StoreProfile page={path.split('/').pop()} />
  } else if (path === '/seller/store/shipping') {
    page = <ShippingSettings page="zones" />
  } else if (['/seller/store/shipping/zones', '/seller/store/shipping/methods', '/seller/store/shipping/rates', '/seller/store/shipping/delivery', '/seller/store/shipping/package', '/seller/store/shipping/pickup', '/seller/store/shipping/providers', '/seller/store/shipping/tracking'].includes(path)) {
    page = <ShippingSettings page={path.split('/').pop()} />
  } else if (path === '/seller/store/settings' || path === '/seller/store/badges' || path === '/seller/store/social' || path === '/seller/store/bank') {
    page = <StoreSettings />
  } else if (path === '/seller/help') {
    page = <SellerHelpCenter />
  } else if (path === '/seller/notifications') {
    page = <SellerNotifications />
  } else if (path === '/seller/help/categories') {
    page = <SellerHelpCenter view="categories" />
  } else if (path === '/seller/help/categories/orders-shipments') {
    page = <SellerHelpCenter view="orders" />
  } else if (path === '/seller/help/videos') {
    page = <SellerHelpCenter view="videos" />
  } else if (path === '/seller/help/guides') {
    page = <SellerHelpCenter view="guides" />
  } else if (path.startsWith('/seller/help/guides/')) {
    page = <SellerHelpCenter view="guide-detail" />
  } else if (path.startsWith('/seller/help/articles/')) {
    page = <SellerHelpCenter view="article" />
  } else if (path === '/seller/help/faqs') {
    page = <SellerHelpCenter view="categories" />
  } else if (path === '/seller/support' || path === '/seller/support/categories' || path === '/seller/support/requests' || path === '/seller/support/create') {
    const viewMap = {
      '/seller/support': 'overview',
      '/seller/support/categories': 'categories',
      '/seller/support/requests': 'requests',
      '/seller/support/create': 'create',
    }
    page = <SellerSupport view={viewMap[path]} />
  } else if (path.match(/^\/seller\/support\/request\/[^/]+/)) {
    page = <SellerSupport view="detail" requestId={path.split('/').pop()} />
  } else if (path === '/seller/earnings') {
    page = <FinancePage type="overview" />
  } else if (path === '/seller/marketing' || path === '/seller/coupons') {
    page = <Marketing view="overview" />
  } else if (path === '/seller/marketing/promotions') {
    page = <Marketing view="promotions" />
  } else if (path === '/seller/marketing/promotions/create') {
    page = <Marketing view="create-promotion" />
  } else if (path === '/seller/marketing/discounts') {
    page = <Marketing view="discounts" />
  } else if (path === '/seller/marketing/discounts/create') {
    page = <Marketing view="create-discount" />
  } else if (path === '/seller/marketing/coupons') {
    page = <Marketing view="coupons" />
  } else if (path === '/seller/marketing/coupons/create') {
    page = <Marketing view="create-coupon" />
  } else if (path === '/seller/marketing/ads') {
    page = <Marketing view="ads" />
  } else if (path === '/seller/marketing/ads/create' || path === '/seller/marketing/campaigns/create') {
    page = <Marketing view="create-ads" />
  } else if (path === '/seller/marketing/campaigns') {
    page = <Marketing view="ads" />
  } else if (path === '/seller/marketing/recommendations') {
    page = <Marketing view="recommendations" />
  } else if (path === '/seller/marketing/performance') {
    page = <Marketing view="performance" />
  } else if (path === '/seller/reviews') {
    page = <Reviews />
  } else if (path === '/seller/customers') {
    page = <Customers />
  } else if (path.match(/^\/seller\/orders\/returns\/[^/]+/)) {
    page = <RequestDetails type="returns" requestId={path.split('/').pop()} />
  } else if (path.match(/^\/seller\/orders\/cancelled\/[^/]+/)) {
    page = <RequestDetails type="cancellations" requestId={path.split('/').pop()} />
  } else if (path === '/seller/orders/returns') {
    page = <ReturnsRefunds key="returns" type="returns" />
  } else if (path === '/seller/orders/cancelled') {
    page = <ReturnsRefunds key="cancellations" type="cancellations" />
  } else if (path === '/seller/orders' || path.startsWith('/seller/orders')) {
    page = <Orders />
  } else if (path === '/seller') {
    page = <Dashboard />
  } else if (path.startsWith('/seller/')) {
    page = <SellerNotFound />
  }
  // Regular Routes
  else if (path === '/login') {
    page = <AuthPage />
  } else if (path === '/register') {
    page = <AuthPage initialMode="signup" />
  } else if (path === '/blog') {
    page = <BlogPage cartCount={cartCount} />
  } else if (path === '/help-center') {
    page = <HelpCenterPage cartCount={cartCount} />
  } else if (path === '/about') {
    page = <AboutUsPage />
  } else if (accountPaths.includes(path)) {
    page = <AccountShell path={path} cartCount={cartCount} />
  } else if (path === '/checkout') {
    page = <CheckoutPage cartItems={cartItems} cartCount={cartCount} onOrderPlaced={orderPlaced} />
  } else if (path === '/cart') {
    page = <CartPage cartItems={cartItems} cartCount={cartCount} onChangeQuantity={changeQuantity} onRemove={removeFromCart} onAddToCart={addToCart} onCheckout={checkout} />
  } else if (path === '/deals') {
    page = <DealsPage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/compare') {
    page = <ComparePage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/orders') {
    page = <ProfileOrdersPage cartCount={cartCount} />
  } else if (['/track-orders', '/compare', '/addresses', '/payment-methods', '/notifications', '/security', '/logout'].includes(path)) {
    page = <AccountUtilityPage path={path} cartCount={cartCount} />
  } else if (['/my-chats', '/wishlist', '/recently-viewed', '/saved-searches', '/profile', '/settings'].includes(path)) {
    page = <AssistantRelatedPage path={path} cartCount={cartCount} />
  } else if (path === '/ai-assistant') {
    page = <AiAssistantPage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/sell-with-mirwal/apply') {
    page = <SellerFormPage />
  } else if (path === '/sell-with-mirwal') {
    page = <SellerPage />
  } else if (path === '/stores/awais-store' || path === '/store') {
    page = <StorePage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/explore' || path === '/products') {
    page = <ProductsPage key={location.search} cartCount={cartCount} onAddToCart={addToCart} />
  } else if (product) {
    page = <ProductPage product={product} cartCount={cartCount} onAddToCart={addToCart} />
  } else {
    page = <HomePage cartCount={cartCount} onAddToCart={addToCart} />
  }
  const isAdminPath = path === '/admin' || path.startsWith('/admin/')
  const showSiteChrome = !isAdminPath && !path.startsWith('/seller') && path !== '/login' && path !== '/register'
  const sellerActiveItem = path.startsWith('/seller/marketing') || path === '/seller/coupons' ? (path.includes('/promotions') ? 'promotions' : path.includes('/discounts') ? 'discounts' : path.includes('/coupons') || path === '/seller/coupons' ? 'coupons' : path.includes('/ads') || path.includes('/campaigns') ? 'ads' : path.includes('/recommendations') ? 'recommendations' : path.includes('/performance') ? 'performance' : 'marketing-overview') : path.startsWith('/seller/products') || ['/seller/categories', '/seller/brands', '/seller/reviews'].includes(path) ? (path.includes('/add') ? 'add-product' : path.includes('/categories') ? 'categories' : path.includes('/brands') ? 'brands' : path.includes('/reviews') ? 'reviews' : 'all-products') : path.startsWith('/seller/orders') ? (path.includes('/returns') ? 'returns' : path.includes('/cancelled') ? 'cancelled' : 'all-orders') : path.startsWith('/seller/finance') || path === '/seller/earnings' || path === '/seller/withdrawals' ? (path.includes('withdraw') ? 'withdrawals' : path.includes('settings') ? 'payment-methods' : 'overview') : path.startsWith('/seller/store') ? (path.includes('shipping') ? 'shipping-settings' : path.includes('settings') ? 'store-settings' : 'store-profile') : path === '/seller/help' ? 'support-page' : path.startsWith('/seller/support') ? 'seller-support' : 'dashboard'
  const sellerBreadcrumbLabels = { products: 'Products', add: 'Add Product', categories: 'Categories', brands: 'Brands', orders: 'Orders', returns: 'Returns & Refunds', cancelled: 'Cancellations', finance: 'Finance', withdrawals: 'Withdrawals', settings: 'Settings', store: 'Store', profile: 'Store Profile', shipping: 'Shipping Settings', marketing: 'Marketing', promotions: 'Promotions', discounts: 'Discounts', coupons: 'Coupons', ads: 'Ads Campaigns', recommendations: 'Marketing Recommendations', performance: 'Marketing Performance', help: 'Help Center', support: 'Seller Support' }
  const sellerBreadcrumbs = [{ label: 'Dashboard', onClick: () => navigateTo('/seller') }]
  if (path !== '/seller') {
    path.split('/').filter(Boolean).slice(1).forEach((segment) => { const label = sellerBreadcrumbLabels[segment]; if (label && sellerBreadcrumbs[sellerBreadcrumbs.length - 1].label !== label) sellerBreadcrumbs.push({ label }) })
  }
  const renderedPage = path === '/seller' ? page : path.startsWith('/seller') ? <SellerLayout activeItem={sellerActiveItem} breadcrumbs={sellerBreadcrumbs}>{page}</SellerLayout> : page
  return <SiteChromeContext.Provider value={showSiteChrome}><>{showSiteChrome && <Header cartCount={cartCount} showNav={path !== '/ai-assistant'} global />}{<div className={cartMessage ? 'cart-toast visible' : 'cart-toast'} role="status">✓ {cartMessage}</div>}{renderedPage}{showSiteChrome && path !== '/ai-assistant' && <Footer global />}{modal?.type === 'cart' && <AddToCartModal product={modal.product} onClose={() => setModal(null)} onViewCart={() => { setModal(null); navigateTo('/cart') }} />}{modal?.type === 'success' && <SuccessModal onClose={() => setModal(null)} onViewOrders={() => { setModal(null); navigateTo('/orders') }} />}</></SiteChromeContext.Provider>
}

export default App
