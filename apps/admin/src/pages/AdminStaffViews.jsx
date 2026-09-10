import { useCallback, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'

/**
 * Admin Users, Teams and Login Sessions.
 *
 * These were the last three views said to be impossible because "there is no admin
 * user-management system and no session tracking". That was about missing endpoints, not
 * missing data: `users`, `user_roles` and `refresh_tokens` have held all of it since migration
 * 001. Every figure here is read from those tables.
 *
 * A session IS a live refresh token, so ending one here genuinely signs that browser out —
 * the token stops working on its next refresh rather than being merely hidden from a list.
 */

function formatWhen(value) {
  if (!value) return 'Never'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`administration-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

function useAction(onDone) {
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)
  const run = useCallback(async (key, action) => {
    setBusy(key)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Done.' })
      await onDone?.()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }, [onDone])
  return { busy, flash, setFlash, run }
}

// ---------------------------------------------------------------------------

export function StaffView() {
  const staff = useApiQuery((signal) => api.admin.staff(signal), [])
  const refresh = useCallback(async () => { staff.refetch() }, [staff])
  const { busy, flash, run } = useAction(refresh)

  if (staff.isLoading) return <LoadingState label="Loading staff accounts..." />
  if (staff.isError) {
    return (
      <>
        <p className="administration-error-note">{describeApiError(staff.error)}</p>
        <ErrorState onRetry={staff.refetch} />
      </>
    )
  }

  const items = staff.data ?? []
  if (!items.length) {
    return <EmptyState icon="user-gear" title="No staff accounts" description="Nobody holds an admin role in this database." />
  }

  return (
    <>
      <Flash value={flash} />
      <div className="administration-table-wrap">
        <table className="administration-table">
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Sessions</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>
            {items.map((person) => (
              <tr key={person.id}>
                <td><strong>{person.name}</strong></td>
                <td>{person.email}</td>
                <td>{person.roles.map((role) => <span className="administration-action" key={role}>{role}</span>)}</td>
                <td>{person.activeSessions}</td>
                <td className="administration-when">{formatWhen(person.lastLoginAt)}</td>
                <td><span className={`admin-status ${person.status === 'active' ? '' : 'inactive'}`}>{person.status}</span></td>
                <td>
                  {/* Signing a colleague out is the "their laptop is lost" action. */}
                  <button
                    type="button"
                    disabled={busy === person.id || person.activeSessions === 0}
                    onClick={() => {
                      if (!window.confirm(`Sign ${person.name} out of all ${person.activeSessions} session(s)?`)) return
                      run(person.id, () => api.admin.sessions.revokeAllFor(person.id))
                    }}
                  >
                    Sign out
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="administration-footnote">
        Staff accounts are created in the database, not here — issuing admin credentials from a web form
        would make the panel its own privilege-escalation path. Roles are managed under Roles &amp; Permissions.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------

export function SessionsView() {
  const [staffOnly, setStaffOnly] = useState(false)
  const sessions = useApiQuery(
    (signal) => api.admin.sessions.list({ pageSize: 100, ...(staffOnly ? { staffOnly: 'true' } : {}) }, signal),
    [staffOnly],
  )
  const refresh = useCallback(async () => { sessions.refetch() }, [sessions])
  const { busy, flash, run } = useAction(refresh)

  if (sessions.isLoading) return <LoadingState label="Loading sessions..." />
  if (sessions.isError) {
    return (
      <>
        <p className="administration-error-note">{describeApiError(sessions.error)}</p>
        <ErrorState onRetry={sessions.refetch} />
      </>
    )
  }

  const items = sessions.data?.items ?? []

  return (
    <>
      <Flash value={flash} />
      <div className="administration-filters">
        <label className="administration-inline-check">
          <input type="checkbox" checked={staffOnly} onChange={(event) => setStaffOnly(event.target.checked)} />
          <span>Staff sessions only</span>
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="right-to-bracket" title="No active sessions" description="Nobody is currently signed in." />
      ) : (
        <div className="administration-table-wrap">
          <table className="administration-table">
            <thead><tr><th>Account</th><th>Started</th><th>Expires</th><th>IP</th><th>Client</th><th /></tr></thead>
            <tbody>
              {items.map((session) => (
                <tr key={session.id}>
                  <td><strong>{session.user.name}</strong><small>{session.user.email}</small></td>
                  <td className="administration-when">{formatWhen(session.startedAt)}</td>
                  <td className="administration-when">{formatWhen(session.expiresAt)}</td>
                  <td className="administration-ip">{session.ipAddress ?? '—'}</td>
                  {/* The raw user agent, not a guessed "Chrome on Windows". */}
                  <td className="administration-detail" title={session.userAgent ?? ''}>{session.userAgent ?? '—'}</td>
                  <td>
                    <button type="button" disabled={busy === session.id} onClick={() => run(session.id, () => api.admin.sessions.revoke(session.id))}>
                      End
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="administration-footnote">
        A session is a live refresh token. Ending one stops that browser renewing its access, so it is signed
        out within the access token&rsquo;s remaining lifetime rather than instantly.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------

export function TeamsView() {
  const [name, setName] = useState('')
  const teams = useApiQuery((signal) => api.admin.teams.list(signal), [])
  const staff = useApiQuery((signal) => api.admin.staff(signal), [])
  const refresh = useCallback(async () => { teams.refetch() }, [teams])
  const { busy, flash, run } = useAction(refresh)

  const create = async (event) => {
    event.preventDefault()
    await run('new', () => api.admin.teams.create({ name: name.trim() }))
    setName('')
  }

  if (teams.isLoading) return <LoadingState label="Loading teams..." />
  if (teams.isError) {
    return (
      <>
        <p className="administration-error-note">{describeApiError(teams.error)}</p>
        <ErrorState onRetry={teams.refetch} />
      </>
    )
  }

  const items = teams.data ?? []
  const staffList = staff.data ?? []

  return (
    <>
      <Flash value={flash} />
      <form className="administration-inline-form" onSubmit={create}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New team name" required minLength={2} maxLength={120} aria-label="New team name" />
        <button type="submit" className="primary" disabled={busy === 'new' || !name.trim()}><Icon name="plus" /> Add team</button>
      </form>

      {items.length === 0 ? (
        <EmptyState icon="users-gear" title="No teams yet" description="Teams group staff accounts for organisation. They do not grant any permission — authority comes from roles." />
      ) : (
        <div className="role-grid">
          {items.map((team) => (
            <article className="role-card" key={team.slug}>
              <span><Icon name="users-gear" /></span>
              <h2>{team.name}</h2>
              <p>{team.description || 'No description.'}</p>
              <b>{team.memberCount} member{team.memberCount === 1 ? '' : 's'}</b>
              <ul className="administration-members">
                {team.members.map((member) => (
                  <li key={member.id}>
                    {member.name}
                    <button type="button" disabled={busy === team.slug} onClick={() => run(team.slug, () => api.admin.teams.setMembership(team.slug, { userId: member.id, isMember: false }))} aria-label={`Remove ${member.name}`}>
                      <Icon name="xmark" />
                    </button>
                  </li>
                ))}
              </ul>
              <select
                value=""
                disabled={busy === team.slug}
                onChange={(event) => {
                  if (!event.target.value) return
                  run(team.slug, () => api.admin.teams.setMembership(team.slug, { userId: event.target.value, isMember: true }))
                }}
                aria-label={`Add someone to ${team.name}`}
              >
                <option value="">Add a member…</option>
                {staffList
                  .filter((person) => !team.members.some((member) => member.id === person.id))
                  .map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete team "${team.name}"? Members keep their roles.`)) return
                  run(team.slug, () => api.admin.teams.remove(team.slug))
                }}
                disabled={busy === team.slug}
              >
                Delete team
              </button>
            </article>
          ))}
        </div>
      )}
      <p className="administration-footnote">
        A team is an organisational label only. Permissions come from roles — keeping authority in two
        places would let them disagree about who may do what.
      </p>
    </>
  )
}
