import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Routes, Route, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import './App.css'
import { ErrorState, LoadingState, PageErrorBoundary } from '@mirwal/shared/PageStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'
import { toCartItem } from '@mirwal/shared/money'
import { AddToCartModal } from './components/MirwalModals'
import { navigateTo, setRouterNavigate, SiteChromeContext } from '@mirwal/shared/navigation'
import Header from './components/Header'
import RouteMeta from './components/RouteMeta'
import ScrollToTop from './components/ScrollToTop'
import MobileBottomNav from './components/MobileBottomNav'
import Footer from './components/Footer'
import { ComparisonProvider } from './components/ComparisonContext'
import { SessionProvider } from './components/SessionContext'
import { WishlistProvider } from './components/WishlistContext'
import { useSession } from './components/useSession'
import { RECENT_PRODUCTS_KEY } from './lib/recommendations'

// Public/customer pages are lazy-loaded — the same reason as admin/seller below: this was
// ~25 page components (including PayPage, which pulls in the Stripe SDK) bundled eagerly
// into the one chunk every visitor downloaded before rendering anything, regardless of which
// single page they'd actually landed on. The Suspense boundary already wraps the whole
// <Routes> tree (see the bottom of this file), so no new fallback plumbing was needed.
const HomePage = lazy(() => import('./HomePage'))
const ProductPage = lazy(() => import('./ProductPage'))
const CartPage = lazy(() => import('./CartPage'))
const CheckoutPage = lazy(() => import('./CheckoutPage'))
const AuthPage = lazy(() => import('./AuthPage'))
const ResetPasswordPage = lazy(() => import('./ResetPasswordPage'))
const DealsPage = lazy(() => import('./DealsPage'))
const ComparePage = lazy(() => import('./ComparePage'))
const StorePage = lazy(() => import('./StorePage'))
const SellerPages = lazy(() => import('./SellerPages'))
const SellerPage = lazy(() => import('./SellerPage'))
const SellerFormPage = lazy(() => import('./SellerFormPage'))
const AiAssistantPage = lazy(() => import('./AiAssistantPage'))
const AccountShell = lazy(() => import('./AccountShell'))
const GuidesPage = lazy(() => import('./GuidesPage'))
const ShoppingIntentPage = lazy(() => import('./ShoppingIntentPage'))
const ProductListingPage = lazy(() => import('./ProductListingPage'))
const OrderConfirmationPage = lazy(() => import('./OrderConfirmationPage'))
const PayPage = lazy(() => import('./PayPage'))
const ContentPage = lazy(() => import('./ContentPage'))
const HelpCenterPage = lazy(() => import('./HelpCenterPage'))
const AboutUsPage = lazy(() => import('./AboutUsPage'))
const DiscoveryPage = lazy(() => import('./DiscoveryPage'))
const CategoriesPage = lazy(() => import('./CategoriesPage'))
const NotFoundPage = lazy(() => import('./NotFoundPage'))
const ExploreWorkspace = lazy(() => import('./ExplorePage'))
// Named exports: lazy() only takes a `{ default }`, so each is wrapped separately even
// though both come from the same TrustPage.jsx chunk.
const TrustRoute = lazy(() => import('./TrustPage').then((m) => ({ default: m.TrustRoute })))
const ReportPage = lazy(() => import('./TrustPage').then((m) => ({ default: m.ReportPage })))
const DealPage = lazy(() => import('./DealPage'))


function PageLoading() {
  return <LoadingState />
}

function PrivateAccountRoute({ path, cartCount, onAddToCart }) {
  const { user, isLoading, hasRole } = useSession()
  if (isLoading) return <LoadingState />
  if (!user) return <Navigate to="/login" replace state={{ from: path }} />
  return hasRole('customer') ? <AccountShell path={path} cartCount={cartCount} onAddToCart={onAddToCart} /> : <Navigate to="/404" replace />
}

function RequireRole({ role }) {
  const location = useLocation()
  const { user, isLoading, hasRole } = useSession()
  if (isLoading) return <LoadingState />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return hasRole(role) ? <Outlet /> : <Navigate to="/404" replace />
}

const accountPaths = ['/my-chats', '/profile', '/orders', '/track-orders', '/wishlist', '/recently-viewed', '/saved-searches', '/addresses', '/payment-methods', '/notifications', '/security', '/settings', '/logout']

function ProductPageRoute({ cartCount, onAddToCart }) {
  const { id, productSlug } = useParams()
  const slug = id || productSlug
  // Loads from the Mirwal API. Previously this looked the product up in a hard-coded
  // array, so every price, rating and seller on the page was a literal in the bundle.
  const { data: product, error, isLoading } = useApiQuery(
    (signal) => api.products.get(slug, signal),
    [slug],
  )

  if (isLoading) return <LoadingState label="Loading product" />
  if (error?.code === 'PRODUCT_NOT_FOUND') return <NotFoundPage />
  if (error) return <ErrorState title="We could not load this product" description={describeApiError(error)} />
  return <ProductPage product={product} cartCount={cartCount} onAddToCart={onAddToCart} />
}

