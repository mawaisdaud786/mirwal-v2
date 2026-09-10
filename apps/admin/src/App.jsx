import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Routes, Route, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PageErrorBoundary, LoadingState } from '@mirwal/shared/PageStates'
import { setRouterNavigate } from '@mirwal/shared/navigation'
import { AdminSessionProvider, useAdminSession } from './AdminSession'
import AdminLoginPage from './AdminLoginPage'
import AccessDeniedPage from './AccessDeniedPage'
import './app.css'

/**
 * Mirwal Admin application — admin.mirwal.pk.
 *
 * A separate application from the storefront and the seller portal, with its own build,
 * its own bundle and its own authentication namespace (`/admin/auth/*`). It imports no
 * customer pages and no seller pages: an admin who needs a product view gets an
 * admin-specific product screen, not the storefront's shopper-facing one.
 *
 * The guard below is UX only. Every admin API enforces authentication, the admin role and
 * per-permission checks server-side — see server/src/modules/admin and the admin auth
 * namespace, which refuses to issue a session at all to a non-admin account.
 */

// Admin pages are lazy-loaded — each wraps itself in AdminLayout internally, so no wrapper route is needed here.
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const AdminErrorPage = lazy(() => import('./pages/AdminErrorPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'))
const AdminProducts = lazy(() => import('./pages/AdminProducts'))
const AdminProductDetail = lazy(() => import('./pages/AdminProductDetail'))
const AdminCategories = lazy(() => import('./pages/AdminCategories'))
const AdminTaxonomyDetail = lazy(() => import('./pages/AdminTaxonomyDetail'))
const AdminMarketplacePage = lazy(() => import('./pages/AdminMarketplacePages'))
const AdminSellerPages = lazy(() => import('./pages/AdminSellerPages'))
const AdminApplications = lazy(() => import('./pages/AdminApplications'))
const AdminReviewModeration = lazy(() => import('./pages/AdminReviewModeration'))
const AdminCases = lazy(() => import('./pages/AdminCases'))
const AdminReturnDisputes = lazy(() => import('./pages/AdminReturnDisputes'))
const AdminCustomerPages = lazy(() => import('./pages/AdminCustomerPages'))
const AdminCustomerDetail = lazy(() => import('./pages/AdminCustomerDetail'))
const AdminOrderPages = lazy(() => import('./pages/AdminOrderPages'))
const AdminAIPages = lazy(() => import('./pages/AdminAIPages'))
const AdminFinancePages = lazy(() => import('./pages/AdminFinancePages'))
const AdminAdministrationPages = lazy(() => import('./pages/AdminAdministrationPages'))
const AdminMarketingPages = lazy(() => import('./pages/AdminMarketingPages'))
const AdminSettingsForm = lazy(() => import('./pages/AdminSettingsForm'))
const AdminSupportQueue = lazy(() => import('./pages/AdminSupportQueue'))
const AdminPayouts = lazy(() => import('./pages/AdminPayouts'))
const AdminOperationsPages = lazy(() => import('./pages/AdminOperationsPages'))
const AdminVerification = lazy(() => import('./pages/AdminVerification'))
const AdminShippingPages = lazy(() => import('./pages/AdminShippingPages'))
const AdminMessagingPages = lazy(() => import('./pages/AdminMessagingPages'))
const AdminIntegrations = lazy(() => import('./pages/AdminIntegrations'))
const AdminFulfilmentPages = lazy(() => import('./pages/AdminFulfilmentPages'))
const AdminPlatformPages = lazy(() => import('./pages/AdminPlatformPages'))
const AdminSecurityPages = lazy(() => import('./pages/AdminSecurityPages'))
const AdminStorePages = lazy(() => import('./pages/AdminStorePages'))


function AdminGuard() {
  const location = useLocation()
  const { user, isLoading } = useAdminSession()
  if (isLoading) return <LoadingState label="Checking your session" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // The admin auth endpoint only issues sessions to admins, so reaching this with a
  // non-admin user means something is wrong rather than merely unauthorised.
  if (!user.roles?.some((role) => role === 'admin' || role === 'super_admin')) return <AccessDeniedPage />
  return <Outlet />
}

