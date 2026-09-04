import { useSellerSession } from './SellerSession'
import './login.css'

/**
 * Shown when a session exists but carries no admin role. Reaching this is unexpected — the
 * admin auth namespace does not issue sessions to non-admins — so it offers a way out
 * rather than pretending a retry would help.
 */
export default function SellerAccessDeniedPage() {
  const { logout } = useSellerSession()
  return (
    <div className="seller-login-page">
      <div className="seller-login-card seller-denied">
        <h1>Access denied</h1>
        <p className="seller-login-sub">
          This account doesn't have an approved Mirwal seller store. If you believe that's a
          mistake, contact a Mirwal support.
        </p>
        <button type="button" onClick={logout}>Sign out</button>
      </div>
    </div>
  )
}
