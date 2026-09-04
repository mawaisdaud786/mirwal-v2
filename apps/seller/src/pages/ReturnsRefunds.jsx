import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import './returns-refunds.css'

/**
 * Returns and Cancellations were fully fabricated (same invented customer names as Orders.jsx,
 * fake reasons, a status dropdown that only updated local state). Both are now real:
 *
 * - Returns: `GET /seller/me/returns` — real return requests filed by buyers on this seller's
 *   delivered items (server/src/modules/orders, migration 005). Approve/reject calls the real
 *   `PATCH /seller/me/returns/:id/status`, which restocks inventory on approval and can only
 *   ever resolve a request once (enforced server-side, not just by hiding the buttons after).
 * - Cancellations: a read-only real view of this store's own order items with status
 *   'cancelled' — cancellation is the buyer's own right before anything ships, so there is
 *   nothing for a seller to approve, only to see. Reuses `GET /seller/me/orders` (already real
 *   since Section 29) filtered client-side rather than adding a second endpoint for a subset
 *   of data the first one already returns.
 */

const STATUS_CLASS = { requested: 'pending', approved: 'approved', rejected: 'rejected' }
const STATUS_LABEL = { requested: 'Pending Review', approved: 'Approved', rejected: 'Rejected' }

/**
 * Refunds Mirwal cannot issue automatically — cash on delivery (collected by the courier, so
 * there is no gateway to reverse) and the wallets (whose refund APIs need merchant-portal
 * permissions). The seller refunds the buyer out-of-band and confirms it here; the real state
 * is 'manual_required' until they do, never a fake "refunded".
 */
