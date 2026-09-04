import { useAdminSession } from './AdminSession'
import './login.css'

/**
 * Shown when a session exists but carries no admin role. Reaching this is unexpected — the
 * admin auth namespace does not issue sessions to non-admins — so it offers a way out
 * rather than pretending a retry would help.
 */
export default function AccessDeniedPage() {
  const { logout } = useAdminSession()
  return (
    <div className="admin-login-page">
      <div className="admin-login-card admin-denied">
        <h1>Access denied</h1>
        <p className="admin-login-sub">
          This account isn't authorized for the Mirwal admin panel. If you believe that's a
          mistake, contact a super administrator.
        </p>
        <button type="button" onClick={logout}>Sign out</button>
      </div>
    </div>
  )
}
