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
import Dashboard from './seller/pages/Dashboard'
import Orders from './seller/pages/Orders'
import Products from './seller/pages/Products'
import AddProduct from './seller/pages/AddProduct'
import Earnings from './seller/pages/Earnings'
import Coupons from './seller/pages/Coupons'
import Reviews from './seller/pages/Reviews'
import Customers from './seller/pages/Customers'
import { products } from './data/mockData'
import { useEffect, useState } from 'react'

function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [cartItems, setCartItems] = useState(() => products.slice(0, 4).map((product) => ({ ...product, quantity: 1 })))
  const [cartMessage, setCartMessage] = useState('')

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  const productId = path.match(/^\/products\/([^/]+)/)?.[1]
  const product = products.find((item) => item.id === productId)
  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0)
  const addToCart = (item, quantity = 1) => {
    setCartItems((items) => items.some((cartItem) => cartItem.id === item.id)
      ? items.map((cartItem) => cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + quantity } : cartItem)
      : [...items, { ...item, quantity }])
    setCartMessage(`${item.name} added to cart`)
    window.setTimeout(() => setCartMessage(''), 2400)
  }
  const changeQuantity = (id, quantity) => setCartItems((items) => items.map((item) => item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item))
  const removeFromCart = (id) => setCartItems((items) => items.filter((item) => item.id !== id))
  const checkout = () => {
    window.history.pushState({}, '', '/checkout')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  const orderPlaced = (message) => {
    setCartMessage(message)
    window.setTimeout(() => setCartMessage(''), 2400)
  }

  // Determine page based on path
  let page
  
  // Seller Panel Routes
  if (path.startsWith('/seller/products/add')) {
    page = <AddProduct />
  } else if (path.match(/^\/seller\/products\/edit\/[^/]+/)) {
    page = <AddProduct editMode={true} productId={path.split('/').pop()} />
  } else if (path === '/seller/products' || path.startsWith('/seller/products')) {
    page = <Products />
  } else if (path === '/seller/earnings') {
    page = <Earnings />
  } else if (path === '/seller/coupons') {
    page = <Coupons />
  } else if (path === '/seller/reviews') {
    page = <Reviews />
  } else if (path === '/seller/customers') {
    page = <Customers />
  } else if (path === '/seller/orders' || path.startsWith('/seller/orders')) {
    page = <Orders />
  } else if (path === '/seller' || path.startsWith('/seller/')) {
    page = <Dashboard />
  }
  // Regular Routes
  else if (path === '/login') {
    page = <AuthPage />
  } else if (path === '/register') {
    page = <AuthPage initialMode="signup" />
  } else if (path === '/checkout') {
    page = <CheckoutPage cartItems={cartItems} cartCount={cartCount} onOrderPlaced={orderPlaced} />
  } else if (path === '/cart') {
    page = <CartPage cartItems={cartItems} cartCount={cartCount} onChangeQuantity={changeQuantity} onRemove={removeFromCart} onAddToCart={addToCart} onCheckout={checkout} />
  } else if (path === '/deals') {
    page = <DealsPage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/compare') {
    page = <ComparePage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/ai-assistant') {
    page = <AiAssistantPage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/sell-with-mirwal/apply') {
    page = <SellerFormPage />
  } else if (path === '/sell-with-mirwal') {
    page = <SellerPage />
  } else if (path === '/stores/awais-store' || path === '/store') {
    page = <StorePage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (path === '/explore' || path === '/products') {
    page = <ProductsPage cartCount={cartCount} onAddToCart={addToCart} />
  } else if (product) {
    page = <ProductPage product={product} cartCount={cartCount} onAddToCart={addToCart} />
  } else {
    page = <HomePage cartCount={cartCount} onAddToCart={addToCart} />
  }
  return <><div className={cartMessage ? 'cart-toast visible' : 'cart-toast'} role="status">✓ {cartMessage}</div>{page}</>
}

export default App