function ExploreRoute({ cartCount, onAddToCart }) {
  return <ExploreWorkspace cartCount={cartCount} onAddToCart={onAddToCart} />
}

function PublicLayout({ cartCount, showNav = true, showFooter = true }) {
  return <SiteChromeContext.Provider value={true}>
    <Header cartCount={cartCount} showNav={showNav} global />
    <Outlet />
    {showFooter && <Footer global />}
    {/* Previously only rendered on HomePage, so every other storefront page fell back to
        the desktop header nav on a small screen. Tied to the same `showNav` flag as the
        header's own nav — a page that opts out of top navigation (e.g. the focused
        AI-assistant view) opts out of the bottom tab bar too, for the same reason. */}
    {showNav && <MobileBottomNav />}
  </SiteChromeContext.Provider>
}

function NoChromeLayout() {
  return <SiteChromeContext.Provider value={false}><Outlet /></SiteChromeContext.Provider>
}

const CART_STORAGE_KEY = 'mirwal-cart'
const COMPARISON_STORAGE_KEY = 'mirwal-comparison-v2'

/**
 * Wipes everything the previous shopper left in this browser when they sign out.
 *
 * The cart, comparison tray and recently-viewed list are all per-browser, not per-account —
 * they were surviving a logout entirely, so on a shared device the next person inherited the
 * last person's cart and browsing history. Signing out now clears them, in both React state
 * and storage. The wishlist needs no entry here: it lives on the server and WishlistContext
 * drops it the moment there is no session.
 *
 * Fires only on a real signed-in -> signed-out transition. On first load `user` is briefly
 * null while restoreSession() is still in flight, and clearing then would delete a returning
 * visitor's cart on every page load.
 */
function SessionCleanup({ onSignOut }) {
  const { user, isLoading } = useSession()
  const wasSignedIn = useRef(false)

  useEffect(() => {
    if (isLoading) return
    if (user) { wasSignedIn.current = true; return }
    if (!wasSignedIn.current) return
    wasSignedIn.current = false
    onSignOut()
    try {
      localStorage.removeItem(CART_STORAGE_KEY)
      localStorage.removeItem(RECENT_PRODUCTS_KEY)
      sessionStorage.removeItem(COMPARISON_STORAGE_KEY)
    } catch { /* storage unavailable — in-memory state is already cleared */ }
  }, [user, isLoading, onSignOut])

  return null
}

/** The cart is a client-side draft only — checkout re-prices and re-validates everything
 * server-side, so nothing here needs to be trusted. Persisting it is purely so a shopper
 * doesn't lose their cart on a refresh; it previously reset to empty on every page load. */
function loadStoredCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function App() {
  const routerNavigate = useNavigate()
  const [cartItems, setCartItems] = useState(loadStoredCart)
  const [cartMessage, setCartMessage] = useState('')
  const [modal, setModal] = useState(null)

  useEffect(() => setRouterNavigate(routerNavigate), [routerNavigate])

  useEffect(() => {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems)) } catch { /* storage unavailable */ }
  }, [cartItems])

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0)
  // Normalises both the API product shape and the remaining legacy mock shape into one
  // canonical cart item, so the cart never has to parse a display string. See lib/money.js.
  const addToCart = (item, quantity = 1) => {
    const cartItem = toCartItem(item, quantity)
    setCartItems((items) => items.some((existing) => existing.id === cartItem.id)
      ? items.map((existing) => existing.id === cartItem.id ? { ...existing, quantity: existing.quantity + quantity } : existing)
      : [...items, cartItem])
    setCartMessage(`${cartItem.name} added to cart`)
    setModal({ type: 'cart', product: cartItem })
    window.setTimeout(() => setCartMessage(''), 2400)
  }
  const changeQuantity = (id, quantity) => setCartItems((items) => items.map((item) => item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item))
  const removeFromCart = (id) => setCartItems((items) => items.filter((item) => item.id !== id))
  const checkout = () => navigateTo('/checkout')
  const clearCart = () => setCartItems([])
  const handleSignOut = useCallback(() => { setCartItems([]); setModal(null) }, [])
  return <>
    <div className={cartMessage ? 'cart-toast visible' : 'cart-toast'} role="status">✓ {cartMessage}</div>
    <PageErrorBoundary><Suspense fallback={<PageLoading />}><SessionProvider><WishlistProvider><ComparisonProvider>
      <SessionCleanup onSignOut={handleSignOut} />
      {/* Writes the route's default <head> metadata. Must stay ahead of <Routes> so a page's
          own <SEOHead> effect runs afterwards and its more specific values win. */}
      <RouteMeta />
      <ScrollToTop />
      <Routes>
        {/* NO CHROME */}
        <Route element={<NoChromeLayout />}>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage initialMode="signup" />} />
          {/* Reached from the emailed link; the token travels in the query string. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        {/* AI ASSISTANT — header without nav, no footer */}
        <Route element={<PublicLayout cartCount={cartCount} showNav={false} showFooter={false} />}>
          <Route path="/ai-assistant" element={<AiAssistantPage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/ai-shopping" element={<AiAssistantPage cartCount={cartCount} onAddToCart={addToCart} />} />
        </Route>

        {/* PUBLIC — full chrome */}
        <Route element={<PublicLayout cartCount={cartCount} />}>
          <Route path="/" element={<HomePage cartCount={cartCount} cartItems={cartItems} onAddToCart={addToCart} />} />
          <Route path="/blog" element={<GuidesPage />} />
          <Route path="/guides" element={<GuidesPage />} />
          <Route path="/guides/:guideSlug" element={<GuidesPage />} />
          <Route path="/shopping/:intentSlug" element={<ShoppingIntentPage />} />
          <Route path="/new-arrivals" element={<ExploreWorkspace newArrivals cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/featured" element={<ProductListingPage variant="featured" cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route element={<RequireRole role="customer" />}>
            <Route path="/order-success/:orderId" element={<OrderConfirmationPage cartCount={cartCount} />} />
            <Route path="/pay/:orderId" element={<PayPage cartCount={cartCount} />} />
            <Route path="/checkout" element={<CheckoutPage cartItems={cartItems} cartCount={cartCount} onOrderPlaced={clearCart} />} />
          </Route>
          <Route path="/help-center" element={<HelpCenterPage cartCount={cartCount} />} />
          <Route path="/about" element={<AboutUsPage />} />
          <Route path="/contact" element={<TrustRoute pageKey="contact" />} />
          <Route path="/faq" element={<TrustRoute pageKey="faq" />} />
          <Route path="/shipping" element={<TrustRoute pageKey="shipping" />} />
          <Route path="/returns" element={<ContentPage page="returns" />} />
          <Route path="/privacy" element={<TrustRoute pageKey="privacy" />} />
          <Route path="/terms" element={<TrustRoute pageKey="terms" />} />
          <Route path="/how-mirwal-works" element={<TrustRoute pageKey="how-mirwal-works" />} />
          <Route path="/buyer-protection" element={<TrustRoute pageKey="buyer-protection" />} />
          <Route path="/safe-shopping" element={<TrustRoute pageKey="safe-shopping" />} />
          <Route path="/seller-verification" element={<TrustRoute pageKey="seller-verification" />} />
          <Route path="/seller-protection" element={<TrustRoute pageKey="seller-protection" />} />
          <Route path="/payment-security" element={<TrustRoute pageKey="payment-security" />} />
          <Route path="/returns-refunds" element={<TrustRoute pageKey="returns-refunds" />} />
          <Route path="/order-tracking" element={<TrustRoute pageKey="order-tracking" />} />
          <Route path="/cookies" element={<TrustRoute pageKey="cookies" />} />
          <Route path="/trust-safety" element={<TrustRoute pageKey="trust-safety" />} />
          <Route path="/help" element={<HelpCenterPage cartCount={cartCount} />} />
          <Route path="/report-problem" element={<ReportPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/brands" element={<CategoriesPage mode="brands" />} />
          <Route path="/brands/:slug" element={<DiscoveryPage type="brands" />} />
          <Route path="/brand/:brandSlug/:categorySlug" element={<DiscoveryPage type="brands" />} />
          <Route path="/brand/:brandSlug" element={<DiscoveryPage type="brands" />} />
          <Route path="/categories" element={<CategoriesPage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/categories/:slug" element={<CategoriesPage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/category/:slug" element={<CategoriesPage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/sellers" element={<CategoriesPage mode="sellers" />} />
          <Route path="/seller/:sellerSlug/:categorySlug" element={<SellerPages cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/seller/:sellerSlug" element={<SellerPages cartCount={cartCount} onAddToCart={addToCart} />} />
          {accountPaths.map((p) => <Route key={p} path={p} element={<PrivateAccountRoute path={p} cartCount={cartCount} onAddToCart={addToCart} />} />)}
          <Route path="/cart" element={<CartPage cartItems={cartItems} cartCount={cartCount} onChangeQuantity={changeQuantity} onRemove={removeFromCart} onAddToCart={addToCart} onCheckout={checkout} />} />
          <Route path="/deals" element={<DealsPage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/deals/:dealSlug" element={<DealPage />} />
          <Route path="/compare" element={<ComparePage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/sell-with-mirwal/apply" element={<SellerFormPage />} />
          <Route path="/sell-with-mirwal" element={<SellerPage />} />
          <Route path="/stores/awais-store" element={<StorePage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/store" element={<StorePage cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/explore" element={<ExploreRoute cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/search" element={<ExploreWorkspace cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/products" element={<ExploreWorkspace allProducts cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/products/:id" element={<ProductPageRoute cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/product/:productSlug" element={<ProductPageRoute cartCount={cartCount} onAddToCart={addToCart} />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ComparisonProvider></WishlistProvider></SessionProvider></Suspense></PageErrorBoundary>
    {modal?.type === 'cart' && <AddToCartModal product={modal.product} onClose={() => setModal(null)} onViewCart={() => { setModal(null); navigateTo('/cart') }} />}
  </>
}

export default App
