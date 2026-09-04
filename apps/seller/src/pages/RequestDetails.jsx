import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { LoadingState, ErrorState } from '@mirwal/shared/PageStates'
import api from '../api'
import './returns-refunds.css'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'

const STATUS_LABEL = { requested: 'Pending Review', approved: 'Approved', rejected: 'Rejected' }

/**
 * A single return request or cancelled item's detail — reachable from a direct link
 * (`/orders/returns/:id`, `/orders/cancelled/:id`).
 *
 * This used to show the same hard-coded fake customer/order for every id, with the excuse
 * that "there is no returns/cancellations system yet." That stopped being true when
 * ReturnsRefunds.jsx was connected to the real `return_requests` table and the seller's real
 * order items — this page was simply never updated to match, and had no link pointing to it
 * from the list besides. There is still no single-item GET endpoint, so this reads the same
 * real list ReturnsRefunds.jsx already fetches (`GET /seller/me/returns` or
 * `GET /seller/me/orders`) and finds the matching row — no new backend needed, since the list
 * already carries every field a detail view needs.
 *
 * Approve/reject is included for returns, calling the same real
 * `PATCH /seller/me/returns/:id/status` the list page uses, so a bookmarked or shared link to
 * one request is fully actionable, not read-only.
 */
function ReturnDetail({ requestId }) {
  const { data: returns, error, isLoading, refetch } = useApiQuery((signal) => api.seller.returns(signal), [])
  const [resolving, setResolving] = useState(false)
  const [actionError, setActionError] = useState('')

  const request = useMemo(() => (returns ?? []).find((item) => item.id === requestId), [returns, requestId])

  if (isLoading) return <LoadingState label="Loading request" />
  if (error) return <ErrorState title="We could not load this request" description={describeApiError(error)} onRetry={refetch} />
  if (!request) {
    return <EmptyState icon={<Icon name="rotate-left" />} title="Request not found" text="This return request doesn't exist, or doesn't belong to your store." />
  }

  const resolve = async (status) => {
    setResolving(true); setActionError('')
    try { await api.seller.resolveReturn(request.id, { status }); await refetch() }
    catch (submitError) { setActionError(describeApiError(submitError)) }
    finally { setResolving(false) }
  }

  return <>
    <div className="request-details-header">
      <div>
        <h1>Return request — {request.orderNumber}</h1>
        <p>Filed {new Date(request.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      </div>
    </div>
    <div className="request-detail-grid">
      <div className="detail-card">
        <h2>Product</h2>
        <div className="detail-product">
          <span><Icon name="box" /></span>
          <div><strong>{request.product.name}</strong><small>Qty {request.quantity} · {request.lineTotal.display}</small></div>
        </div>
      </div>
      <div className="detail-card">
        <h2>Buyer</h2>
        <dl><dt>Name</dt><dd>{request.buyer.name}</dd></dl>
      </div>
      <div className="detail-card">
        <h2>Status</h2>
        <dl><dt>Current</dt><dd>{STATUS_LABEL[request.status] ?? request.status}</dd></dl>
        {request.status === 'requested' && <div className="detail-actions">
          <button type="button" className="approve" disabled={resolving} onClick={() => resolve('approved')}>Approve</button>
          <button type="button" className="reject" disabled={resolving} onClick={() => resolve('rejected')}>Reject</button>
        </div>}
      </div>
      <div className="detail-card detail-wide">
        <h2>Reason</h2>
        <p><strong>{request.reason}</strong></p>
        {request.description && <p>{request.description}</p>}
        {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}
        {request.resolutionNote && <p><em>Resolution note: {request.resolutionNote}</em></p>}
      </div>
    </div>
  </>
}

/** Cancellations are the buyer's own right before anything ships — read-only here, same as
 * the list page, since there is nothing for a seller to approve or reject. */
function CancellationDetail({ requestId }) {
  const { data: items, error, isLoading, refetch } = useApiQuery((signal) => api.seller.orders(signal), [])

  const item = useMemo(() => (items ?? []).find((row) => String(row.id) === requestId && row.status === 'cancelled'), [items, requestId])

  if (isLoading) return <LoadingState label="Loading request" />
  if (error) return <ErrorState title="We could not load this request" description={describeApiError(error)} onRetry={refetch} />
  if (!item) {
    return <EmptyState icon={<Icon name="square-xmark" />} title="Cancelled item not found" text="This item doesn't exist, isn't cancelled, or doesn't belong to your store." />
  }

  return <>
    <div className="request-details-header">
      <div>
        <h1>Cancelled item — {item.orderNumber}</h1>
        <p>Placed {new Date(item.placedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      </div>
    </div>
    <div className="request-detail-grid">
      <div className="detail-card">
        <h2>Product</h2>
        <div className="detail-product">
          <span><Icon name="box" /></span>
          <div><strong>{item.product.name}</strong><small>Qty {item.quantity} · {item.lineTotal.display}</small></div>
        </div>
      </div>
      <div className="detail-card">
        <h2>Shipping to</h2>
        <dl><dt>City</dt><dd>{item.shipTo?.city ?? '—'}</dd></dl>
      </div>
      <div className="detail-card">
        <h2>Status</h2>
        <dl><dt>Current</dt><dd>Cancelled</dd></dl>
      </div>
    </div>
  </>
}

const RequestDetails = ({ type = 'returns', requestId }) => {
  const cancellation = type === 'cancellations'
  const listPath = cancellation ? '/orders/cancelled' : '/orders/returns'
  const title = cancellation ? 'Cancellations' : 'Returns & Refunds'
  return <SellerLayout activeItem={cancellation ? 'cancelled' : 'returns'} breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: title, onClick: () => navigateTo(listPath) }, { label: 'Details' }]}>
    <div className="request-details-page">
      <div className="request-details-header">
        <div><button type="button" className="back-link" onClick={() => navigateTo(listPath)}><Icon name="arrow-left" /> Back to {title}</button></div>
      </div>
      {cancellation ? <CancellationDetail requestId={requestId} /> : <ReturnDetail requestId={requestId} />}
    </div>
  </SellerLayout>
}
export default RequestDetails
