import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import { Pagination } from './AdminComponents'
import { useAdminSession } from '../AdminSession'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import './seller-pages.css'

/**
 * Seller payouts.
 *
 * This page used to be invented rows with a "Create Payout" button that showed a toast and
 * did nothing — the worst version of that bug in the panel, because it concerned money.
 *
 * What it does now is record decisions, not move money: Mirwal has no bank integration, the
 * transfer happens outside the system, and marking a payout `paid` requires the bank's own
 * reference so the row can be reconciled afterwards. The server enforces the order
 * (requested → approved → paid); the buttons here only offer transitions it will accept.
 */

const STATUS_TABS = [
  ['', 'All'],
  ['requested', 'Requested'],
  ['approved', 'Approved'],
  ['paid', 'Paid'],
  ['rejected', 'Rejected'],
]

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdminPayouts() {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  // Approving, paying and rejecting all move money, so they are gated the way the route is.
  const { can } = useAdminSession()
  const canDecide = can('settings.manage')

  const stats = useApiQuery((signal) => api.admin.payouts.stats(signal), [])
  /**
   * Paged rather than capped at fifty.
   *
   * A fixed `pageSize: 50` is a cap dressed as a page: the fifty-first withdrawal request was
   * unreachable, and nothing on screen said so.
   */
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const list = useApiQuery(
    (signal) => api.admin.payouts.list({ page, pageSize, ...(status ? { status } : {}) }, signal),
    [status, page, pageSize],
  )
  const refresh = useCallback(() => { list.refetch(); stats.refetch() }, [list, stats])

  const run = async (id, action) => {
    setBusy(id)
    setFlash(null)
    try {
      const { message } = await action()
      setFlash({ tone: 'success', text: message ?? 'Payout updated.' })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }

  const approve = (payout) => run(payout.id, () => api.admin.payouts.setStatus(payout.id, { status: 'approved' }))

  const markPaid = (payout) => {
    // The API refuses `paid` without a reference — there would be nothing to reconcile the
    // transfer against — so it is collected here rather than sent blank and rejected.
    const reference = window.prompt(
      `Bank/transfer reference for ${payout.reference} (${payout.netAmount?.display} to ${payout.seller?.name}):`,
    )
    if (!reference?.trim()) return
    run(payout.id, () => api.admin.payouts.setStatus(payout.id, { status: 'paid', externalReference: reference.trim() }))
  }

  const reject = (payout) => {
    const reason = window.prompt(`Why is ${payout.reference} being rejected?\nIts order items are released back to the seller's balance.`)
    if (!reason?.trim()) return
    run(payout.id, () => api.admin.payouts.setStatus(payout.id, { status: 'rejected', failureReason: reason.trim() }))
  }

  const items = list.data?.items ?? []

  return (
    <AdminLayout>
      <div className="seller-page">
        <div className="seller-heading">
          <div>
            <h1>Seller Payouts</h1>
            <p>Home <Icon name="chevron-right" /> Sellers <Icon name="chevron-right" /> Payouts</p>
          </div>
        </div>

        {stats.data && (
          <div className="seller-kpis">
            {[
              ['Awaiting review', stats.data.requested, 'clock', 2],
              ['Approved', stats.data.approved, 'circle-check', 1],
              ['Paid out', stats.data.paidAmount?.display ?? '—', 'money-bill-transfer', 1],
              ['Owed', stats.data.pendingAmount?.display ?? '—', 'wallet', 0],
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
          {flash && (
            <p className={`seller-flash ${flash.tone}`} role="status">
              <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
            </p>
          )}

          <div className="seller-tabs">
            {STATUS_TABS.map(([value, label]) => (
              <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1) }}>
                {label}
              </button>
            ))}
          </div>

          {list.isLoading && <LoadingState label="Loading payouts" />}
          {list.isError && !list.isLoading && (
            <>
              <p className="seller-error-note">{describeApiError(list.error)}</p>
              <ErrorState onRetry={list.refetch} />
            </>
          )}

          {!list.isLoading && !list.isError && (items.length === 0 ? (
            <EmptyState
              icon="money-bill-transfer"
              title="No withdrawal requests"
              description={status ? `No ${status} payouts.` : 'Sellers request withdrawals from their own portal; those requests arrive here for approval.'}
            />
          ) : (
            <>
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th>Reference</th><th>Store</th><th>Items</th><th>Gross</th>
                    <th>Commission</th><th>Net</th><th>Status</th><th>Requested</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((payout) => (
                    <tr key={payout.id}>
                      <td>
                        <code>{payout.reference}</code>
                        {payout.externalReference && <small>bank ref {payout.externalReference}</small>}
                      </td>
                      <td>
                        {/* The store is a door: a payout is a question about a seller, and
                            reaching them meant going to Sellers and searching by name. */}
                        {payout.seller?.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${payout.seller.id}`)}>{payout.seller.name}</button>
                          : (payout.seller?.name ?? '—')}
                      </td>
                      <td>{payout.itemCount ?? '—'}</td>
                      <td>{payout.grossAmount?.display ?? '—'}</td>
                      <td>{payout.commissionAmount?.display ?? '—'}</td>
                      <td><strong>{payout.netAmount?.display ?? '—'}</strong></td>
                      <td>
                        <span className={`seller-status ${payout.status}`}>{payout.status}</span>
                        {payout.failureReason && <small>{payout.failureReason}</small>}
                      </td>
                      <td>{formatDate(payout.requestedAt)}</td>
                      <td className="seller-row-actions">
                        {/* Only transitions the server will accept are offered. */}
                        {canDecide && payout.status === 'requested' && (
                          <>
                            <button type="button" className="approve" disabled={busy === payout.id} onClick={() => approve(payout)}>
                              {busy === payout.id ? '...' : 'Approve'}
                            </button>
                            <button type="button" className="reject" disabled={busy === payout.id} onClick={() => reject(payout)}>Reject</button>
                          </>
                        )}
                        {canDecide && (payout.status === 'approved' || payout.status === 'processing') && (
                          <button type="button" className="approve" disabled={busy === payout.id} onClick={() => markPaid(payout)}>
                            {busy === payout.id ? '...' : 'Mark paid'}
                          </button>
                        )}
                        {(!canDecide || ['paid', 'rejected', 'failed'].includes(payout.status)) && <span className="seller-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              section="seller"
              page={list.data?.pagination?.page ?? page}
              pageSize={list.data?.pagination?.pageSize ?? pageSize}
              total={list.data?.pagination?.total ?? 0}
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1) }}
            />
            </>
          ))}

          <p className="seller-footnote">
            Mirwal does not transfer funds itself. Approving records the decision; marking a payout paid
            records a transfer that already happened, against the bank&rsquo;s own reference.
          </p>
        </section>
      </div>
    </AdminLayout>
  )
}
