import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import { Pagination } from './AdminComponents'
import api from '../api'
import './order-pages.css'
import './finance-pages.css'

/**
 * Returns, refunds, and one dispute in detail.
 *
 * These pages said there was no returns or refunds system. `return_requests` has existed since
 * migration 005 and `refunds` since 008 — the seller portal has been approving returns against
 * them the whole time. What was missing was a platform-wide view, and somewhere to settle the
 * refunds that need a person.
 *
 * The one action here is settling a manual refund. Approving or rejecting a return still
 * belongs to the seller it was filed against: an admin quietly overriding that would leave the
 * seller with stock decisions made for them and no record of why.
 *
 * A refund the payment provider owns cannot be settled here either. Marking one "paid" by hand
 * would put Mirwal's record permanently out of step with the money, and nothing would correct
 * it — so only `manual_required` refunds offer the action at all.
 */

const number = (value) => Number(value ?? 0).toLocaleString('en-PK')

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

const RETURN_TABS = [['', 'All'], ['requested', 'Awaiting the seller'], ['approved', 'Approved'], ['rejected', 'Rejected']]
const REFUND_TABS = [['', 'All'], ['manual_required', 'Needs action'], ['succeeded', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed']]

function Kpi({ label, value, hint, tone }) {
  return (
    <article className={tone ? `tone-${tone}` : ''}>
      <small>{label}</small>
      <strong>{value}</strong>
      {hint && <em>{hint}</em>}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

function ReturnsList() {
  const [status, setStatus] = useState('')
  /**
   * Paged rather than capped at a hundred.
   *
   * `pageSize: 100` reads as a page and behaves as a ceiling — the hundred-and-first return was
   * unreachable, and nothing on screen admitted it existed.
   */
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const query = useApiQuery(
    (signal) => api.admin.returns.list({ page, pageSize, ...(status ? { status } : {}) }, signal),
    [status, page, pageSize],
  )

  const items = query.data?.items ?? []
  const stats = query.data?.stats

  return (
    <AdminLayout>
      <div className="order-page">
        <Heading section="order" crumb="Orders" title="Returns" />

        {stats && (
          <div className="fulfil-kpis">
            <Kpi label="Total requests" value={number(stats.total)} />
            <Kpi label="Awaiting the seller" value={number(stats.requested)} tone="warn" hint="The seller decides these" />
            <Kpi label="Approved" value={number(stats.approved)} />
            <Kpi label="Rejected" value={number(stats.rejected)} />
          </div>
        )}

        <section className="order-panel">
          <div className="fulfil-tabs">
            {RETURN_TABS.map(([value, label]) => (
              <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>
            ))}
          </div>

          <p className="finance-note">
            Platform-wide oversight. Approving or rejecting a return is the seller&rsquo;s decision, made in their own
            portal — this view exists so a pattern across sellers is visible, not to override one.
          </p>

          {query.isLoading && <LoadingState label="Loading returns" />}
          {query.isError && !query.isLoading && (
            <>
              <p className="finance-note error">{describeApiError(query.error)}</p>
              <ErrorState onRetry={query.refetch} />
            </>
          )}

          {!query.isLoading && !query.isError && (items.length === 0 ? (
            <EmptyState icon="rotate-left" title="No return requests" description="Requests appear here when a buyer asks to return an item." />
          ) : (
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr><th>Order</th><th>Item</th><th>Seller</th><th>Buyer</th><th>Reason</th><th>Status</th><th>Refund</th><th className="num">Requested</th></tr>
                </thead>
                <tbody>
                  {items.map((request) => (
                    <tr key={request.id} className="fulfil-row" onClick={() => navigateTo(`/disputes/${request.id}`)}>
                      <td onClick={(event) => event.stopPropagation()}>
                        {request.orderId
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/orders/${request.orderId}`)}><b>{request.orderNumber}</b></button>
                          : <b>{request.orderNumber}</b>}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {request.productId
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/products/${request.productId}`)}><b>{request.productName}</b></button>
                          : <b>{request.productName}</b>}
                        <small>{request.quantity} × {request.amount.display}</small>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {request.seller.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${request.seller.id}`)}>{request.seller.name}</button>
                          : request.seller.name}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {request.buyer.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/customers/${request.buyer.id}`)}>{request.buyer.name}</button>
                          : request.buyer.name}
                      </td>
                      <td>{request.reason}{request.description && <small>{request.description.slice(0, 70)}</small>}</td>
                      <td><span className={`finance-pill ${request.status}`}>{request.status}</span></td>
                      <td>{request.refund ? <span className={`finance-pill ${request.refund.status}`}>{request.refund.status}</span> : '—'}</td>
                      <td className="num">{formatWhen(request.requestedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                section="fulfil"
                page={query.data?.pagination?.page ?? page}
                pageSize={query.data?.pagination?.pageSize ?? pageSize}
                total={query.data?.pagination?.total ?? 0}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1) }}
              />

            </div>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

function SettleForm({ refund, onDone, onCancel }) {
  const [outcome, setOutcome] = useState('succeeded')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.admin.refunds.settle(refund.id, {
        status: outcome,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      onDone(result.message)
    } catch (requestError) {
      setError(describeApiError(requestError))
      setBusy(false)
    }
  }

  return (
    <form className="fulfil-settle" onSubmit={submit}>
      <h3>Settle {refund.amount.display} for {refund.orderNumber}</h3>
      <p className="finance-note">
        Records what already happened outside Mirwal. This does not move money — it says that someone did, or
        could not.
      </p>

      {error && <p className="finance-note error">{error}</p>}

      <div className="fulfil-choice">
        <label className={outcome === 'succeeded' ? 'active' : ''}>
          <input type="radio" name="outcome" checked={outcome === 'succeeded'} onChange={() => setOutcome('succeeded')} />
          <b>Paid</b><small>The buyer is emailed a confirmation with the reference below.</small>
        </label>
        <label className={outcome === 'failed' ? 'active' : ''}>
          <input type="radio" name="outcome" checked={outcome === 'failed'} onChange={() => setOutcome('failed')} />
          <b>Could not be paid</b><small>Needs a reason. No email is sent.</small>
        </label>
      </div>

      {outcome === 'succeeded' ? (
        <label>
          Payment reference
          <small>Whatever proves the money moved — a bank reference or wallet transaction id. Included in the buyer&rsquo;s email.</small>
          <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={191} />
        </label>
      ) : (
        <label>
          Why it could not be paid
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} required />
        </label>
      )}

      <div className="fulfil-settle-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Record it'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

function RefundsList() {
  const [status, setStatus] = useState('manual_required')
  const [settling, setSettling] = useState(null)
  const [flash, setFlash] = useState(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const query = useApiQuery(
    (signal) => api.admin.refunds.list({ page, pageSize, ...(status ? { status } : {}) }, signal),
    [status],
  )
  const refresh = useCallback(() => { query.refetch() }, [query])

  const items = query.data?.items ?? []
  const stats = query.data?.stats

  return (
    <AdminLayout>
      <div className="order-page">
        <Heading section="order" crumb="Orders" title="Refunds" />

        {stats && (
          <div className="fulfil-kpis">
            <Kpi label="Needs action" value={number(stats.manualRequired)} tone="warn" hint={stats.outstanding.display} />
            <Kpi label="Paid" value={number(stats.succeeded)} hint={stats.refunded.display} />
            <Kpi label="Pending with provider" value={number(stats.pending)} />
            <Kpi label="Failed" value={number(stats.failed)} tone={stats.failed > 0 ? 'danger' : undefined} />
          </div>
        )}

        {flash && (
          <p className="shipping-flash success" role="status"><Icon name="circle-check" /> {flash}</p>
        )}

        <section className="order-panel">
          <div className="fulfil-tabs">
            {REFUND_TABS.map(([value, label]) => (
              <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>
            ))}
          </div>

          <p className="finance-note">
            Only refunds marked <b>needs action</b> can be settled here — a cash-on-delivery order cannot be
            reversed through a provider, so a person has to send the money back and say so. Everything else is
            settled by the payment provider&rsquo;s own callback.
          </p>

          {settling && (
            <SettleForm
              refund={settling}
              onCancel={() => setSettling(null)}
              onDone={(message) => { setSettling(null); setFlash(message); refresh() }}
            />
          )}

          {query.isLoading && <LoadingState label="Loading refunds" />}
          {query.isError && !query.isLoading && (
            <>
              <p className="finance-note error">{describeApiError(query.error)}</p>
              <ErrorState onRetry={query.refetch} />
            </>
          )}

          {!query.isLoading && !query.isError && (items.length === 0 ? (
            <EmptyState
              icon="money-bill-transfer"
              title={status === 'manual_required' ? 'Nothing needs paying by hand' : 'No refunds'}
              description="Refunds appear here when a return is approved or an order is cancelled after payment."
            />
          ) : (
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead>
                  <tr><th>Order</th><th>Buyer</th><th className="num">Amount</th><th>Via</th><th>Status</th><th>Reference</th><th className="num">Created</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((refund) => (
                    <tr key={refund.id}>
                      <td>
                        {refund.orderId
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/orders/${refund.orderId}`)}><b>{refund.orderNumber}</b></button>
                          : <b>{refund.orderNumber}</b>}
                      </td>
                      <td>
                        {refund.buyer.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/customers/${refund.buyer.id}`)}>{refund.buyer.name}</button>
                          : refund.buyer.name}
                        <small>{refund.buyer.email}</small>
                      </td>
                      <td className="num">{refund.amount.display}</td>
                      <td>{refund.provider.toUpperCase()}</td>
                      <td>
                        <span className={`finance-pill ${refund.status === 'manual_required' ? 'pending' : refund.status}`}>
                          {refund.status === 'manual_required' ? 'needs action' : refund.status}
                        </span>
                        {refund.failureReason && <small>{refund.failureReason}</small>}
                      </td>
                      <td>{refund.providerRef ?? '—'}{refund.settledBy && <small>by {refund.settledBy}</small>}</td>
                      <td className="num">{formatWhen(refund.createdAt)}</td>
                      <td className="num">
                        {refund.status === 'manual_required' && (
                          <button type="button" className="fulfil-settle-button" onClick={() => setSettling(refund)}>Settle</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                section="fulfil"
                page={query.data?.pagination?.page ?? page}
                pageSize={query.data?.pagination?.pageSize ?? pageSize}
                total={query.data?.pagination?.total ?? 0}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1) }}
              />

            </div>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// One dispute
// ---------------------------------------------------------------------------

/**
 * One return in full, plus every other return the same buyer has filed.
 *
 * That last part is the reason the page is worth having. A single return tells you nothing; a
 * buyer's fifth return this month tells you what to look at.
 */
function DisputeDetail() {
  const { pathname } = useLocation()
  const id = pathname.split('/').filter(Boolean).pop()
  const query = useApiQuery((signal) => api.admin.disputes.get(id, signal), [id])

  if (query.isLoading) {
    return <AdminLayout><div className="order-page"><LoadingState label="Loading dispute" /></div></AdminLayout>
  }
  if (query.isError) {
    return (
      <AdminLayout>
        <div className="order-page">
          <Heading section="order" crumb="Orders" title="Dispute" />
          <section className="order-panel">
            <p className="finance-note error">{describeApiError(query.error)}</p>
            <ErrorState onRetry={query.refetch} />
          </section>
        </div>
      </AdminLayout>
    )
  }

  const dispute = query.data

  return (
    <AdminLayout>
      <div className="order-page">
        <Heading section="order" crumb="Orders" title={`Return · ${dispute.orderNumber}`} />

        <div className="fulfil-detail">
          <section className="order-panel">
            <h2>The request</h2>
            <dl className="fulfil-facts">
              <div><dt>Item</dt><dd>{dispute.productName} <small>SKU {dispute.sku}</small></dd></div>
              <div><dt>Quantity</dt><dd>{dispute.quantity} · {dispute.amount.display}</dd></div>
              <div><dt>Reason</dt><dd>{dispute.reason}</dd></div>
              {dispute.description && <div><dt>What the buyer said</dt><dd>{dispute.description}</dd></div>}
              <div><dt>Status</dt><dd><span className={`finance-pill ${dispute.status}`}>{dispute.status}</span></dd></div>
              {dispute.resolutionNote && <div><dt>Seller&rsquo;s note</dt><dd>{dispute.resolutionNote}</dd></div>}
              <div><dt>Requested</dt><dd>{formatWhen(dispute.requestedAt)}</dd></div>
              {dispute.resolvedAt && <div><dt>Resolved</dt><dd>{formatWhen(dispute.resolvedAt)}</dd></div>}
            </dl>
          </section>

          <section className="order-panel">
            <h2>Order &amp; parties</h2>
            <dl className="fulfil-facts">
              {dispute.order && (
                <>
                  <div><dt>Order</dt><dd><b>{dispute.order.orderNumber}</b> · {dispute.order.total.display}</dd></div>
                  <div><dt>Order status</dt><dd>{dispute.order.status} · payment {dispute.order.paymentStatus} ({dispute.order.paymentMethod.toUpperCase()})</dd></div>
                  <div><dt>Placed</dt><dd>{formatWhen(dispute.order.placedAt)}</dd></div>
                  <div><dt>Delivering to</dt><dd>{dispute.order.destination || '—'}</dd></div>
                </>
              )}
              <div><dt>Buyer</dt><dd>{dispute.buyer.name}<small>{dispute.buyer.email}</small></dd></div>
              <div><dt>Seller</dt><dd>{dispute.seller.name}</dd></div>
              <div>
                <dt>Refund</dt>
                <dd>
                  {dispute.refund
                    ? <>{dispute.refund.amount.display} · <span className={`finance-pill ${dispute.refund.status === 'manual_required' ? 'pending' : dispute.refund.status}`}>{dispute.refund.status === 'manual_required' ? 'needs action' : dispute.refund.status}</span></>
                    : 'None raised'}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="order-panel">
          <h2>This buyer&rsquo;s other returns</h2>
          <p className="finance-note">
            One return says nothing. A pattern does — which is the only thing this list is for.
          </p>
          {dispute.buyerHistory.length === 0 ? (
            <p className="finance-note">This is the only return this buyer has filed.</p>
          ) : (
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead><tr><th>Item</th><th>Reason</th><th>Status</th><th className="num">Requested</th></tr></thead>
                <tbody>
                  {dispute.buyerHistory.map((entry) => (
                    <tr key={entry.id} className="fulfil-row" onClick={() => navigateTo(`/disputes/${entry.id}`)}>
                      <td>{entry.productName}</td>
                      <td>{entry.reason}</td>
                      <td><span className={`finance-pill ${entry.status}`}>{entry.status}</span></td>
                      <td className="num">{formatWhen(entry.requestedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}

export default function AdminFulfilmentPages({ view = 'returns', detail = false }) {
  if (detail) return <DisputeDetail />
  return view === 'refunds' ? <RefundsList /> : <ReturnsList />
}
