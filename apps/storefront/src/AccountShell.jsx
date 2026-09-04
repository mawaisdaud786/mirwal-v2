import Header from './components/Header'
import { AssistantRelatedContent } from './AssistantRelatedPage'
import { OrdersContent } from './ProfileOrdersPage'
import { AccountSidebar, AccountUtilityContent } from './AccountUtilityPage'
import './ai-assistant.css'
import { navigateTo } from '@mirwal/shared/navigation'

function navigate(path) { navigateTo(path) }

export default function AccountShell({ path, cartCount }) {
  let content
  if (path === '/orders') content = <OrdersContent />
  else if (['/track-orders', '/compare', '/addresses', '/payment-methods', '/notifications', '/security', '/logout'].includes(path)) content = <AccountUtilityContent path={path} />
  else content = <AssistantRelatedContent path={path} />

  const active = path === '/ai-assistant' ? '' : path === '/track-orders' ? 'Track Orders' : path === '/payment-methods' ? 'Payment Methods' : path === '/recently-viewed' ? 'Recently Viewed' : path === '/saved-searches' ? 'Saved Searches' : path === '/my-chats' ? 'My Chats' : path === '/wishlist' ? 'Wishlist' : path === '/profile' ? 'Profile' : path === '/orders' ? 'Orders' : path === '/compare' ? 'Compare' : path === '/addresses' ? 'Addresses' : path === '/notifications' ? 'Notifications' : path === '/security' ? 'Security' : 'Settings'
  const handleAccountClick = (event) => {
    const button = event.target.closest('button')
    if (!button || button.closest('.profile-sidebar')) return
    const label = button.textContent.trim()
    // 'View Product' deliberately excluded: Compare's buttons with that label now have their
    // own onClick to a specific product, which this generic delegated handler would override.
    // 'View Details' likewise excluded as of the real orders/returns work: the Orders list's
    // "View Details" button now has its own onClick to a specific order
    // (`/order-success/:id`), which this generic label-matching handler was silently
    // overriding back to '/track-orders' immediately after the real navigation fired —
    // clicking any real order always landed on Track Orders instead of that order's detail.
    const routes = { 'Track Order': '/track-orders', Filter: '/orders?filter=open', 'Add New Address': '/addresses?add=1', 'Add New Card': '/payment-methods?add=1', 'Mark all as read': '/notifications?read=1', 'View All Notifications': '/notifications?all=1', 'Manage Security': '/security?manage=1', 'Change Password': '/security?password=1', 'View Activity': '/security?activity=1', Manage: '/security?devices=1' }
    if (routes[label]) navigate(routes[label])
  }
  return <div className="account-shell"><Header cartCount={cartCount} /><div className="account-shell-layout"><AccountSidebar active={active} /><div className="account-shell-content" onClick={handleAccountClick}>{content}</div></div></div>
}