function AdminApp() {
  const routerNavigate = useNavigate()
  useEffect(() => setRouterNavigate(routerNavigate), [routerNavigate])

  return (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingState />}>
        <AdminSessionProvider>
          <Routes>
            <Route path="/login" element={<AdminLoginPage />} />
            <Route element={<AdminGuard />}>
      {/* ADMIN */}
      <Route path="/" element={<AdminDashboard />} />
      <Route path="/analytics" element={<AdminAnalytics />} />
      <Route path="/notifications" element={<AdminOperationsPages view="notifications" />} />
      <Route path="/notifications/*" element={<AdminSettingsForm category="notifications" />} />
      <Route path="/settings" element={<AdminSettingsForm category="all" />} />
      <Route path="/settings/*" element={<AdminSettingsForm category="all" />} />
      <Route path="/security" element={<AdminSecurityPages />} />
      <Route path="/security/*" element={<AdminSecurityPages />} />
      <Route path="/search" element={<AdminSettingsForm category="search" />} />
      <Route path="/search/*" element={<AdminSettingsForm category="search" />} />
      <Route path="/ai/configuration" element={<AdminSettingsForm category="ai" />} />
      <Route path="/ai/configuration/*" element={<AdminSettingsForm category="ai" />} />
      <Route path="/api" element={<AdminIntegrations view="webhooks" />} />
      <Route path="/api/*" element={<AdminIntegrations view="webhooks" />} />
      <Route path="/integrations" element={<AdminIntegrations />} />
      <Route path="/integrations/*" element={<AdminIntegrations />} />
      <Route path="/messaging" element={<AdminMessagingPages />} />
      <Route path="/messaging/*" element={<AdminMessagingPages />} />
      <Route path="/error-logs" element={<AdminOperationsPages view="logs" />} />
      <Route path="/error-logs/*" element={<AdminOperationsPages view="logs" />} />
      <Route path="/system-logs" element={<AdminOperationsPages view="logs" />} />
      <Route path="/system-logs/*" element={<AdminOperationsPages view="logs" />} />
      <Route path="/tax" element={<AdminSettingsForm category="tax" />} />
      <Route path="/tax/*" element={<AdminSettingsForm category="tax" />} />
      <Route path="/shipping" element={<AdminShippingPages />} />
      <Route path="/shipping/*" element={<AdminShippingPages />} />
      <Route path="/payment-settings" element={<AdminSettingsForm category="payments" />} />
      <Route path="/payment-settings/*" element={<AdminSettingsForm category="payments" />} />
      <Route path="/platform-settings" element={<AdminSettingsForm category="all" />} />
      <Route path="/platform-settings/*" element={<AdminSettingsForm category="all" />} />
      <Route path="/promotions" element={<AdminMarketingPages type="promotions" />} />
      <Route path="/promotions/new" element={<AdminMarketingPages type="promotions" create />} />
      <Route path="/promotions/:id" element={<AdminMarketingPages type="promotions" create />} />
      <Route path="/products" element={<AdminProducts />} />
      <Route path="/products/new" element={<AdminProducts create />} />
      <Route path="/products/:id" element={<AdminProductDetail />} />
      <Route path="/categories" element={<AdminCategories />} />
      <Route path="/categories/new" element={<AdminCategories create />} />
      <Route path="/categories/:slug" element={<AdminTaxonomyDetail kind="categories" />} />
      <Route path="/brands" element={<AdminMarketplacePage type="brands" />} />
      <Route path="/brands/:slug" element={<AdminTaxonomyDetail kind="brands" />} />
      <Route path="/attributes" element={<AdminOperationsPages view="attributes" />} />
      <Route path="/inventory" element={<AdminMarketplacePage type="inventory" />} />
      <Route path="/product-approvals" element={<AdminMarketplacePage type="approvals" />} />
      <Route path="/product-reports" element={<AdminOperationsPages view="reports" />} />
      <Route path="/sellers" element={<AdminSellerPages type="sellers" />} />
      <Route path="/sellers/*" element={<AdminSellerPages detail />} />
      {/* Applications are their own resource now: a store is created *by* an approval, so the
          old `GET /sellers?status=pending` queue could only ever be empty in production. */}
      <Route path="/seller-applications" element={<AdminApplications />} />
      <Route path="/verification" element={<AdminVerification />} />
      <Route path="/seller-performance" element={<AdminOperationsPages view="performance" />} />
      <Route path="/payouts" element={<AdminPayouts />} />
      <Route path="/customers" element={<AdminCustomerPages />} />
      <Route path="/customers/:id" element={<AdminCustomerDetail />} />
      {/* Was a read-only list: a review had no status, so a defamatory or fake one could
          not be taken down at all. */}
      <Route path="/reviews" element={<AdminReviewModeration />} />
      {/* The support queue: the staff side of the tickets sellers and customers open. */}
      <Route path="/complaints" element={<AdminSupportQueue />} />
      <Route path="/support" element={<AdminSupportQueue />} />
      <Route path="/support/*" element={<AdminSupportQueue />} />
      <Route path="/blocked-accounts" element={<AdminOperationsPages view="blocked" />} />
      <Route path="/orders" element={<AdminOrderPages />} />
      <Route path="/orders/*" element={<AdminOrderPages detail mode="order" />} />
      {/* Was a read-only SELECT over return requests with no action on it. Cases are where
          product, seller, counterfeit and payment reports now land. */}
      <Route path="/cases" element={<AdminCases />} />
      {/* Distinct from the read-only /disputes overview: this is where Mirwal actually decides. */}
      <Route path="/return-disputes" element={<AdminReturnDisputes />} />
      <Route path="/disputes" element={<AdminOrderPages type="disputes" />} />
      <Route path="/disputes/*" element={<AdminFulfilmentPages detail />} />
      <Route path="/returns" element={<AdminFulfilmentPages view="returns" />} />
      <Route path="/refunds" element={<AdminFulfilmentPages view="refunds" />} />
      <Route path="/finances" element={<AdminFinancePages />} />
      <Route path="/business-analytics" element={<AdminFinancePages type="business" />} />
      <Route path="/marketplace-analytics" element={<AdminFinancePages type="marketplace" />} />
      <Route path="/seller-analytics" element={<AdminFinancePages type="seller" />} />
      <Route path="/customer-analytics" element={<AdminFinancePages type="customer" />} />
      <Route path="/ai" element={<AdminAIPages type="overview" />} />
      <Route path="/ai/queries" element={<AdminAIPages type="queries" />} />
      <Route path="/ai/recommendations" element={<AdminAIPages type="recommendations" />} />
      <Route path="/ai/comparisons" element={<AdminAIPages type="comparisons" />} />
      <Route path="/ai/analytics" element={<AdminAIPages type="analytics" />} />
      <Route path="/users" element={<AdminAdministrationPages type="users" />} />
      <Route path="/roles" element={<AdminAdministrationPages type="roles" />} />
      <Route path="/teams" element={<AdminAdministrationPages type="teams" />} />
      <Route path="/access-control" element={<AdminAdministrationPages type="access" />} />
      <Route path="/sessions" element={<AdminAdministrationPages type="sessions" />} />
      <Route path="/activity" element={<AdminAdministrationPages type="activity" />} />
      <Route path="/audit-logs" element={<AdminAdministrationPages type="audit" />} />
      <Route path="/flash-sales" element={<AdminMarketingPages type="flash" />} />
      <Route path="/flash-sales/new" element={<AdminMarketingPages type="flash" create />} />
      <Route path="/banners" element={<AdminMarketingPages type="banners" />} />
      <Route path="/banners/new" element={<AdminMarketingPages type="banners" create />} />
      {/* "Financial Sections" never described anything the marketplace stores. The real
          revenue figures live on Finances, so the link goes there rather than to a page
          whose only content is an apology. */}
      <Route path="/financial-sections" element={<Navigate to="/finances" replace />} />
      <Route path="/financial-sections/*" element={<Navigate to="/finances" replace />} />
      <Route path="/campaigns" element={<AdminMarketingPages type="campaigns" />} />
      <Route path="/campaigns/new" element={<AdminMarketingPages type="campaigns" create />} />
      <Route path="/coupons" element={<AdminMarketingPages type="coupons" />} />
      <Route path="/coupons/*" element={<AdminMarketingPages type="coupons" detail />} />
      <Route path="/stores" element={<AdminStorePages />} />
      <Route path="/stores/*" element={<AdminStorePages detail />} />
      <Route path="/store-applications" element={<AdminApplications />} />
      <Route path="/maintenance" element={<AdminPlatformPages view="maintenance" />} />
      <Route path="/maintenance/*" element={<AdminPlatformPages view="maintenance" />} />
      <Route path="/backup" element={<AdminPlatformPages view="backup" />} />
      <Route path="/backup/*" element={<AdminPlatformPages view="backup" />} />
      <Route path="/error" element={<AdminErrorPage />} />
      <Route path="/*" element={<AdminPage />} />
            </Route>
          </Routes>
        </AdminSessionProvider>
      </Suspense>
    </PageErrorBoundary>
  )
}

export default AdminApp
