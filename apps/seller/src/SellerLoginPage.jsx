import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { describeApiError } from '@mirwal/shared/useApiQuery'
import { useSellerSession } from './SellerSession'
import './login.css'

/**
 * Seller sign-in — its own page on its own domain, not a shared login that branches on role.
 *
 * The credentials go to `/admin/auth/login`, which authenticates AND requires an admin role
 * before it issues anything. A customer or seller submitting valid credentials here gets an
 * authorization failure, not a session. The error copy stays deliberately generic so this
 * page can't be used to discover which accounts exist or which have admin access.
 */
export default function SellerLoginPage() {
  const { user, isLoading, login } = useSellerSession()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /**
   * The second factor.
   *
   * The API answers TWO_FACTOR_REQUIRED on the first attempt and only then does this form ask
   * — sending a code speculatively would reveal which accounts are enrolled. Until this was
   * added, no login page implemented that second step at all, so switching two-factor on in
   * the security settings locked the account out permanently.
   */
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)

  if (!isLoading && user) return <Navigate to={location.state?.from || '/'} replace />

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true); setError('')
    try {
      await login(form)
    } catch (loginError) {
      if (loginError?.code === 'TWO_FACTOR_REQUIRED') {
        // The password was right; the account simply has a second factor. Asking for it is not
        // an error state, and reporting it as one makes people think their password is wrong.
        setTwoFactorRequired(true)
        setError('')
      } else {
        if (loginError?.code === 'INVALID_TWO_FACTOR') setForm((current) => ({ ...current, totpCode: '' }))
        setError(describeApiError(loginError))
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="seller-login-page">
      <form className="seller-login-card" onSubmit={submit}>
        <div className="seller-login-brand">
          <img src="/mirwal-word-logo.png" alt="Mirwal" />
          <span>Seller Centre</span>
        </div>
        <h1>Sign in to Seller Centre</h1>
        <p className="seller-login-sub">Manage your Mirwal store, orders and earnings.</p>

        <label>
          Email address
          <input
            type="email" autoComplete="username" required value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <label>
          Password
          <input
            type="password" autoComplete="current-password" required value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>

        {twoFactorRequired && (
          <label className="seller-login-2fa">
            Authentication code
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" required autoFocus
              maxLength={20} placeholder="123456"
              value={form.totpCode ?? ''}
              onChange={(event) => setForm({ ...form, totpCode: event.target.value })}
            />
            <small>Six digits from your authenticator app. A recovery code works here too.</small>
          </label>
        )}

        {error && <p className="seller-login-error" role="alert">{error}</p>}

        <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : twoFactorRequired ? 'Verify and sign in' : 'Sign in'}</button>
        <p className="seller-login-note">
          New to Mirwal? Apply to become a seller on mirwal.pk.
        </p>
      </form>
    </div>
  )
}
