import { useCallback, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './security-settings.css'

/**
 * Seller account security: password, two-factor, and signed-in devices.
 *
 * The Finance page used to carry a "Security" card whose rows all read "Not available yet".
 * They are available now, on the same endpoints and the same TOTP implementation the admin
 * panel and the storefront use.
 *
 * A seller account is worth protecting more than a shopper's, not less: it controls a live
 * storefront, its prices, and a payout balance. Whoever holds it can change where money goes.
 */

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SecuritySettings() {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' })
  const [enrolment, setEnrolment] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [confirmPassword, setConfirmPassword] = useState('')

  const twoFactor = useApiQuery((signal) => api.auth.twoFactor(signal), [])
  const sessions = useApiQuery((signal) => api.auth.sessions(signal), [])
  const refreshSessions = useCallback(() => { sessions.refetch() }, [sessions])

  const run = async (action) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Done.' })
      return result
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
      return null
    } finally { setBusy(false) }
  }

  const status = twoFactor.data

  return (
    <SellerLayout
      activeItem="security-settings"
      breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Security' }]}
    >
      <div className="security-settings-page">
        <div className="security-settings-header">
          <h1>Security</h1>
          <p>Your seller account controls your storefront, your prices and where your earnings are sent.</p>
        </div>

        {flash && (
          <p className={`sec-flash ${flash.tone}`} role="status">
            <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
          </p>
        )}

        {codes && (
          <section className="sec-card sec-codes">
            <h2><Icon name="key" /> Save your recovery codes</h2>
            <p>Each signs you in once if you lose your phone. They are stored hashed — this is the only time they can be shown.</p>
            <ol>{codes.map((backupCode) => <li key={backupCode}><code>{backupCode}</code></li>)}</ol>
            <button type="button" className="primary" onClick={() => setCodes(null)}>I have saved these</button>
          </section>
        )}

        <section className="sec-card">
          <div className="sec-card-head">
            <span><Icon name="key" /></span>
            <div><h2>Password</h2><p>Changing it signs you out on every other device — which is the point if you think it has been taken.</p></div>
          </div>
          <form
            className="sec-form"
            onSubmit={async (event) => {
              event.preventDefault()
              const result = await run(() => api.auth.changePassword(passwords))
              if (result) { setPasswords({ currentPassword: '', newPassword: '' }); refreshSessions() }
            }}
          >
            <label>
              Current password
              <input type="password" autoComplete="current-password" required value={passwords.currentPassword}
                onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} />
            </label>
            <label>
              New password <small>At least 8 characters.</small>
              <input type="password" autoComplete="new-password" required minLength={8} value={passwords.newPassword}
                onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} />
            </label>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button>
          </form>
        </section>

        <section className="sec-card">
          <div className="sec-card-head">
            <span><Icon name="shield-halved" /></span>
            <div>
              <h2>Two-factor authentication</h2>
              <p>A six-digit code from an authenticator app, on top of your password. Works with Google Authenticator, Authy, 1Password and anything else that follows the standard.</p>
            </div>
            <em className={status?.enabled ? 'on' : 'off'}>{status?.enabled ? 'On' : 'Off'}</em>
          </div>

          {twoFactor.isLoading ? <p className="sec-note">Checking...</p> : status?.enabled ? (
            <>
              <p className="sec-note">
                Switched on {formatWhen(status.enabledAt)}. {status.backupCodesRemaining} of {status.backupCodesIssued} recovery codes unused.
              </p>
              <form className="sec-form" onSubmit={(event) => event.preventDefault()}>
                <label>
                  Your password <small>Required to change either of these — a live session is not proof of identity when a screen may have been left unlocked.</small>
                  <input type="password" autoComplete="current-password" value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)} />
                </label>
                <div className="sec-actions">
                  <button
                    type="button" disabled={busy || !confirmPassword}
                    onClick={async () => {
                      const result = await run(() => api.auth.regenerateBackupCodes(confirmPassword))
                      if (result?.data) { setCodes(result.data.backupCodes); setConfirmPassword('') }
                    }}
                  >
                    New recovery codes
                  </button>
                  <button
                    type="button" className="danger" disabled={busy || !confirmPassword}
                    onClick={async () => {
                      const result = await run(() => api.auth.disableTwoFactor(confirmPassword))
                      if (result) { setConfirmPassword(''); twoFactor.refetch() }
                    }}
                  >
                    Turn off
                  </button>
                </div>
              </form>
            </>
          ) : enrolment ? (
            <div className="sec-enrol">
              <p className="sec-note">Add this key to your authenticator app, then enter the code it shows.</p>
              <code className="sec-secret">{enrolment.secret}</code>
              <form
                className="sec-form inline"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const result = await run(() => api.auth.confirmTwoFactor(code))
                  if (result?.data) { setCodes(result.data.backupCodes); setEnrolment(null); setCode(''); twoFactor.refetch() }
                }}
              >
                <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric"
                  autoComplete="one-time-code" maxLength={7} placeholder="123456" required />
                <button type="submit" className="primary" disabled={busy}>{busy ? 'Checking...' : 'Confirm'}</button>
                <button type="button" onClick={() => { setEnrolment(null); setCode('') }}>Cancel</button>
              </form>
              {/* Nothing is switched on until a working code proves your app holds the same
                  key — enrolling on a key that was never scanned is how people lock
                  themselves out of their own store. */}
            </div>
          ) : (
            <button
              type="button" className="primary" disabled={busy}
              onClick={async () => {
                const result = await run(() => api.auth.beginTwoFactor())
                if (result?.data) setEnrolment(result.data)
              }}
            >
              <Icon name="mobile-screen" /> Set up two-factor
            </button>
          )}
        </section>

        <section className="sec-card">
          <div className="sec-card-head">
            <span><Icon name="laptop" /></span>
            <div><h2>Where you are signed in</h2><p>Every device with a live session. Ending one signs it out immediately.</p></div>
          </div>
          {sessions.isLoading ? <p className="sec-note">Loading...</p>
            : (sessions.data ?? []).length === 0 ? (
              <EmptyState icon={<Icon name="laptop" />} title="No other sessions" text="You are only signed in here." />
            ) : (
              <ul className="sec-sessions">
                {sessions.data.map((session) => (
                  <li key={session.id}>
                    <div>
                      <b>{session.device}{session.isCurrent && <em>This device</em>}</b>
                      <small>{session.ip ?? 'Unknown address'} · since {formatWhen(session.startedAt)}</small>
                    </div>
                    {/* No button on the current session: it would sign you out mid-click. */}
                    {!session.isCurrent && (
                      <button
                        type="button" disabled={busy}
                        onClick={async () => {
                          const result = await run(() => api.auth.revokeSession(session.id))
                          if (result) refreshSessions()
                        }}
                      >
                        Sign out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </SellerLayout>
  )
}
