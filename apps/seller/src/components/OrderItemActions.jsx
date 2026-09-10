import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * Cancelling a line, and answering the buyer.
 *
 * Neither was possible from this panel. An item the store had no stock for sat in `processing`
 * until somebody at Mirwal noticed, and a buyer's question could only ever reach Mirwal — which
 * is why so much of the support queue was requests to relay a message to a seller.
 *
 * The reason field is mandatory and the copy says why: the buyer is shown it, and "cancelled"
 * with no explanation is the single most complained-about experience on any marketplace. It is
 * also what lets a cancellation rate mean something — a seller's failure to supply and a
 * buyer's change of mind are recorded separately now.
 */

const CANCELLABLE = ['pending', 'confirmed', 'processing']

export default function OrderItemActions({ item, onChanged }) {
  const [panel, setPanel] = useState(null)

  return (
    <div className="order-actions">
      {CANCELLABLE.includes(item.status) && (
        <button type="button" className="order-action-cancel" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
          <Icon name="ban" /> Can&rsquo;t supply
        </button>
      )}
      <button type="button" onClick={() => setPanel(panel === 'talk' ? null : 'talk')}>
        <Icon name="comment" /> Message buyer
      </button>

      {panel === 'cancel' && (
        <CancelForm item={item} onDone={() => { setPanel(null); onChanged() }} onCancel={() => setPanel(null)} />
      )}
      {panel === 'talk' && <Thread orderId={item.orderId} buyerName={item.shipTo?.name} />}
    </div>
  )
}

function CancelForm({ item, onDone, onCancel }) {
  const ordered = Number(item.quantity ?? 1)
  const [quantity, setQuantity] = useState(ordered)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.seller.cancelItem(item.id, { quantity, reason: reason.trim() })
      onDone()
    } catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <form className="order-action-form" onSubmit={submit}>
      <p>
        The buyer is told immediately and refunded whatever they paid for this. It also counts
        towards your cancellation rate, so use it only when you genuinely cannot supply.
      </p>
      {ordered > 1 && (
        <label>
          How many of the {ordered}?
          <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} disabled={busy}>
            {Array.from({ length: ordered }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value === ordered ? `All ${value}` : value}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Why?
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={255}
          required
          minLength={3}
          placeholder="Out of stock at the warehouse"
        />
        <small>The buyer sees this.</small>
      </label>
      {error && <p className="order-action-error">{error}</p>}
      <div>
        <button type="submit" className="order-action-cancel" disabled={busy || reason.trim().length < 3}>
          {busy ? 'Cancelling…' : 'Cancel this item'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>Back</button>
      </div>
    </form>
  )
}

function Thread({ orderId, buyerName }) {
  const messages = useApiQuery((signal) => api.seller.orderMessages.thread(orderId, signal), [orderId])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.seller.orderMessages.send(orderId, draft.trim())
      setDraft('')
      messages.refetch()
    } catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <div className="order-action-thread">
      {messages.isLoading && <p className="order-thread-empty">Loading…</p>}
      {messages.error && <p className="order-action-error">{describeApiError(messages.error)}</p>}

      {messages.data?.messages?.length === 0 && (
        <p className="order-thread-empty">Nothing yet. Anything you write here reaches the buyer directly.</p>
      )}

      {(messages.data?.messages ?? []).map((message) => (
        <div key={message.id} className={`order-msg order-msg-${message.side}`}>
          <b>{message.side === 'seller' ? 'You' : message.side === 'admin' ? 'Mirwal' : (buyerName ?? 'Buyer')}</b>
          <p>{message.body}</p>
          <small>{new Date(message.at).toLocaleString()}</small>
        </div>
      ))}

      {error && <p className="order-action-error">{error}</p>}

      <form onSubmit={send}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={4000} placeholder="Reply to the buyer" />
        <button type="submit" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </div>
  )
}
