import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Routes, Route, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { PageErrorBoundary, LoadingState } from '@mirwal/shared/PageStates'
import { navigateTo, setRouterNavigate } from '@mirwal/shared/navigation'
import { SellerSessionProvider, useSellerSession } from './SellerSession'
import SellerLoginPage from './SellerLoginPage'
import SellerAccessDeniedPage from './SellerAccessDeniedPage'
import SellerLayout from './SellerLayout'
import './app.css'

/**
 * Mirwal Seller application — seller.mirwal.pk.
 *
 * Independent of both the storefront and the admin panel: its own build, its own bundle, its
 * own authentication namespace (`/seller/auth/*`). It imports no customer pages and no admin
 * pages — where a seller needs to preview a product or read an order, it uses a seller-owned
 * screen backed by seller-scoped endpoints.
 *
 * The guard below is UX only. Every seller API enforces authentication, the seller role AND
 * per-row ownership server-side (`WHERE seller_id = req.seller.id`), so one seller can never
 * read another's data regardless of what the client sends.
 */

// Seller pages are lazy-loaded — SellerLayout is applied by SellerRouteLayout below.
const SellerDashboard = lazy(() => import('./pages/Dashboard'))
const SellerOrders = lazy(() => import('./pages/Orders'))
const SellerProducts = lazy(() => import('./pages/Products'))
const SellerAddProduct = lazy(() => import('./pages/AddProduct'))
const SellerFinancePage = lazy(() => import('./pages/FinancePage'))
const SellerStoreProfile = lazy(() => import('./pages/StoreProfile'))
const SellerStoreSettings = lazy(() => import('./pages/StoreSettings'))
const SellerVerification = lazy(() => import('./pages/Verification'))
const SellerShippingSettings = lazy(() => import('./pages/ShippingSettings'))
const SellerSecuritySettings = lazy(() => import('./pages/SecuritySettings'))
const SellerHelpCenter = lazy(() => import('./pages/SellerHelpCenter'))
const SellerSupport = lazy(() => import('./pages/SellerSupport'))
const SellerNotFound = lazy(() => import('./pages/SellerNotFound'))
const SellerMarketing = lazy(() => import('./pages/Marketing'))
const SellerReviews = lazy(() => import('./pages/Reviews'))
const SellerReturnsRefunds = lazy(() => import('./pages/ReturnsRefunds'))
const SellerRequestDetails = lazy(() => import('./pages/RequestDetails'))
const SellerCustomers = lazy(() => import('./pages/Customers'))
const SellerCatalogPage = lazy(() => import('./pages/CatalogPage'))
const SellerPerformance = lazy(() => import('./pages/Performance'))
const SellerNotifications = lazy(() => import('./pages/SellerNotifications'))

const sellerBreadcrumbLabels = { products: 'Products', add: 'Add Product', categories: 'Categories', brands: 'Brands', orders: 'Orders', returns: 'Returns & Refunds', cancelled: 'Cancellations', finance: 'Finance', withdrawals: 'Withdrawals', settings: 'Settings', store: 'Store', profile: 'Store Profile', shipping: 'Shipping Settings', marketing: 'Marketing', promotions: 'Promotions', discounts: 'Discounts', coupons: 'Coupons', ads: 'Ads Campaigns', recommendations: 'Marketing Recommendations', performance: 'Marketing Performance', help: 'Help Center', support: 'Seller Support' }

