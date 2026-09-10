import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './security-pages.css'

/**
 * Security: posture, the caller's own two-factor, and the policy that is actually in force.
 *
 * The template invented an admin roster ("Sarah Khan — Administrator"), a fake login log with
 * device strings, and forms whose "Save Changes" saved nowhere. It was then collapsed to a
 * not-connected page whose text said there was no 2FA, no rate limiting, no IP allowlist and
 * no security log.
 *
 * Three of those four were wrong. Rate limiting has always been in `app.js`, the allowlist is
 * `maintenance.allow_ips`, and `audit_logs` has recorded security events for a long time. Only
 * two-factor genuinely did not exist — so that is the part that was built (real TOTP, RFC 6238,
 * verified against the specification's own test vectors) rather than merely surfaced.
 *
 * The tabs the template had for rate limits and security headers are gone, not rebuilt. Both
 * are enforced from the server environment, and an editable form for them would be worse than
 * no form: a security control an admin session can weaken is a security control an attacker
 * who has an admin session can weaken. They are shown here as read-only facts instead.
 */

const TABS = [
  ['Overview', 'overview', 'house'],
  ['Two-factor', 'two-factor', 'mobile-screen'],
  ['Activity', 'activity', 'list'],
]

const number = (value) => Number(value ?? 0).toLocaleString('en-PK')

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

// ---------------------------------------------------------------------------
// Two-factor enrolment
// ---------------------------------------------------------------------------

/**
 * Enrol, confirm, and hold the recovery codes.
 *
 * The codes are shown exactly once and are never fetched again — they are stored hashed, so
 * even this page cannot re-read them. That is why the panel refuses to close until the codes
 * have been acknowledged.
 */
