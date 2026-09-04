import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { describeApiError } from '@mirwal/shared/useApiQuery'
import { useAdminSession } from './AdminSession'
import './login.css'

/**
 * Admin sign-in — its own page on its own domain, not a shared login that branches on role.
 *
 * The credentials go to `/admin/auth/login`, which authenticates AND requires an admin role
 * before it issues anything. A customer or seller submitting valid credentials here gets an
 * authorization failure, not a session. The error copy stays deliberately generic so this
 * page can't be used to discover which accounts exist or which have admin access.
 */
export default function AdminLoginPage() {
  const { user, isLoading, login } = useAdminSession()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isLoading && user) return <Navigate to={location.state?.from || '/'} replace />

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true); setError('')
    try {
      await login(form)
    } catch (loginError) {
      setError(describeApiError(loginError))
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-login-page">
      <form className="admin-login-card" onSubmit={submit}>
        <div className="admin-login-brand">
          <img src="/mirwal-word-logo-dark.png" alt="Mirwal" />
          <span>Admin</span>
        </div>
        <h1>Sign in to the admin panel</h1>
        <p className="admin-login-sub">Authorized Mirwal administrators only.</p>

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

        {error && <p className="admin-login-error" role="alert">{error}</p>}

        <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        <p className="admin-login-note">
          This panel is monitored. Access attempts are logged.
        </p>
      </form>
    </div>
  )
}
