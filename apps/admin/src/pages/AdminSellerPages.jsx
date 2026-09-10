import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import AdminLayout from './AdminLayout'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { useAdminSession } from '../AdminSession'
import api from '../api'
import Icon from '@mirwal/shared/Icon'
import './seller-pages.css'

/**
 * Seller management.
 *
 * Sellers, Applications and the seller detail view are now backed by the admin seller API
 * (`GET/POST /admin/sellers/*`). Previously these were hard-coded tables of invented stores,
 * and — worse — the detail page's Approve/Suspend buttons set a local success message without
 * touching a backend, so a moderation action appeared to succeed while nothing happened.
 *
 * The buttons here perform the real transition, and the server enforces the state machine:
 * only a pending or rejected store can be approved, only an approved one suspended, and
 * rejection/suspension require a reason that is stored and shown back. Suspending also
 * delists that seller's active products in the same transaction, which is why the confirm
 * dialog says so — an admin should not discover that side effect afterwards.
 *
 * Applications is the same endpoint filtered to `status: 'pending'`: an application is a
 * store awaiting a decision, not a separate entity.
 *
 * Verification, Performance and Payouts each moved to their own page once a real source
 * existed for them — seller_documents (017), order-item metrics, and payouts (014).
 */

const STATUS_TABS = [
  ['', 'All'],
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['suspended', 'Suspended'],
  ['rejected', 'Rejected'],
]

function Status({ value }) {
  return <span className={`seller-status ${value}`}>{value}</span>
}

function formatDate(value) {
  if (!value) return '—'
  // MariaDB's "YYYY-MM-DD HH:MM:SS.mmm" needs the space swapped for a T before Safari parses it.
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Collect the mandatory reason for a rejection or suspension.
 *
 * A prompt rather than a bare confirm because the API refuses a reasonless rejection — and
 * because the reason is shown to the seller, so it has to be written by a human.
 */
function useModeration(onDone) {
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)

  const run = useCallback(async (key, action, successPrefix) => {
    setBusy(key)
    setMessage(null)
    try {
      const result = await action()
      setMessage({ tone: 'success', text: result?.message ?? `${successPrefix} done.` })
      await onDone?.()
    } catch (error) {
      setMessage({ tone: 'error', text: describeApiError(error) })
    } finally {
      setBusy(null)
    }
  }, [onDone])

  return { busy, message, setMessage, run }
}