function TwoFactorPanel() {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [enrolment, setEnrolment] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [password, setPassword] = useState('')

  const query = useApiQuery((signal) => api.admin.security.twoFactor(signal), [])
  const refresh = useCallback(() => { query.refetch() }, [query])

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

  const begin = async () => {
    const result = await run(() => api.admin.security.beginTwoFactor())
    if (result?.data) setEnrolment(result.data)
  }

  const confirm = async (event) => {
    event.preventDefault()
    const result = await run(() => api.admin.security.confirmTwoFactor(code))
    if (result?.data) {
      setCodes(result.data.backupCodes)
      setEnrolment(null)
      setCode('')
      refresh()
    }
  }

  const disable = async (event) => {
    event.preventDefault()
    const result = await run(() => api.admin.security.disableTwoFactor(password))
    if (result) { setPassword(''); refresh() }
  }

  const reissue = async (event) => {
    event.preventDefault()
    const result = await run(() => api.admin.security.regenerateBackupCodes(password))
    if (result?.data) { setCodes(result.data.backupCodes); setPassword(''); refresh() }
  }

  if (query.isLoading) return <LoadingState label="Checking your account" />
  if (query.isError) {
    return (
      <section className="security-panel">
        <p className="security-note error">{describeApiError(query.error)}</p>
        <ErrorState onRetry={query.refetch} />
      </section>
    )
  }

  const status = query.data

  return (
    <>
      {flash && (
        <p className={`security-flash ${flash.tone}`} role="status">
          <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
        </p>
      )}

      {codes && (
        <section className="security-panel security-codes">
          <h2><Icon name="key" /> Save your recovery codes</h2>
          <p className="security-note">
            Each one signs you in once if you lose your phone. They are stored hashed, so this is the only time
            they can be shown — not even this page can read them back.
          </p>
          <ol>{codes.map((backupCode) => <li key={backupCode}><code>{backupCode}</code></li>)}</ol>
          <button type="button" className="primary" onClick={() => setCodes(null)}>I have saved these</button>
        </section>
      )}

      <section className="security-panel">
        <div className="security-panel-head">
          <div>
            <h2>Two-factor authentication</h2>
            <p className="security-note">
              A six-digit code from an authenticator app, in addition to your password. Works with Google
              Authenticator, Authy, 1Password and anything else that follows RFC 6238.
            </p>
          </div>
          <span className={`security-badge ${status.enabled ? 'on' : 'off'}`}>
            <Icon name={status.enabled ? 'shield-halved' : 'shield'} /> {status.enabled ? 'On' : 'Off'}
          </span>
        </div>

        {status.enabled ? (
          <>
            <p className="security-note">
              Switched on {formatWhen(status.enabledAt)}. {status.backupCodesRemaining} of {status.backupCodesIssued}{' '}
              recovery codes are unused.
            </p>
            {status.backupCodesRemaining <= 2 && (
              <p className="security-note warn">
                <Icon name="triangle-exclamation" /> You are nearly out of recovery codes. Issue a new set before you
                need one.
              </p>
            )}
            <form className="security-form" onSubmit={disable}>
              <label>
                Your password
                <small>Required to change either of these — a live session is not proof of identity when a screen may simply have been left unlocked.</small>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
              </label>
              <div className="security-form-actions">
                <button type="button" disabled={busy || !password} onClick={reissue}>Issue new recovery codes</button>
                <button type="submit" className="danger" disabled={busy || !password}>Turn two-factor off</button>
              </div>
            </form>
          </>
        ) : enrolment ? (
          <div className="security-enrol">
            <ol>
              <li>
                Add this to your authenticator app.
                <p className="security-note">Most apps scan a QR code; every one of them also accepts the key typed in by hand.</p>
                <code className="security-secret">{enrolment.secret}</code>
                <p className="security-note">
                  Or open this link on the device with the app:{' '}
                  <a href={enrolment.otpauthUri}>{enrolment.otpauthUri.slice(0, 48)}…</a>
                </p>
              </li>
              <li>
                Enter the code it shows.
                <form className="security-form inline" onSubmit={confirm}>
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={7}
                    required
                  />
                  <button type="submit" className="primary" disabled={busy}>{busy ? 'Checking...' : 'Confirm'}</button>
                  <button type="button" onClick={() => { setEnrolment(null); setCode('') }}>Cancel</button>
                </form>
                <p className="security-note">
                  Nothing changes until a working code proves your app holds the same key — enrolling on a key you
                  never actually scanned is how people lock themselves out.
                </p>
              </li>
            </ol>
          </div>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={begin}>
            <Icon name="mobile-screen" /> Set up two-factor
          </button>
        )}
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------

function Overview({ data, onPolicyChange, busy }) {
  const { accounts, staff, sessions, policy } = data
  return (
    <>
      <div className="security-kpis">
        <article><small>Accounts</small><strong>{number(accounts.total)}</strong><em>{number(accounts.suspended)} suspended</em></article>
        <article><small>Active sessions</small><strong>{number(sessions.active)}</strong><em>{number(sessions.startedToday)} started today</em></article>
        <article className={staff.withoutTwoFactor > 0 ? 'warn' : ''}>
          <small>Staff without two-factor</small>
          <strong>{number(staff.withoutTwoFactor)}</strong>
          <em>of {number(staff.total)} staff accounts</em>
        </article>
        <article className={accounts.lockedOut > 0 ? 'warn' : ''}>
          <small>Locked out now</small>
          <strong>{number(accounts.lockedOut)}</strong>
          <em>{number(accounts.withFailedAttempts)} with failed attempts</em>
        </article>
        <article className={data.errorsLast24h > 0 ? 'warn' : ''}>
          <small>Server errors (24h)</small>
          <strong>{number(data.errorsLast24h)}</strong>
          <em>from the system log</em>
        </article>
      </div>

      <section className="security-panel">
        <div className="security-panel-head">
          <div>
            <h2>Require two-factor for staff</h2>
            <p className="security-note">
              When on, a staff account cannot switch its own second factor off. It does not retroactively enrol
              anyone — {number(staff.withoutTwoFactor)} staff account{staff.withoutTwoFactor === 1 ? ' has' : 's have'}{' '}
              only a password today.
            </p>
          </div>
          <label className="security-switch">
            <input
              type="checkbox"
              checked={staff.twoFactorRequired}
              disabled={busy}
              onChange={(event) => onPolicyChange(event.target.checked)}
            />
            <span />
          </label>
        </div>
      </section>

      <section className="security-panel">
        <h2>Controls in force</h2>
        <p className="security-note">
          Read from the running server, not from a saved form. These live in the environment on purpose: a
          security control an admin session can weaken is one an attacker holding an admin session can weaken.
        </p>
        <dl className="security-facts">
          <div><dt>Rate limit</dt><dd>{number(policy.rateLimit.maxRequests)} requests per {policy.rateLimit.windowMinutes} minute{policy.rateLimit.windowMinutes === 1 ? '' : 's'}, per IP</dd></div>
          <div><dt>Account lockout</dt><dd>After {policy.lockout.afterFailedAttempts} failed sign-ins, for {policy.lockout.minutes} minutes</dd></div>
          <div><dt>Access token lifetime</dt><dd>{policy.accessTokenLifetime}</dd></div>
          <div><dt>Session lifetime</dt><dd>{policy.refreshTokenDays} days, rotated on every refresh</dd></div>
          <div><dt>Allowed IPs</dt><dd>{policy.allowedIps.length > 0 ? policy.allowedIps.join(', ') : 'None — staff sign-in is the only bypass during maintenance'}</dd></div>
          <div><dt>Configured in</dt><dd>{policy.configuredIn}</dd></div>
        </dl>
      </section>

      {data.accountsNeedingAttention.length > 0 && (
        <section className="security-panel">
          <h2>Accounts with failed sign-ins</h2>
          <table className="security-table">
            <thead><tr><th>Account</th><th className="num">Failed attempts</th><th className="num">Locked until</th></tr></thead>
            <tbody>
              {data.accountsNeedingAttention.map((account) => (
                <tr key={account.id}>
                  <td><b>{account.name}</b><small>{account.email}</small></td>
                  <td className="num">{number(account.failedAttempts)}</td>
                  <td className="num">{account.lockedUntil ? formatWhen(account.lockedUntil) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function Activity({ events }) {
  return (
    <section className="security-panel">
      <h2>Security activity</h2>
      <p className="security-note">
        From the audit log — the security-relevant actions only. The full trail, including catalogue and
        seller changes, is under Administration &rsaquo; Audit Logs.
      </p>
      {events.length === 0 ? (
        <EmptyState icon="list" title="Nothing recorded yet" description="Suspending an account, ending a session, changing a role or taking a backup all appear here." />
      ) : (
        <table className="security-table">
          <thead><tr><th>Action</th><th>Target</th><th>By</th><th>IP</th><th className="num">When</th></tr></thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={`${event.action}-${event.at}-${index}`}>
                <td><b>{event.action}</b></td>
                <td>{event.entityType}{event.entityId ? ` · ${String(event.entityId).slice(0, 12)}` : ''}</td>
                <td>{event.actor ?? 'System'}</td>
                <td>{event.ip ?? '—'}</td>
                <td className="num">{formatWhen(event.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function AdminSecurityPages() {
  const { pathname } = useLocation()
  const segment = pathname.split('/')[2] || 'overview'
  const tab = TABS.find(([, key]) => key === segment)?.[1] ?? 'overview'

  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const query = useApiQuery((signal) => api.admin.security.overview(signal), [])

  const setPolicy = async (requireTwoFactorForStaff) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.admin.security.setPolicy({ requireTwoFactorForStaff })
      setFlash({ tone: 'success', text: result.message })
      query.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  return (
    <AdminLayout>
      <div className="security-page">
        <div className="security-heading">
          <div>
            <h1>Security</h1>
            <p>Home <Icon name="chevron-right" /> System <Icon name="chevron-right" /> Security</p>
          </div>
        </div>

        <nav className="security-tabs" aria-label="Security sections">
          {TABS.map(([label, key, icon]) => (
            <button type="button" key={key} className={key === tab ? 'active' : ''} onClick={() => navigateTo(`/security/${key}`)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        </nav>

        {flash && (
          <p className={`security-flash ${flash.tone}`} role="status">
            <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
          </p>
        )}

        {tab === 'two-factor' ? <TwoFactorPanel /> : (
          <>
            {query.isLoading && <LoadingState label="Reading security posture" />}
            {query.isError && !query.isLoading && (
              <section className="security-panel">
                <p className="security-note error">{describeApiError(query.error)}</p>
                <ErrorState onRetry={query.refetch} />
              </section>
            )}
            {!query.isLoading && !query.isError && query.data && (
              tab === 'activity'
                ? <Activity events={query.data.recentEvents} />
                : <Overview data={query.data} onPolicyChange={setPolicy} busy={busy} />
            )}
          </>
        )}
      </div>
    </AdminLayout>
  )
}
