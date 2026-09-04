import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './operations-pages.css'

/**
 * Blocked Accounts, Notifications, Seller Performance, Product Reports, System/Error Logs and
 * Attributes — the last group of admin surfaces.
 *
 * Two of these were previously impossible for real reasons that no longer hold:
 *
 *   - Error Logs had nothing to read because failures went only to the console. `errorHandler.js`
 *     now records every 5xx to `system_logs`, so this page reports what actually broke.
 *   - Seller Performance had no metrics. Every rate here is a ratio of real order-item counts;
 *     there is deliberately no composite "seller score", which would be a number Mirwal invented.
 */

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`ops-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

function Shell({ title, crumb = 'Operations', children, kpis }) {
  return (
    <AdminLayout>
      <div className="ops-page">
        <Heading section="ops" crumb={crumb} title={title} />
        {kpis && (
          <div className="ops-kpis">
            {kpis.map(([label, value]) => (
              <article key={label}><small>{label}</small><strong>{value}</strong></article>
            ))}
          </div>
        )}
        <section className="ops-panel">{children}</section>
      </div>
    </AdminLayout>
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

/** Shared loading/error wrapper so each view below stays about its own content. */
function Query({ query, label, children }) {
  if (query.isLoading) return <LoadingState label={label} />
  if (query.isError) {
    return (
      <>
        <p className="ops-error-note">{describeApiError(query.error)}</p>
        <ErrorState onRetry={query.refetch} />
      </>
    )
  }
  return children
}

// ---------------------------------------------------------------------------
// Accounts / blocked accounts
// ---------------------------------------------------------------------------

function AccountsView({ blockedOnly }) {
  const [search, setSearch] = useState('')
  const query = useApiQuery(
    (signal) => api.admin.accounts.list(
      { pageSize: 100, ...(blockedOnly ? { status: 'suspended' } : {}), ...(search ? { search } : {}) },
      signal,
    ),
    [blockedOnly, search],
  )
  const refresh = useCallback(async () => { query.refetch() }, [query])
  const { busy, flash, run } = useAction(refresh)

  const items = query.data?.items ?? []

  return (
    <Shell title={blockedOnly ? 'Blocked Accounts' : 'Accounts'} crumb="Customers">
      <Flash value={flash} />
      <div className="ops-filters">
        <label>
          <Icon name="magnifying-glass" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email..." aria-label="Search accounts" />
        </label>
      </div>

      <Query query={query} label="Loading accounts">
        {items.length === 0 ? (
          <EmptyState
            icon="user-lock"
            title={blockedOnly ? 'No blocked accounts' : 'No accounts found'}
            description={blockedOnly ? 'Nobody is currently suspended.' : 'Nothing matches that search.'}
          />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Orders</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((account) => (
                  <tr key={account.id}>
                    <td><strong>{account.name}</strong></td>
                    <td>{account.email}</td>
                    <td>{account.roles.join(', ') || '—'}</td>
                    <td>{account.orderCount}</td>
                    <td>{formatWhen(account.lastLoginAt)}</td>
                    <td><span className={`ops-status ${account.status}`}>{account.status}</span></td>
                    <td>
                      {account.status === 'suspended' ? (
                        <button type="button" disabled={busy === account.id} onClick={() => run(account.id, () => api.admin.accounts.setStatus(account.id, 'active'))}>
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ops-danger"
                          disabled={busy === account.id}
                          onClick={() => {
                            // Suspension also signs them out everywhere; saying so avoids a
                            // surprise, and the server's message reports how many sessions.
                            if (!window.confirm(`Suspend ${account.name}? They will be signed out of every device and cannot sign in again until restored.`)) return
                            run(account.id, () => api.admin.accounts.setStatus(account.id, 'suspended'))
                          }}
                        >
                          Suspend
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Query>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function NotificationsView() {
  const query = useApiQuery((signal) => api.admin.notifications({ pageSize: 100 }, signal), [])
  const stats = query.data?.stats
  const items = query.data?.items ?? []

  return (
    <Shell
      title="Notifications"
      kpis={stats ? [['Sent', stats.total], ['Unread', stats.unread]] : undefined}
    >
      <Query query={query} label="Loading notifications">
        {items.length === 0 ? (
          <EmptyState icon="bell" title="No notifications" description="Mirwal has not sent any in-app notifications yet." />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Recipient</th><th>Type</th><th>Title</th><th>Sent</th><th>Read</th></tr></thead>
              <tbody>
                {items.map((notification) => (
                  <tr key={notification.id}>
                    <td><strong>{notification.recipient.name}</strong><small>{notification.recipient.email}</small></td>
                    <td>{notification.type}</td>
                    <td>{notification.title}<small>{notification.body}</small></td>
                    <td>{formatWhen(notification.createdAt)}</td>
                    <td><span className={`ops-status ${notification.isRead ? 'active' : 'pending'}`}>{notification.isRead ? 'Read' : 'Unread'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Query>
      <p className="ops-footnote">
        These are in-app notifications. Mirwal sends no email or SMS — there is no provider connected.
      </p>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function PerformanceView() {
  const query = useApiQuery((signal) => api.admin.sellerPerformance(signal), [])
  const items = query.data ?? []
  const rate = (value) => (value == null ? '—' : `${value}%`)

  return (
    <Shell title="Seller Performance" crumb="Sellers">
      <Query query={query} label="Loading performance">
        {items.length === 0 ? (
          <EmptyState icon="chart-column" title="No sellers" description="There are no stores to measure." />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr><th>Store</th><th>Order items</th><th>Delivered</th><th>Fulfilment</th><th>Cancelled</th><th>Returns</th><th>Rating</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {items.map((seller) => (
                  <tr key={seller.id}>
                    <td><strong>{seller.storeName}</strong><small>{seller.status}</small></td>
                    <td>{seller.orderItems}</td>
                    <td>{seller.delivered}</td>
                    <td>{rate(seller.fulfilmentRate)}</td>
                    <td>{rate(seller.cancellationRate)}</td>
                    <td>{rate(seller.returnRate)}</td>
                    <td>{seller.rating.count > 0 ? `${seller.rating.average.toFixed(1)} ★` : '—'}</td>
                    <td><strong>{seller.revenue.display}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Query>
      <p className="ops-footnote">
        Every figure is a ratio of real order items. There is deliberately no composite &ldquo;seller
        score&rdquo; — a weighted index would be a number Mirwal invented, while these rates are what an
        admin can actually act on. A store with no orders shows &ldquo;—&rdquo; rather than 0%.
      </p>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function ReportsView() {
  const [status, setStatus] = useState('')
  const query = useApiQuery(
    (signal) => api.admin.productReports.list({ pageSize: 100, ...(status ? { status } : {}) }, signal),
    [status],
  )
  const refresh = useCallback(async () => { query.refetch() }, [query])
  const { busy, flash, run } = useAction(refresh)

  const decide = (report, decision) => {
    const resolution = window.prompt(
      decision === 'upheld'
        ? `What action was taken on "${report.product.name}"?`
        : `Why is this report being dismissed?`,
    )
    if (!resolution?.trim()) return
    run(report.id, () => api.admin.productReports.resolve(report.id, { status: decision, resolution: resolution.trim() }))
  }

  const items = query.data?.items ?? []
  const stats = query.data?.stats

  return (
    <Shell
      title="Product Reports"
      crumb="Marketplace"
      kpis={stats ? [['Total', stats.total], ['Open', stats.open], ['Upheld', stats.upheld], ['Dismissed', stats.dismissed]] : undefined}
    >
      <Flash value={flash} />
      <div className="ops-tabs">
        {[['', 'All'], ['open', 'Open'], ['upheld', 'Upheld'], ['dismissed', 'Dismissed']].map(([value, label]) => (
          <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>

      <Query query={query} label="Loading reports">
        {items.length === 0 ? (
          <EmptyState
            icon="flag"
            title="No reports"
            description="Shoppers can report a listing from its product page. Reports arrive here for review."
          />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Listing</th><th>Reason</th><th>Details</th><th>Reported by</th><th>When</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((report) => (
                  <tr key={report.id}>
                    <td><strong>{report.product.name}</strong><small>{report.seller}</small></td>
                    <td>{report.reason.replace(/_/g, ' ')}</td>
                    <td className="ops-detail">{report.details || '—'}</td>
                    <td>{report.reporter ? report.reporter.name : 'Anonymous'}</td>
                    <td>{formatWhen(report.createdAt)}</td>
                    <td>
                      <span className={`ops-status ${report.status}`}>{report.status}</span>
                      {report.resolution && <small>{report.resolution}</small>}
                    </td>
                    <td>
                      {report.status === 'open' || report.status === 'reviewing' ? (
                        <div className="ops-actions">
                          <button type="button" className="ops-danger" disabled={busy === report.id} onClick={() => decide(report, 'upheld')}>Uphold</button>
                          <button type="button" disabled={busy === report.id} onClick={() => decide(report, 'dismissed')}>Dismiss</button>
                        </div>
                      ) : <span className="ops-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Query>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function LogsView() {
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const query = useApiQuery(
    (signal) => api.admin.systemLogs({ pageSize: 100, ...(level ? { level } : {}), ...(search ? { search } : {}) }, signal),
    [level, search],
  )
  const [open, setOpen] = useState(null)

  const items = query.data?.items ?? []
  const stats = query.data?.stats

  return (
    <Shell
      title="Error Logs"
      crumb="System"
      kpis={stats ? [['Errors', stats.errors], ['Warnings', stats.warnings], ['Last 24h', stats.last24h]] : undefined}
    >
      <div className="ops-filters">
        <label>
          <Icon name="magnifying-glass" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search message or path..." aria-label="Search logs" />
        </label>
        <select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Filter by level">
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      <Query query={query} label="Loading logs">
        {items.length === 0 ? (
          <EmptyState
            icon="triangle-exclamation"
            title="No errors recorded"
            description="Nothing has failed with a 5xx since logging began. Only server-side failures are recorded — ordinary validation rejections are not errors."
          />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>When</th><th>Level</th><th>Code</th><th>Message</th><th>Request</th><th>User</th><th /></tr></thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log.id}>
                    <td className="ops-when">{formatWhen(log.createdAt)}</td>
                    <td><span className={`ops-level ${log.level}`}>{log.level}</span></td>
                    <td><code>{log.code}</code></td>
                    <td className="ops-detail">{log.message}</td>
                    <td className="ops-muted">{log.method} {log.path}<small>{log.statusCode}</small></td>
                    <td>{log.user ?? '—'}</td>
                    <td>
                      {log.context?.stack && (
                        <button type="button" onClick={() => setOpen(open === log.id ? null : log.id)}>
                          {open === log.id ? 'Hide' : 'Stack'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open && (
              <pre className="ops-stack">
                {(items.find((log) => log.id === open)?.context?.stack ?? []).join('\n')}
              </pre>
            )}
          </div>
        )}
      </Query>
      <p className="ops-footnote">
        Server-side 5xx failures only, recorded as they happen. Request bodies are never stored — they carry
        addresses and, on the auth routes, passwords.
      </p>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function AttributesView() {
  const [form, setForm] = useState({ name: '', inputType: 'text', unit: '', categorySlug: '', options: '' })
  const query = useApiQuery((signal) => api.admin.attributes.list(signal), [])
  const categories = useApiQuery((signal) => api.admin.categories.list(signal), [])
  const refresh = useCallback(async () => { query.refetch() }, [query])
  const { busy, flash, run } = useAction(refresh)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const create = async (event) => {
    event.preventDefault()
    await run('new', () => api.admin.attributes.create({
      name: form.name.trim(),
      inputType: form.inputType,
      ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
      ...(form.categorySlug ? { categorySlug: form.categorySlug } : {}),
      ...(form.inputType === 'select'
        ? { options: form.options.split(',').map((value) => value.trim()).filter(Boolean) }
        : {}),
    }))
    setForm({ name: '', inputType: 'text', unit: '', categorySlug: '', options: '' })
  }

  const items = query.data ?? []

  return (
    <Shell title="Attributes" crumb="Marketplace">
      <Flash value={flash} />
      <form className="ops-form" onSubmit={create}>
        <label>
          <span>Name</span>
          <input value={form.name} onChange={set('name')} required minLength={2} placeholder="Material" />
        </label>
        <label>
          <span>Type</span>
          <select value={form.inputType} onChange={set('inputType')}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Yes / no</option>
            <option value="select">Choice list</option>
          </select>
        </label>
        {form.inputType === 'select' && (
          <label className="ops-form-wide">
            <span>Options</span>
            <input value={form.options} onChange={set('options')} required placeholder="Cotton, Polyester, Wool" />
            <small>Comma separated.</small>
          </label>
        )}
        {form.inputType === 'number' && (
          <label>
            <span>Unit</span>
            <input value={form.unit} onChange={set('unit')} placeholder="cm" />
          </label>
        )}
        <label>
          <span>Category</span>
          <select value={form.categorySlug} onChange={set('categorySlug')}>
            <option value="">Every category</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.slug} value={category.slug}>{category.name}</option>
            ))}
          </select>
        </label>
        <div className="ops-form-actions">
          <button type="submit" className="primary" disabled={busy === 'new'}>{busy === 'new' ? 'Saving...' : 'Add attribute'}</button>
        </div>
      </form>

      <Query query={query} label="Loading attributes">
        {items.length === 0 ? (
          <EmptyState icon="sliders" title="No attributes yet" description="Define the specification fields products in a category should carry, so two sellers describe the same thing the same way." />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Attribute</th><th>Type</th><th>Category</th><th>Options</th><th>Used by</th><th /></tr></thead>
              <tbody>
                {items.map((attribute) => (
                  <tr key={attribute.slug}>
                    <td><strong>{attribute.name}</strong><small>{attribute.slug}</small></td>
                    <td>{attribute.inputType}{attribute.unit ? ` (${attribute.unit})` : ''}</td>
                    <td>{attribute.category ? attribute.category.name : <span className="ops-muted">All</span>}</td>
                    <td className="ops-detail">{attribute.options.length ? attribute.options.join(', ') : '—'}</td>
                    <td>{attribute.usageCount}</td>
                    <td>
                      <button
                        type="button"
                        className="ops-danger"
                        disabled={busy === attribute.slug}
                        onClick={() => {
                          if (!window.confirm(`Delete attribute "${attribute.name}"?`)) return
                          run(attribute.slug, () => api.admin.attributes.remove(attribute.slug))
                        }}
                        aria-label={`Delete ${attribute.name}`}
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Query>
      <p className="ops-footnote">
        Attributes are defined here but the seller product form does not collect them yet — that is the next
        step, and until it exists no listing carries a value. Said plainly rather than shown as a working
        feature.
      </p>
    </Shell>
  )
}

export default function AdminOperationsPages({ view }) {
  if (view === 'blocked') return <AccountsView blockedOnly />
  if (view === 'accounts') return <AccountsView blockedOnly={false} />
  if (view === 'notifications') return <NotificationsView />
  if (view === 'performance') return <PerformanceView />
  if (view === 'reports') return <ReportsView />
  if (view === 'logs') return <LogsView />
  return <AttributesView />
}