function SellerRouteLayout() {
  const { pathname: path } = useLocation()
  // Checked before the marketing branch, which also owns a path ending in `/performance`.
  const sellerActiveItem = path === '/performance'
    ? 'performance-page'
    : path.startsWith('/marketing') || path === '/coupons'
    ? (path.includes('/promotions') ? 'promotions' : path.includes('/discounts') ? 'discounts' : path.includes('/coupons') || path === '/coupons' ? 'coupons' : path.includes('/ads') || path.includes('/campaigns') ? 'ads' : path.includes('/recommendations') ? 'recommendations' : path.includes('/performance') ? 'performance' : 'marketing-overview')
    : path.startsWith('/products') || ['/categories', '/brands', '/reviews'].includes(path)
    ? (path.includes('/add') ? 'add-product' : path.includes('/categories') ? 'categories' : path.includes('/brands') ? 'brands' : path.includes('/reviews') ? 'reviews' : 'all-products')
    : path.startsWith('/orders')
    ? (path.includes('/returns') ? 'returns' : path.includes('/cancelled') ? 'cancelled' : 'all-orders')
    : path.startsWith('/finance') || path === '/earnings' || path === '/withdrawals'
    ? (path.includes('withdraw') ? 'withdrawals' : path.includes('settings') ? 'payment-methods' : 'overview')
    : path.startsWith('/store')
    ? (path.includes('shipping') ? 'shipping-settings' : path.includes('settings') ? 'store-settings' : 'store-profile')
    : path === '/help' ? 'support-page'
    : path.startsWith('/support') ? 'seller-support'
    : 'dashboard'
  const sellerBreadcrumbs = [{ label: 'Dashboard', onClick: () => navigateTo('/') }]
  // The labels are keyed by path segment, and `performance` belongs to two different pages —
  // the store's own scorecard and the marketing report. The store one wins at the top level.
  if (path === '/performance') sellerBreadcrumbs.push({ label: 'Performance' })
  else {
    path.split('/').filter(Boolean).forEach((segment) => {
      const label = sellerBreadcrumbLabels[segment]
      if (label && sellerBreadcrumbs[sellerBreadcrumbs.length - 1].label !== label) sellerBreadcrumbs.push({ label })
    })
  }
  return <SellerLayout activeItem={sellerActiveItem} breadcrumbs={sellerBreadcrumbs}><Outlet /></SellerLayout>
}

function SellerAddProductEditRoute() {
  const { id } = useParams()
  return <SellerAddProduct editMode productId={id} />
}
function SellerSupportDetailRoute() {
  const { id } = useParams()
  return <SellerSupport view="detail" requestId={id} />
}
function SellerReturnsDetailRoute() {
  const { id } = useParams()
  return <SellerRequestDetails type="returns" requestId={id} />
}
function SellerCancelledDetailRoute() {
  const { id } = useParams()
  return <SellerRequestDetails type="cancellations" requestId={id} />
}


function SellerGuard() {
  const location = useLocation()
  const { user, isLoading } = useSellerSession()
  if (isLoading) return <LoadingState label="Checking your session" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!user.roles?.includes('seller')) return <SellerAccessDeniedPage />
  return <Outlet />
}

