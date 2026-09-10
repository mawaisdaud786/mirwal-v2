import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const ITEMS = [
  ['house', 'Home', '/'],
  ['grip', 'Explore', '/explore'],
  ['tag', 'Deals', '/deals'],
  ['scale-balanced', 'Compare', '/compare'],
  ['user', 'Account', '/profile'],
]

/**
 * Fixed bottom tab bar shown on small screens (App.css hides it above the mobile
 * breakpoint). Previously only existed on HomePage, so every other page fell back to
 * whatever scroll-to-navigate the header offered on a small screen. Rendered once from
 * PublicLayout in App.jsx now, so it's site-wide the way Header/Footer already are.
 */
export default function MobileBottomNav() {
  const { pathname } = useLocation()
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {ITEMS.map(([icon, label, path]) => (
        <button
          type="button"
          key={label}
          className={pathname === path ? 'active' : ''}
          aria-current={pathname === path ? 'page' : undefined}
          onClick={() => navigateTo(path)}
        >
          <FaIcon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
