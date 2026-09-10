import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import { describeApiError } from '@mirwal/shared/useApiQuery'
import api, { ApiError } from './api'
import './App.css'

/**
 * Set a new password from an emailed link.
 *
 * The token arrives in the query string because that is where an emailed link can carry it.
 * It is never stored, never logged and never sent anywhere but the reset endpoint, and the
 * server accepts it once — a second use fails even a second later.
 *
 * Two-factor is deliberately not cleared by a reset. Someone who can read the inbox must not
 * be able to strip the second factor off the account; that is the entire reason for having
 * one, and this page says so rather than leaving it as a surprise at the next sign-in.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (password !== confirm) {
      setMessage('Those two passwords do not match.')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      const result = await api.auth.resetPassword({ token, password })
      setDone(true)
      setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof ApiError ? describeApiError(error) : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <button type="button" className="auth-brand" onClick={() => navigateTo('/')}>Mirwal</button>
        <div>
          <button type="button" onClick={() => navigateTo('/')}><FaIcon name="house" /> Back to Home</button>
        </div>
      </div>

      <div className="auth-shell auth-shell-narrow">
        <section className="auth-card">
          <div className="auth-content">
            {!token ? (
              <>
                <h2>That link is incomplete</h2>
                <p className="auth-subtitle">
                  The reset link has no token in it — it was probably cut short by an email client. Ask for a
                  fresh one and open the whole link.
                </p>
                <button className="auth-submit" type="button" onClick={() => navigateTo('/login')}>
                  Back to sign in <FaIcon name="arrow-right" />
                </button>
              </>
            ) : done ? (
              <>
                <h2>Password changed</h2>
                <p className="auth-subtitle">{message}</p>
                <p className="auth-note">
                  Every device that was signed in to your account has been signed out, including whoever
                  prompted this reset if it was not you.
                </p>
                <button className="auth-submit" type="button" onClick={() => navigateTo('/login')}>
                  Sign in <FaIcon name="arrow-right" />
                </button>
              </>
            ) : (
              <>
                <h2>Choose a new password</h2>
                <p className="auth-subtitle">This link works once, and only for the next few minutes.</p>

                <form onSubmit={submit}>
                  <label className="auth-field">
                    <span>New password <small>(minimum 8 characters)</small></span>
                    <div>
                      <FaIcon name="lock" />
                      <input
                        required
                        minLength={8}
                        type={show ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Enter a new password"
                      />
                      <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
                        <FaIcon name={show ? 'eye-slash' : 'eye'} />
                      </button>
                    </div>
                  </label>

                  <label className="auth-field">
                    <span>Confirm new password</span>
                    <div>
                      <FaIcon name="lock" />
                      <input
                        required
                        minLength={8}
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        placeholder="Type it again"
                      />
                    </div>
                  </label>

                  <button className="auth-submit" type="submit" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Change my password'} <FaIcon name="arrow-right" />
                  </button>
                </form>

                {message && <p className="auth-message" role="status">{message}</p>}

                <p className="auth-note">
                  If you use two-factor authentication it stays switched on. Resetting a password must not be a
                  way around a second factor — that is what the second factor is for.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
