import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { LoadingState, ErrorState } from '@mirwal/shared/PageStates'
import api from '../api'
import { STATUS_LABEL, REASON_LABEL } from './returnLabels'
import './returns-refunds.css'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'


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
 * There is now a real single-request endpoint (`GET /seller/me/returns/:id`), so this reads
 * that rather than fetching the whole list and finding a row in it — and it carries two things
 * the list cannot: the thread between the seller and the buyer, and the history of what
 * happened when.
 */
function ReturnDetail({ requestId }) {
  const { data: request, error, isLoading, refetch } = useApiQuery(
    (signal) => api.seller.returnDetail(requestId, signal),
    [requestId],
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [reply, setReply] = useState('')

  if (isLoading) return <LoadingState label="Loading request" />
  if (error) return <ErrorState title="We could not load this request" description={describeApiError(error)} onRetry={refetch} />
  if (!request) {
    return <EmptyState icon={<Icon name="rotate-left" />} title="Request not found" text="This return request doesn't exist, or doesn't belong to your store." />
  }

  const run = async (action) => {
    setBusy(true); setActionError('')
    try { await action(); await refetch() }
    catch (submitError) { setActionError(describeApiError(submitError)) }
    finally { setBusy(false) }
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
          {request.product.image
            ? <img className="product-thumb detail-product-thumb" src={request.product.image} alt="" />
            : <span><Icon name="box" /></span>}
          <div><strong>{request.product.name}</strong><small>Qty {request.quantity} &middot; {request.lineTotal.display}</small></div>
        </div>
      </div>
      <div className="detail-card">
        <h2>Buyer</h2>
        <dl><dt>Name</dt><dd>{request.buyer.name}</dd></dl>
      </div>
      <div className="detail-card">
        <h2>Status</h2>
        <dl>
          <dt>Current</dt><dd>{STATUS_LABEL[request.status] ?? request.status}</dd>
          <dt>Wants</dt><dd>{request.type === 'replacement' ? 'A replacement' : request.type === 'repair' ? 'A repair' : 'A refund'}</dd>
          {/* Decided when the return was filed and shown to both sides before anything is
              posted, so it is not something to argue about after the fact. */}
          <dt>Return postage</dt>
          <dd>{request.returnShippingPaidBy === 'seller' ? 'You pay' : request.returnShippingPaidBy === 'platform' ? 'Mirwal pays' : 'Buyer pays'}</dd>
          {request.returnTracking && <><dt>Tracking</dt><dd>{request.returnCarrier ? `${request.returnCarrier} · ` : ''}{request.returnTracking}</dd></>}
          {request.refundAmount && <><dt>Refunded</dt><dd>{request.refundAmount.display}</dd></>}
        </dl>
      </div>

      {request.adminDecision && (
        <div className="detail-card detail-wide">
          <h2>Mirwal&rsquo;s decision</h2>
          {/* Shown in full, including the reasoning. An adjudication a seller cannot learn
              from is one they will lose again next week. */}
          <p><strong>{String(request.adminDecision.outcome).replace(/_/g, ' ')}</strong></p>
          {request.adminDecision.note && <p>{request.adminDecision.note}</p>}
        </div>
      )}

      <div className="detail-card detail-wide">
        <h2>Reason</h2>
        <p><strong>{REASON_LABEL[request.reason] ?? String(request.reason).replace(/_/g, ' ')}</strong></p>
        {request.description && <p>{request.description}</p>}
        {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}
        {request.resolutionNote && <p><em>Your note: {request.resolutionNote}</em></p>}
      </div>

      {request.messages?.length > 0 && (
        <div className="detail-card detail-wide">
          <h2>Messages</h2>
          <ul className="return-thread">
            {request.messages.map((message) => (
              <li key={message.id} className={`thread-${message.side}`}>
                <b>{message.side === 'seller' ? 'You' : message.side === 'admin' ? 'Mirwal' : request.buyer.name}</b>
                <p>{message.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open while the return is: once Mirwal is deciding, the seller adds their side here
          rather than being locked out of the conversation about their own store. */}
      {request.status !== 'cancelled' && (
        <div className="detail-card detail-wide">
          <h2>Reply to the buyer</h2>
          <form
            className="return-reply"
            onSubmit={(event) => {
              event.preventDefault()
              run(async () => { await api.seller.replyToReturn(request.id, reply.trim()); setReply('') })
            }}
          >
            <textarea rows={3} maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Ask for a photograph, explain, or answer a question." />
            <button type="submit" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        </div>
      )}

      {request.timeline?.length > 0 && (
        <div className="detail-card detail-wide">
          <h2>History</h2>
          <ol className="return-timeline">
            {request.timeline.map((entry, index) => (
              <li key={index}>
                <b>{String(entry.to ?? entry.type).replace(/_/g, ' ')}</b>
                <small>{entry.side} &middot; {new Date(entry.at.replace(' ', 'T') + 'Z').toLocaleString('en-PK')}</small>
                {entry.note && <p>{entry.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  </>
}

/** Cancellations are the buyer's own right before anything ships — read-only here, same as
 * the list page, since there is nothing for a seller to approve or reject. */
function CancellationDetail({ requestId }) {
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.seller.orders({ status: 'cancelled', pageSize: 100 }, signal),
    [],
  )

  const item = useMemo(
    () => (data?.items ?? []).find((row) => String(row.id) === requestId),
    [data, requestId],
  )

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
          {item.image
            ? <img className="product-thumb detail-product-thumb" src={item.image} alt="" />
            : <span><Icon name="box" /></span>}
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