function SellerApp() {
  const routerNavigate = useNavigate()
  useEffect(() => setRouterNavigate(routerNavigate), [routerNavigate])

  return (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingState />}>
        <SellerSessionProvider>
          <Routes>
            <Route path="/login" element={<SellerLoginPage />} />
            <Route element={<SellerGuard />}>
              <Route path="/" element={<SellerDashboard />} />
              <Route element={<SellerRouteLayout />}>
        <Route path="/products/add" element={<SellerAddProduct />} />
        <Route path="/categories" element={<SellerCatalogPage type="categories" />} />
        <Route path="/brands" element={<SellerCatalogPage type="brands" />} />
        <Route path="/products/edit/:id" element={<SellerAddProductEditRoute />} />
        <Route path="/products/reviews" element={<SellerReviews />} />
        <Route path="/products" element={<SellerProducts />} />
        <Route path="/products/*" element={<SellerProducts />} />
        <Route path="/finance" element={<SellerFinancePage type="overview" />} />
        <Route path="/finance/overview" element={<SellerFinancePage type="overview" />} />
        <Route path="/finance/withdrawals" element={<SellerFinancePage type="withdrawals" />} />
        <Route path="/withdrawals" element={<SellerFinancePage type="withdrawals" />} />
        <Route path="/finance/settings" element={<SellerFinancePage type="settings" />} />
        <Route path="/store/payments" element={<SellerFinancePage type="settings" />} />
        <Route path="/performance" element={<SellerPerformance />} />
        <Route path="/store/verification" element={<SellerVerification />} />
        <Route path="/verification" element={<SellerVerification />} />
        <Route path="/store/profile" element={<SellerStoreProfile page="information" />} />
        <Route path="/store/information" element={<SellerStoreProfile page="information" />} />
        <Route path="/store/business" element={<SellerStoreProfile page="business" />} />
        <Route path="/store/branding" element={<SellerStoreProfile page="branding" />} />
        <Route path="/store/contact" element={<SellerStoreProfile page="contact" />} />
        <Route path="/store/policies" element={<SellerStoreProfile page="policies" />} />
        <Route path="/store/hours" element={<SellerStoreProfile page="hours" />} />
        <Route path="/store/seo" element={<SellerStoreProfile page="seo" />} />
        <Route path="/store/preview" element={<SellerStoreProfile page="preview" />} />
        {/* Delivery rates are set once for the whole marketplace, so there are no per-seller
            zone/method/rate/provider screens to route — one read-only page covers it. */}
        <Route path="/store/shipping" element={<SellerShippingSettings />} />
        <Route path="/store/shipping/*" element={<SellerShippingSettings />} />

        <Route path="/account/security" element={<SellerSecuritySettings />} />
        <Route path="/store/settings" element={<SellerStoreSettings />} />
        <Route path="/store/badges" element={<SellerStoreSettings />} />
        <Route path="/store/social" element={<SellerStoreSettings />} />
        <Route path="/store/bank" element={<SellerStoreSettings />} />
        <Route path="/help" element={<SellerHelpCenter />} />
        <Route path="/notifications" element={<SellerNotifications />} />
        <Route path="/help/categories" element={<SellerHelpCenter view="categories" />} />
        <Route path="/help/categories/orders-shipments" element={<SellerHelpCenter view="orders" />} />
        <Route path="/help/videos" element={<SellerHelpCenter view="videos" />} />
        <Route path="/help/guides" element={<SellerHelpCenter view="guides" />} />
        <Route path="/help/guides/*" element={<SellerHelpCenter view="guide-detail" />} />
        <Route path="/help/articles/*" element={<SellerHelpCenter view="article" />} />
        <Route path="/help/faqs" element={<SellerHelpCenter view="categories" />} />
        <Route path="/support" element={<SellerSupport view="overview" />} />
        <Route path="/support/categories" element={<SellerSupport view="categories" />} />
        <Route path="/support/requests" element={<SellerSupport view="requests" />} />
        <Route path="/support/create" element={<SellerSupport view="create" />} />
        <Route path="/support/request/:id" element={<SellerSupportDetailRoute />} />
        <Route path="/earnings" element={<SellerFinancePage type="overview" />} />
        <Route path="/marketing" element={<SellerMarketing view="overview" />} />
        <Route path="/coupons" element={<SellerMarketing view="coupons" />} />
        <Route path="/marketing/promotions" element={<SellerMarketing view="promotions" />} />
        <Route path="/marketing/promotions/create" element={<SellerMarketing view="create-promotion" />} />
        {/* Reuses the create view — it already tells create and edit apart by whether the third
            path segment is an id or the literal word "create". React Router ranks the static
            "create" segment above this param regardless of declaration order, so the two never
            collide. */}
        <Route path="/marketing/promotions/:id" element={<SellerMarketing view="create-promotion" />} />
        {/* A storewide discount IS a promotion here — one concept, one screen. The links
            redirect rather than showing a page whose only job is to say so. */}
        <Route path="/marketing/discounts" element={<Navigate to="/marketing/promotions" replace />} />
        <Route path="/marketing/discounts/create" element={<Navigate to="/marketing/promotions/create" replace />} />
        <Route path="/marketing/coupons" element={<SellerMarketing view="coupons" />} />
        <Route path="/marketing/coupons/create" element={<SellerMarketing view="create-coupon" />} />
        <Route path="/marketing/coupons/:id" element={<SellerMarketing view="create-coupon" />} />
        <Route path="/marketing/ads" element={<SellerMarketing view="ads" />} />
        <Route path="/marketing/ads/create" element={<SellerMarketing view="create-ads" />} />
        <Route path="/marketing/campaigns/create" element={<SellerMarketing view="create-ads" />} />
        <Route path="/marketing/campaigns" element={<SellerMarketing view="ads" />} />
        {/* "What should I promote?" is answered by what already sells — which is Performance. */}
        <Route path="/marketing/recommendations" element={<Navigate to="/marketing/performance" replace />} />
        <Route path="/marketing/performance" element={<SellerMarketing view="performance" />} />
        <Route path="/reviews" element={<SellerReviews />} />
        <Route path="/customers" element={<SellerCustomers />} />
        <Route path="/orders/returns/:id" element={<SellerReturnsDetailRoute />} />
        <Route path="/orders/cancelled/:id" element={<SellerCancelledDetailRoute />} />
        <Route path="/orders/returns" element={<SellerReturnsRefunds key="returns" type="returns" />} />
        <Route path="/orders/cancelled" element={<SellerReturnsRefunds key="cancellations" type="cancellations" />} />
        <Route path="/orders" element={<SellerOrders />} />
        <Route path="/orders/*" element={<SellerOrders />} />
        <Route path="/*" element={<SellerNotFound />} />
              </Route>
            </Route>
          </Routes>
        </SellerSessionProvider>
      </Suspense>
    </PageErrorBoundary>
  )
}

export default SellerApp
