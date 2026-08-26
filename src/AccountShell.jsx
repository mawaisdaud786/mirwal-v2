import Header from './components/Header'
import AssistantRelatedPage from './AssistantRelatedPage'
import ProfileOrdersPage from './ProfileOrdersPage'
import AccountUtilityPage from './AccountUtilityPage'
import { AccountSidebar } from './AccountUtilityPage'
import './ai-assistant.css'
import { navigateTo } from './navigation'

function navigate(path) { navigateTo(path) }

export default function AccountShell({ path, cartCount }) {
  let content
  if (path === '/orders') content = <ProfileOrdersPage cartCount={cartCount} />
  else if (['/track-orders', '/compare', '/addresses', '/payment-methods', '/notifications', '/security', '/logout'].includes(path)) content = <AccountUtilityPage path={path} cartCount={cartCount} />
  else content = <AssistantRelatedPage path={path} cartCount={cartCount} />

  const active = path === '/ai-assistant' ? '' : path === '/track-orders' ? 'Track Orders' : path === '/payment-methods' ? 'Payment Methods' : path === '/recently-viewed' ? 'Recently Viewed' : path === '/saved-searches' ? 'Saved Searches' : path === '/my-chats' ? 'My Chats' : path === '/wishlist' ? 'Wishlist' : path === '/profile' ? 'Profile' : path === '/orders' ? 'Orders' : path === '/compare' ? 'Compare' : path === '/addresses' ? 'Addresses' : path === '/notifications' ? 'Notifications' : path === '/security' ? 'Security' : 'Settings'
  const handleAccountClick = (event) => {
    const button = event.target.closest('button')
    if (!button || button.closest('.profile-sidebar')) return
    const label = button.textContent.trim()
    const routes = { 'View Details': '/track-orders', 'Track Order': '/track-orders', Filter: '/orders?filter=open', 'Add New Address': '/addresses?add=1', 'Add New Card': '/payment-methods?add=1', 'Mark all as read': '/notifications?read=1', 'View All Notifications': '/notifications?all=1', 'Manage Security': '/security?manage=1', 'Change Password': '/security?password=1', 'View Activity': '/security?activity=1', Manage: '/security?devices=1', 'View Product': '/explore' }
    if (routes[label]) navigate(routes[label])
  }
  return <div className="account-shell"><Header cartCount={cartCount} /><div className="account-shell-layout"><AccountSidebar active={active} /><div className="account-shell-content" onClick={handleAccountClick}>{content}</div></div></div>
}