function ManualRefunds() {
  const { data: refunds, error, isLoading, refetch } = useApiQuery((signal) => api.seller.refunds(signal), [])
  const [settlingId, setSettlingId] = useState(null)
  const [settleError, setSettleError] = useState('')

  async function settle(id) {
    setSettlingId(id)
    setSettleError('')
    try { await api.seller.settleRefund(id); refetch() }
    catch (requestError) { setSettleError(describeApiError(requestError)) }
    finally { setSettlingId(null) }
  }

  if (isLoading || error || !refunds?.length) return null

  return (
    <div className="returns-workspace" style={{ marginBottom: '12px' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-light)' }}>
        <strong style={{ fontSize: 'var(--font-size-2xl)' }}>Refunds you need to pay out ({refunds.length})</strong>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xl)' }}>
          These can&apos;t be reversed automatically. Refund the buyer, then mark it settled here.
        </p>
      </div>
      {settleError && <p style={{ color: 'var(--color-danger)', padding: '8px 14px', margin: 0 }}>{settleError}</p>}
      <div className="returns-table-wrap">
        <table className="returns-table">
          <thead><tr><th>Order</th><th>Amount</th><th>How to refund</th><th>Action</th></tr></thead>
          <tbody>
            {refunds.map((refund) => (
              <tr key={refund.id}>
                <td><strong>{refund.orderNumber}</strong></td>
                <td><strong>{refund.amount.display}</strong></td>
                <td>{refund.manualInstruction}</td>
                <td>
                  <div className="return-actions">
                    <button type="button" className="approve" disabled={settlingId === refund.id} onClick={() => settle(refund.id)}>
                      {settlingId === refund.id ? 'Saving…' : 'Mark refunded'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReturnsTab() {
  const { data: returns, error, isLoading, refetch } = useApiQuery((signal) => api.seller.returns(signal), [])
  const [resolvingId, setResolvingId] = useState(null)
  const [actionError, setActionError] = useState('')

  const stats = useMemo(() => {
    const list = returns ?? []
    return {
      total: list.length,
      pending: list.filter((r) => r.status === 'requested').length,
      approved: list.filter((r) => r.status === 'approved').length,
      rejected: list.filter((r) => r.status === 'rejected').length,
    }
  }, [returns])

  async function resolve(id, status) {
    setResolvingId(id)
    setActionError('')
    try { await api.seller.resolveReturn(id, { status }); refetch() }
    catch (requestError) { setActionError(describeApiError(requestError)) }
    finally { setResolvingId(null) }
  }

  if (isLoading) return <EmptyState icon={<Icon name="spinner" />} title="Loading return requests" text="Fetching your return requests…" />
  if (error) return <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load return requests" text={describeApiError(error)} actionLabel="Try again" onAction={refetch} />

  return (
    <>
      <ManualRefunds />
      <div className="returns-stats">
        <article className="returns-stat stat-0"><i><Icon name="rotate-left" /></i><span>Total Requests</span><strong>{stats.total}</strong></article>
        <article className="returns-stat stat-1"><i><Icon name="clock" /></i><span>Pending Review</span><strong>{stats.pending}</strong></article>
        <article className="returns-stat stat-2"><i><Icon name="circle-check" /></i><span>Approved</span><strong>{stats.approved}</strong></article>
        <article className="returns-stat stat-4"><i><Icon name="circle-xmark" /></i><span>Rejected</span><strong>{stats.rejected}</strong></article>
      </div>
      <div className="returns-workspace">
        {actionError && <p style={{ color: 'var(--color-danger)', padding: '8px 12px' }}>{actionError}</p>}
        {(returns ?? []).length === 0 ? (
          <EmptyState icon={<Icon name="rotate-left" />} title="No return requests" text="When a buyer requests a return on one of your delivered items, it will show up here." />
        ) : (
          <div className="returns-table-wrap">
            <table className="returns-table">
              <thead><tr><th>Order</th><th>Product</th><th>Reason</th><th>Buyer</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {returns.map((request) => (
                  <tr key={request.id}>
                    <td><button type="button" className="return-order-link" onClick={() => navigateTo(`/orders/returns/${request.id}`)}>{request.orderNumber}</button></td>
                    <td className="return-product"><span><Icon name="box" /></span><div><strong>{request.product.name}</strong><small>Qty {request.quantity}</small></div></td>
                    <td>{request.reason}</td>
                    <td className="return-customer"><span>{request.buyer.name.charAt(0)}</span><div><strong>{request.buyer.name}</strong></div></td>
                    <td><strong>{request.lineTotal.display}</strong></td>
                    <td><span className={`request-status ${STATUS_CLASS[request.status]}`}>{STATUS_LABEL[request.status]}</span></td>
                    <td>
                      {request.status === 'requested' ? (
                        <div className="return-actions">
                          <button type="button" className="approve" disabled={resolvingId === request.id} onClick={() => resolve(request.id, 'approved')}>Approve</button>
                          <button type="button" disabled={resolvingId === request.id} onClick={() => resolve(request.id, 'rejected')} aria-label="Reject"><Icon name="xmark" /></button>
                        </div>
                      ) : <small>{request.resolutionNote || '—'}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function CancellationsTab() {
  const { data: items, error, isLoading, refetch } = useApiQuery((signal) => api.seller.orders(signal), [])
  const cancelled = useMemo(() => (items ?? []).filter((item) => item.status === 'cancelled'), [items])

  if (isLoading) return <EmptyState icon={<Icon name="spinner" />} title="Loading cancellations" text="Fetching your order items…" />
  if (error) return <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load cancellations" text={describeApiError(error)} actionLabel="Try again" onAction={refetch} />
  if (cancelled.length === 0) {
    return <EmptyState icon={<Icon name="circle-xmark" />} title="No cancellations" text="Cancellation is the buyer's own right before an item ships — none of your items have been cancelled." />
  }

  return (
    <div className="returns-workspace">
      <div className="returns-table-wrap">
        <table className="returns-table">
          <thead><tr><th>Order</th><th>Product</th><th>Ship To</th><th>Amount</th><th>Date</th></tr></thead>
          <tbody>
            {cancelled.map((item) => (
              <tr key={item.id}>
                <td><button type="button" className="return-order-link" onClick={() => navigateTo(`/orders/cancelled/${item.id}`)}>{item.orderNumber}</button></td>
                <td className="return-product"><span><Icon name="box" /></span><div><strong>{item.product.name}</strong><small>Qty {item.quantity}</small></div></td>
                <td>{item.shipTo?.name ?? '—'}</td>
                <td><strong>{item.lineTotal.display}</strong></td>
                <td>{new Date(item.placedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TITLES = {
  returns: ['Returns & Refunds', 'Manage return requests and process refunds for your orders.'],
  cancellations: ['Order Cancellations', 'See order items your buyers have cancelled before shipment.'],
}

const ReturnsRefunds = ({ type = 'returns' }) => {
  const [title, description] = TITLES[type]
  return <SellerLayout activeItem={type === 'returns' ? 'returns' : 'cancelled'} breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: title }]}>
    <div className="returns-container">
      <div className="returns-header"><div><h1>{title}</h1><p>{description}</p></div></div>
      {type === 'returns' ? <ReturnsTab /> : <CancellationsTab />}
    </div>
  </SellerLayout>
}
export default ReturnsRefunds
