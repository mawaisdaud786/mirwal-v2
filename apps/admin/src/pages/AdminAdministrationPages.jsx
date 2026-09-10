import { useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import AdminRolesView from './AdminRolesView'
import { StaffView, SessionsView, TeamsView } from './AdminStaffViews'
import './administration-pages.css'

/**
 * Administration section.
 *
 * Audit Logs and Admin Activity are now real: `audit_logs` has existed since migration 001,
 * and every state-changing admin route writes to it (see server/src/modules/admin/audit.service.js),
 * so `GET /admin/audit-logs` returns the actual trail of who changed what.
 *
 * Roles & Permissions and Access Control are real too: they read `role_permissions`, the same
 * rows `requirePermission` consults on every request, so the grid shows what the server will
 * actually allow rather than a hard-coded copy of the seeded matrix.
 *
 * Admin Users, Teams and Login Sessions are real as well. They were previously called
 * impossible for want of "an admin user-management system" and "session tracking" — but
 * `users`, `user_roles` and `refresh_tokens` have carried all of it since migration 001, and
 * teams arrived with 016. Every view in this section now reads real rows.
 */
const TITLES = {
  users: 'Admin Users',
  teams: 'Teams',
  sessions: 'Login Sessions',
  activity: 'Admin Activity',
  audit: 'Audit Logs',
  access: 'Access Control',
  roles: 'Roles & Permissions',
}

/** `product.approved` → "Approved", with the entity shown separately. */
function actionLabel(action) {
  const verb = action.split('.').pop() ?? action
  return verb.charAt(0).toUpperCase() + verb.slice(1)
}

/** Colour the verb, not the entity: created/approved read as positive, deleted as negative. */
function actionTone(action) {
  const verb = action.split('.').pop()
  if (['created', 'approved', 'reinstated'].includes(verb)) return 'positive'
  if (['deleted', 'rejected', 'suspended'].includes(verb)) return 'negative'
  return 'neutral'
}

function formatWhen(value) {
  if (!value) return '—'
  // The API sends MariaDB's "YYYY-MM-DD HH:MM:SS.mmm"; Safari will not parse that with the
  // space, so it is normalised to ISO before Date sees it.
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Render the audit row's metadata as the short "what changed" summary the table shows. */
function summarise(entry) {
  const meta = entry.metadata
  if (!meta) return '—'
  if (meta.from !== undefined && meta.to !== undefined) return `${meta.from} → ${meta.to}`
  if (meta.fields) return `Changed ${meta.fields.join(', ')}`
  if (meta.reason) return meta.reason
  if (meta.storeName) return meta.storeName
  if (meta.name) return meta.name
  return '—'
}

function AuditLogView({ title }) {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)

  const filters = useApiQuery((signal) => api.admin.auditLogs.filters(signal), [])
  const logs = useApiQuery(
    (signal) => api.admin.auditLogs.list(
      { page, pageSize: 25, ...(action ? { action } : {}), ...(entityType ? { entityType } : {}) },
      signal,
    ),
    [page, action, entityType],
  )

  if (logs.isLoading) return <LoadingState label="Loading the audit trail..." />
  if (logs.isError) {
    return (
      <>
        <p className="administration-error-note">{describeApiError(logs.error)}</p>
        <ErrorState onRetry={logs.refetch} />
      </>
    )
  }

  const items = logs.data?.items ?? []
  const pagination = logs.data?.pagination

  return (
    <>
      <div className="administration-filters">
        <label>
          <span>Action</span>
          <select
            value={action}
            onChange={(event) => { setAction(event.target.value); setPage(1) }}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {(filters.data?.actions ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Entity</span>
          <select
            value={entityType}
            onChange={(event) => { setEntityType(event.target.value); setPage(1) }}
            aria-label="Filter by entity type"
          >
            <option value="">All entities</option>
            {(filters.data?.entityTypes ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        {(action || entityType) && (
          <button type="button" className="administration-clear" onClick={() => { setAction(''); setEntityType(''); setPage(1) }}>
            <Icon name="xmark" /> Clear
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="clipboard-list"
          title="No entries yet"
          description={
            action || entityType
              ? 'No audit entries match these filters.'
              : 'Nothing has been changed through the admin panel yet. Actions such as approving a product or suspending a store will appear here.'
          }
        />
      ) : (
        <>
          <div className="administration-table-wrap">
            <table className="administration-table">
              <thead>
                <tr><th>When</th><th>Action</th><th>Entity</th><th>Details</th><th>By</th><th>IP</th></tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="administration-when">{formatWhen(entry.createdAt)}</td>
                    <td><span className={`administration-action tone-${actionTone(entry.action)}`}>{actionLabel(entry.action)}</span></td>
                    <td>
                      <strong>{entry.entityType}</strong>
                      {entry.entityId && <small title={entry.entityId}>{entry.entityId}</small>}
                    </td>
                    <td className="administration-detail">{summarise(entry)}</td>
                    <td>
                      <strong>{entry.actor.name}</strong>
                      <small>{entry.actor.role}</small>
                    </td>
                    <td className="administration-ip">{entry.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="administration-pagination">
              <span>Page {pagination.page} of {pagination.totalPages} — {pagination.total} entries</span>
              <div>
                <button type="button" disabled={pagination.page === 1} onClick={() => setPage((value) => value - 1)}>
                  <Icon name="chevron-left" /> Previous
                </button>
                <button type="button" disabled={!pagination.hasNext} onClick={() => setPage((value) => value + 1)}>
                  Next <Icon name="chevron-right" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="administration-footnote">
        Showing administrative changes only. {title === 'Admin Activity' ? 'Every entry is an action taken through the admin panel.' : 'Entries are written after the change succeeds and are never edited.'}
      </p>
    </>
  )
}

export default function AdminAdministrationPages({ type = 'users' }) {
  const title = TITLES[type] || TITLES.users
  const isAuditView = type === 'audit' || type === 'activity'
  const isRoleView = type === 'roles' || type === 'access'
  const StaffSection = { users: StaffView, sessions: SessionsView, teams: TeamsView }[type] ?? StaffView

  return (
    <AdminLayout>
      <div className="administration-page">
        <Heading section="administration" crumb="Administration" title={title} />
        <section className="administration-panel">
          {isAuditView ? (
            <AuditLogView title={title} />
          ) : isRoleView ? (
            <AdminRolesView mode={type === 'roles' ? 'roles' : 'access'} />
          ) : (
            // Every routed type resolves to one of these; StaffView is the sensible landing
            // page for an unrecognised one rather than an error.
            <StaffSection />
          )}
        </section>
      </div>
    </AdminLayout>
  )
}
