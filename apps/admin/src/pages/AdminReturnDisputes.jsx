import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { LoadingState, ErrorState, EmptyState } from './AdminStates'
import './seller-pages.css'
import './order-pages.css'

/**
 * Returns the buyer has escalated to Mirwal.
 *
 * The old "Disputes" screen was a read-only SELECT over `return_requests` with no action on
 * it, which described the situation exactly: the seller decided a return filed against their
 * own store and there was no appeal. Migration 021 had `escalated_at` and `admin_decision`
 * columns waiting; nothing ever wrote them.
 *
 * Three things this screen insists on:
 *
 *   * **Oldest first.** A dispute queue sorted by anything else starves the case that has
 *     waited longest, which is exactly the one a buyer is losing patience over.
 *
 *   * **Both sides, side by side.** The buyer's account and the seller's reason are shown
 *     together, because a decision made from one of them is not an adjudication.
 *
 *   * **A reason is required to side with the seller.** The buyer escalated; being told "no"
 *     with nothing attached is worse than not having appealed. Siding with the buyer needs no
 *     reason because the outcome speaks for itself.
 */

const OUTCOMES = [
  ['upheld_buyer', 'Refund the buyer in full'],
  ['partial', 'Refund part of it'],
  ['upheld_seller', 'The seller’s decision stands'],
]

export default function AdminReturnDisputes() {
  const [selected, setSelected] = useState(null)
  const queue = useApiQuery((signal) => api.admin.returnDisputes.list({ pageSize: 50 }, signal), [])

  const items = queue.data?.items ?? []

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1>Disputed returns</h1>
          <p>
            {items.length === 0
              ? 'Nothing waiting on Mirwal.'
              : `${items.length} waiting on a decision — oldest first.`}
          </p>
        </div>
      </header>

      {queue.isLoading && <LoadingState label="Loading disputes" />}
      {queue.error && (
        <>
          <p className="app-error" role="alert">{describeApiError(queue.error)}</p>
          <ErrorState onRetry={queue.refetch} />
        </>
      )}

      {!queue.isLoading && !queue.error && (
        items.length === 0
          ? <EmptyState
            title="No disputes"
            description="A buyer can bring Mirwal in when a seller declines a return, or leaves one unanswered for three days."
          />
          : (
            <table className="admin-table app-table">
              <thead>
                <tr><th>Order</th><th>Product</th><th>Store</th><th>Buyer&rsquo;s reason</th><th>Value</th><th /></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><code>{item.orderNumber}</code></td>
                    <td>{item.product.name}</td>
                    <td>{item.seller.storeName}</td>
                    <td>
                      {String(item.reason).replace(/_/g, ' ')}
                      <small>Escalated {new Date(item.escalatedAt).toLocaleDateString()}</small>
                    </td>
                    <td>{item.lineTotal.display}</td>
                    <td><button type="button" onClick={() => setSelected(item.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}

      {selected && (
        <DisputeDrawer id={selected} onClose={() => setSelected(null)} onDecided={() => { queue.refetch(); setSelected(null) }} />
      )}
    </div>
  )
}

function DisputeDrawer({ id, onClose, onDecided }) {
  const detail = useApiQuery((signal) => api.admin.returnDisputes.get(id, signal), [id])
  const [outcome, setOutcome] = useState('upheld_buyer')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const item = detail.data
  const needsNote = outcome === 'upheld_seller'

  const run = async (action, { close = false } = {}) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (close) onDecided(); else detail.refetch()
    } catch (actionError) {
      setError(describeApiError(actionError))
    } finally { setBusy(false) }
  }

  return (
    <aside className="app-drawer" role="dialog" aria-label="Disputed return">
      <header className="app-drawer-head">
        <h2>{item?.orderNumber ?? 'Return'}</h2>
        <button type="button" onClick={onClose} aria-label="Close"><Icon name="xmark" /></button>
      </header>

      {detail.isLoading && <LoadingState label="Loading" />}
      {detail.error && <p className="app-error" role="alert">{describeApiError(detail.error)}</p>}

      {item && (
        <>
          <dl className="app-facts">
            <dt>Item</dt><dd>{item.product.name} &times; {item.quantity}</dd>
            <dt>Value</dt><dd>{item.lineTotal.display}</dd>
            <dt>Store</dt><dd>{item.seller.storeName}</dd>
            <dt>Buyer</dt><dd>{item.buyer.name}</dd>
            <dt>Wants</dt><dd>{item.type === 'replacement' ? 'A replacement' : item.type === 'repair' ? 'A repair' : 'A refund'}</dd>
            <dt>Return postage</dt>
            <dd>{item.returnShippingPaidBy === 'seller' ? 'Seller pays' : item.returnShippingPaidBy === 'platform' ? 'Mirwal pays' : 'Buyer pays'}</dd>
          </dl>

          {/* Both cases, together. A decision made from one of them is not an adjudication. */}
          <section className="dispute-sides">
            <div>
              <h3>The buyer says</h3>
              <p><b>{String(item.reason).replace(/_/g, ' ')}</b></p>
              {item.description && <p>{item.description}</p>}
            </div>
            <div>
              <h3>The seller says</h3>
              <p>{item.resolutionNote || <em>Nothing — they did not answer.</em>}</p>
            </div>
          </section>

          {item.messages?.length > 0 && (
            <section className="case-thread">
              <h3>Thread</h3>
              {item.messages.map((message) => (
                <div key={message.id} className={message.isInternal ? 'case-msg case-internal' : 'case-msg'}>
                  <b>{message.side}{message.isInternal ? ' · internal' : ''}</b>
                  <p>{message.body}</p>
                </div>
              ))}
            </section>
          )}

          {item.evidence?.length > 0 && (
            <section className="dispute-evidence">
              <h3>Photographs</h3>
              <ul>{item.evidence.map((file) => <li key={file.id}>{file.name} <small>from the {file.side}</small></li>)}</ul>
            </section>
          )}

          {error && <p className="app-error" role="alert">{error}</p>}

          <form
            className="app-form"
            onSubmit={(event) => {
              event.preventDefault()
              run(() => api.admin.returnDisputes.decide(id, {
                outcome,
                refundAmount: outcome === 'partial' ? amount : null,
                note: note || null,
              }), { close: true })
            }}
          >
            <h3>Decide</h3>
            <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>

            {outcome === 'partial' && (
              <label>
                Amount to refund
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={item.lineTotal.amount}
                />
                <small>Cannot exceed {item.lineTotal.display}.</small>
              </label>
            )}

            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={needsNote
                ? 'Required — the buyer appealed and is shown this, and so is the seller.'
                : 'Both sides are shown this.'}
            />
            <div>
              <button type="submit" disabled={busy || (needsNote && note.trim().length < 5) || (outcome === 'partial' && !amount.trim())}>
                {busy ? 'Recording…' : 'Record decision'}
              </button>
            </div>
          </form>

          <form
            className="app-form"
            onSubmit={(event) => {
              event.preventDefault()
              run(async () => {
                await api.admin.returnDisputes.note(id, { body: internalNote, isInternal: true })
                setInternalNote('')
              })
            }}
          >
            <textarea
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Internal note — neither side sees this"
            />
            <div>
              <button type="submit" disabled={busy || !internalNote.trim()}>Add internal note</button>
            </div>
          </form>
        </>
      )}
    </aside>
  )
}