function SellerList({ mode }) {
  const isApplications = mode === 'applications'
  const [status, setStatus] = useState(isApplications ? 'pending' : '')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // Approving and rejecting a store is its own permission on the route; a reviewer without
  // it sees the store and no decision buttons rather than an error after clicking.
  const { can } = useAdminSession()
  const canDecide = can('seller.approve')

  const counts = useApiQuery((signal) => api.admin.sellers.statusCounts(signal), [])
  const list = useApiQuery(
    (signal) => api.admin.sellers.list(
      { page, pageSize: 25, ...(status ? { status } : {}), ...(search ? { search } : {}) },
      signal,
    ),
    [page, status, search],
  )

  const refresh = useCallback(async () => { list.refetch(); counts.refetch() }, [list, counts])
  const { busy, message, run } = useModeration(refresh)

  const approve = (seller) => run(seller.id, () => api.admin.sellers.approve(seller.id), 'Approval')
  const reject = (seller) => {
    const reason = window.prompt(`Why is "${seller.storeName}" being rejected?\nThe applicant will see this.`)
    if (!reason?.trim()) return undefined
    return run(seller.id, () => api.admin.sellers.reject(seller.id, reason.trim()), 'Rejection')
  }

  const items = list.data?.items ?? []
  const pagination = list.data?.pagination
  const title = isApplications ? 'Seller Applications' : 'All Sellers'

  return (
    <AdminLayout>
      <div className="seller-page">
        <div className="seller-heading">
          <div>
            <h1>{title}</h1>
            <p>Home <Icon name="chevron-right" /> Sellers <Icon name="chevron-right" /> {title}</p>
          </div>
        </div>

        {counts.data && (
          <div className="seller-kpis">
            {[
              ['Total Stores', counts.data.all, 'users', 0],
              ['Awaiting Review', counts.data.pending, 'clock', 2],
              ['Approved', counts.data.approved, 'circle-check', 1],
              ['Suspended', counts.data.suspended, 'ban', 3],
            ].map(([label, value, icon, tone]) => (
              <article key={label}>
                <span className={`seller-kpi-icon tone-${tone}`}><Icon name={icon} /></span>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        )}

        <section className="seller-panel">
          {!isApplications && (
            <div className="seller-tabs">
              {STATUS_TABS.map(([value, label]) => (
                <button
                  type="button"
                  key={label}
                  className={status === value ? 'active' : ''}
                  onClick={() => { setStatus(value); setPage(1) }}
                >
                  {label}
                  {counts.data && <em>{value ? counts.data[value] ?? 0 : counts.data.all}</em>}
                </button>
              ))}
            </div>
          )}

          <div className="seller-filters">
            <label>
              <Icon name="magnifying-glass" />
              <input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                placeholder="Search store, legal name or owner email..."
                aria-label="Search sellers"
              />
            </label>
            <button type="button" onClick={() => { setSearch(''); setPage(1) }}><Icon name="rotate-left" /> Reset</button>
          </div>

          {message && (
            <p className={`seller-flash ${message.tone}`} role="status">
              <Icon name={message.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {message.text}
            </p>
          )}

          {list.isLoading && <LoadingState label="Loading sellers" />}
          {list.isError && !list.isLoading && (
            <>
              <p className="seller-error-note">{describeApiError(list.error)}</p>
              <ErrorState onRetry={list.refetch} />
            </>
          )}

          {!list.isLoading && !list.isError && (items.length === 0 ? (
            <EmptyState
              icon="users"
              title={isApplications ? 'No applications waiting' : 'No sellers found'}
              description={
                isApplications
                  ? 'Every seller application has been reviewed. New applications will appear here.'
                  : 'Nothing matches your search or filter.'
              }
            />
          ) : (
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th>Store</th><th>Owner</th><th>City</th><th>Products</th>
                    <th>Status</th><th>{isApplications ? 'Applied' : 'Joined'}</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((seller) => (
                    <tr key={seller.id}>
                      <td>
                        <button type="button" className="seller-link" onClick={() => navigateTo(`/sellers/${seller.id}`)}>
                          {seller.storeName}
                        </button>
                        {seller.legalName !== seller.storeName && <small>{seller.legalName}</small>}
                      </td>
                      <td>
                        {/* The owner is a person with orders of their own; reaching them meant
                            going to Customers and searching by name. */}
                        {seller.owner?.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/customers/${seller.owner.id}`)}>{seller.owner.name}</button>
                          : (seller.owner?.name ?? '—')}
                        {seller.owner?.email && <small>{seller.owner.email}</small>}
                      </td>
                      <td>{seller.city || '—'}</td>
                      <td>{seller.productCount}</td>
                      <td><Status value={seller.status} /></td>
                      <td>{formatDate(seller.createdAt)}</td>
                      <td className="seller-row-actions">
                        {canDecide && seller.status === 'pending' ? (
                          <>
                            <button type="button" className="approve" disabled={busy === seller.id} onClick={() => approve(seller)}>
                              {busy === seller.id ? 'Working...' : 'Approve'}
                            </button>
                            <button type="button" className="reject" disabled={busy === seller.id} onClick={() => reject(seller)}>
                              Reject
                            </button>
                          </>
                        ) : (
                          <button type="button" aria-label={`View ${seller.storeName}`} onClick={() => navigateTo(`/sellers/${seller.id}`)}>
                            <Icon name="eye" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {pagination && pagination.totalPages > 1 && (
            <div className="seller-footer">
              <span>Page {pagination.page} of {pagination.totalPages} — {pagination.total} stores</span>
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
        </section>
      </div>
    </AdminLayout>
  )
}

function SellerDetail() {
  const { pathname } = useLocation()
  // Routes are `/sellers/<publicId>` in this standalone app — there is no `/admin` prefix.
  const sellerId = pathname.split('/').filter(Boolean)[1] ?? ''

  const detail = useApiQuery((signal) => api.admin.sellers.get(sellerId, signal), [sellerId])
  const refresh = useCallback(async () => { detail.refetch() }, [detail])
  const { busy, message, run } = useModeration(refresh)

  if (detail.isLoading) return <AdminLayout><LoadingState label="Loading seller" /></AdminLayout>
  if (detail.isError || !detail.data) {
    return (
      <AdminLayout>
        <p className="seller-error-note">{describeApiError(detail.error)}</p>
        <ErrorState onRetry={detail.refetch} />
      </AdminLayout>
    )
  }

  const seller = detail.data
  const withReason = (verb, action) => {
    const reason = window.prompt(
      verb === 'suspend'
        ? `Why is "${seller.storeName}" being suspended?\nThis also delists their active products from the storefront.`
        : `Why is "${seller.storeName}" being rejected?\nThe applicant will see this.`,
    )
    if (!reason?.trim()) return undefined
    return run('action', () => action(reason.trim()), verb)
  }

  return (
    <AdminLayout>
      <div className="seller-detail">
        <div className="seller-heading">
          <div>
            <h1>Seller Details</h1>
            <p>Home <Icon name="chevron-right" /> Sellers <Icon name="chevron-right" /> {seller.storeName}</p>
          </div>
          <div className="seller-actions">
            {(seller.status === 'pending' || seller.status === 'rejected') && (
              <button type="button" className="primary" disabled={busy} onClick={() => run('action', () => api.admin.sellers.approve(seller.id), 'Approval')}>
                <Icon name="circle-check" /> Approve
              </button>
            )}
            {seller.status === 'pending' && (
              <button type="button" disabled={busy} onClick={() => withReason('reject', (reason) => api.admin.sellers.reject(seller.id, reason))}>
                Reject
              </button>
            )}
            {seller.status === 'approved' && (
              <button type="button" disabled={busy} onClick={() => withReason('suspend', (reason) => api.admin.sellers.suspend(seller.id, reason))}>
                <Icon name="ban" /> Suspend
              </button>
            )}
            {seller.status === 'suspended' && (
              <button type="button" className="primary" disabled={busy} onClick={() => run('action', () => api.admin.sellers.reinstate(seller.id), 'Reinstatement')}>
                <Icon name="rotate-left" /> Reinstate
              </button>
            )}
          </div>
        </div>

        {message && (
          <p className={`seller-flash ${message.tone}`} role="status">
            <Icon name={message.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {message.text}
          </p>
        )}

        <div className="seller-profile-card">
          <div className="seller-avatar">{seller.storeName.slice(0, 2).toUpperCase()}</div>
          <div>
            <h2>{seller.storeName} <Status value={seller.status} /></h2>
            <p>{seller.city || 'City not set'}{seller.owner ? ` — ${seller.owner.name}` : ''}</p>
            <small>Joined {formatDate(seller.createdAt)}{seller.approvedBy ? ` — approved by ${seller.approvedBy}` : ''}</small>
          </div>
          <dl>
            <div><dt>Products</dt><dd>{seller.productCount}</dd></div>
            <div><dt>Orders</dt><dd>{seller.stats.orderCount}</dd></div>
            <div><dt>Revenue</dt><dd>{seller.stats.grossRevenue?.display ?? '—'}</dd></div>
            <div><dt>Rating</dt><dd>{seller.rating.count > 0 ? `${seller.rating.average.toFixed(1)} ★ (${seller.rating.count})` : 'No reviews yet'}</dd></div>
          </dl>
        </div>

        {/* The reason is the whole point of a suspension/rejection — surface it, never hide it. */}
        {seller.suspendedReason && (
          <p className="seller-reason">
            <Icon name="triangle-exclamation" /> <strong>{seller.status === 'rejected' ? 'Rejected' : 'Suspended'}:</strong> {seller.suspendedReason}
          </p>
        )}
        {seller.description && <p className="seller-description">{seller.description}</p>}

        <div className="seller-detail-grid">
          <section className="seller-panel">
            <h2>Catalogue</h2>
            <dl className="seller-breakdown">
              <div><dt>Active</dt><dd>{seller.stats.products.active}</dd></div>
              <div><dt>Awaiting review</dt><dd>{seller.stats.products.pendingReview}</dd></div>
              <div><dt>Draft</dt><dd>{seller.stats.products.draft}</dd></div>
              <div><dt>Rejected</dt><dd>{seller.stats.products.rejected}</dd></div>
            </dl>
            <button type="button" className="seller-link" onClick={() => navigateTo('/products')}>
              View all products <Icon name="chevron-right" />
            </button>
          </section>
          <section className="seller-panel">
            <h2>Contact</h2>
            <dl className="seller-breakdown">
              <div><dt>Owner</dt><dd>{seller.owner?.name ?? '—'}</dd></div>
              <div><dt>Email</dt><dd>{seller.owner?.email ?? '—'}</dd></div>
              <div><dt>Support email</dt><dd>{seller.supportEmail ?? '—'}</dd></div>
              <div><dt>Support phone</dt><dd>{seller.supportPhone ?? '—'}</dd></div>
            </dl>
          </section>
        </div>
      </div>
    </AdminLayout>
  )
}

export default function AdminSellerPages({ type = 'sellers', detail = false }) {
  if (detail) return <SellerDetail />
  return <SellerList mode={type} />
}
