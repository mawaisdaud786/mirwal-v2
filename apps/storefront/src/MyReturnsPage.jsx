import { useState } from 'react'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { LoadingState, ErrorState } from '@mirwal/shared/PageStates'
import api from './api'
import { REASON_LABEL } from './returnReasons'
import './my-returns.css'

// The storefront has no shared icon component; every page declares this same one-liner.
const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

/**
 * A buyer's returns, after they have been filed.
 *
 * There was nowhere at all to see this. A return appeared as one word beside an order line —
 * "requested", "approved", "rejected" — and that was the whole of it: no way to say the parcel
 * had been posted, no way to answer a seller who wanted a photograph, no way to withdraw a
 * request filed by mistake, and, most seriously, no way to disagree. The seller decided a
 * return filed against their own store and the buyer had no appeal.
 *
 * What this page is really for is the last of those. `Ask Mirwal to look at this` is the
 * difference between a marketplace where the seller is the judge of their own case and one
 * where they are not.
 */

const STATE = {
  requested: { label: 'With the seller', tone: 'wait', blurb: 'The seller has three days to reply.' },
  more_info_required: { label: 'The seller needs more', tone: 'act', blurb: 'Reply below so they can decide.' },
  approved: { label: 'Approved', tone: 'ok', blurb: 'Post the item back and add the tracking number.' },
  in_transit: { label: 'On its way back', tone: 'wait', blurb: 'Your refund follows once the seller has it.' },
  received: { label: 'The seller has it', tone: 'wait', blurb: 'Your refund is being worked out.' },
  refunded: { label: 'Refunded', tone: 'ok', blurb: '' },
  replaced: { label: 'Replacement sent', tone: 'ok', blurb: '' },
  rejected: { label: 'Declined', tone: 'no', blurb: 'If you think this is wrong, Mirwal will look at it.' },
  cancelled: { label: 'Withdrawn', tone: 'no', blurb: '' },
  escalated: { label: 'With Mirwal', tone: 'act', blurb: 'We are looking at this and will come back to you.' },
}


export default function MyReturnsPage() {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.returns.list(signal), [])

  if (isLoading) return <LoadingState label="Loading your returns" />
  if (error) return <ErrorState title="We could not load your returns" description={describeApiError(error)} onRetry={refetch} />

  const returns = data ?? []

  return (
    <section className="returns-page">
      <header>
        <h1>Returns</h1>
        <p>Every return you have filed, and what is happening with it.</p>
      </header>

      {returns.length === 0 ? (
        <div className="returns-empty">
          <FaIcon name="rotate-left" />
          <h2>Nothing to return</h2>
          <p>You have not filed any returns. You can start one from an order once it has been delivered.</p>
        </div>
      ) : (
        <ul className="returns-list">
          {returns.map((entry) => <ReturnCard key={entry.id} entry={entry} onChanged={refetch} />)}
        </ul>
      )}
    </section>
  )
}

function ReturnCard({ entry, onChanged }) {
  const [panel, setPanel] = useState(null)
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const state = STATE[entry.status] ?? { label: entry.status, tone: 'wait', blurb: '' }

  const run = async (action) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Done.' })
      setPanel(null); setTracking(''); setNote('')
      onChanged()
    } catch (actionError) {
      setFlash({ tone: 'error', text: describeApiError(actionError) })
    } finally { setBusy(false) }
  }

  return (
    <li className="return-card">
      <div className="return-card-head">
        <div>
          <strong>{entry.product.name}</strong>
          <small>Order {entry.orderNumber} &middot; {REASON_LABEL[entry.reason] ?? entry.reason}</small>
        </div>
        <em className={`return-state return-${state.tone}`}>{state.label}</em>
      </div>

      {state.blurb && <p className="return-blurb">{state.blurb}</p>}

      {/* The seller's own words, whatever the outcome. A decline the buyer cannot read is one
          they cannot answer. */}
      {entry.resolutionNote && <p className="return-seller-note"><b>The seller says:</b> {entry.resolutionNote}</p>}

      {entry.adminDecision && (
        <p className="return-decision">
          <b>Mirwal decided:</b> {String(entry.adminDecision.outcome).replace(/_/g, ' ')}
          {entry.adminDecision.note ? ` — ${entry.adminDecision.note}` : ''}
        </p>
      )}

      <dl className="return-facts">
        <dt>Value</dt><dd>{entry.lineTotal.display}</dd>
        {entry.refundAmount && <><dt>Refunded</dt><dd>{entry.refundAmount.display}</dd></>}
        <dt>Return postage</dt>
        <dd>{entry.returnShippingPaidBy === 'seller' ? 'The seller pays' : entry.returnShippingPaidBy === 'platform' ? 'Mirwal pays' : 'You pay'}</dd>
        {entry.returnTracking && <><dt>Tracking</dt><dd>{entry.returnCarrier ? `${entry.returnCarrier} · ` : ''}{entry.returnTracking}</dd></>}
      </dl>

      {flash && <p className={`return-flash ${flash.tone}`} role="status">{flash.text}</p>}

      <div className="return-actions">
        {entry.status === 'approved' && (
          <button type="button" onClick={() => setPanel(panel === 'posted' ? null : 'posted')} disabled={busy}>
            I have posted it
          </button>
        )}
        {['requested', 'more_info_required', 'approved'].includes(entry.status) && (
          <button type="button" onClick={() => run(() => api.returns.cancel(entry.id))} disabled={busy}>
            Withdraw
          </button>
        )}
        {entry.canEscalate && (
          <button type="button" className="return-escalate" onClick={() => setPanel(panel === 'escalate' ? null : 'escalate')} disabled={busy}>
            Ask Mirwal to look at this
          </button>
        )}
        <button type="button" onClick={() => setPanel(panel === 'reply' ? null : 'reply')} disabled={busy}>
          Message the seller
        </button>
      </div>

      {panel === 'posted' && (
        <form className="return-panel" onSubmit={(event) => { event.preventDefault(); run(() => api.returns.markPosted(entry.id, { tracking: tracking.trim() })) }}>
          <label>
            Tracking number
            <input value={tracking} onChange={(event) => setTracking(event.target.value)} maxLength={80} placeholder="e.g. TCS or Leopards consignment number" />
          </label>
          <button type="submit" disabled={busy || tracking.trim().length < 3}>{busy ? 'Saving…' : 'Tell the seller'}</button>
        </form>
      )}

      {panel === 'escalate' && (
        <form className="return-panel" onSubmit={(event) => { event.preventDefault(); run(() => api.returns.escalate(entry.id, note.trim())) }}>
          <label>
            What happened?
            <textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tell Mirwal why you think the seller got this wrong." />
            {/* The API asks for twenty characters. Saying so here beats returning an error
                after someone has already written something. */}
            <small>A sentence or two is enough. Mirwal reads this alongside the seller&rsquo;s reason.</small>
          </label>
          <button type="submit" disabled={busy || note.trim().length < 20}>{busy ? 'Sending…' : 'Send to Mirwal'}</button>
        </form>
      )}

      {panel === 'reply' && (
        <form className="return-panel" onSubmit={(event) => { event.preventDefault(); run(() => api.returns.reply(entry.id, note.trim())) }}>
          <label>
            Message
            <textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Answer the seller, or add something they should know." />
          </label>
          <button type="submit" disabled={busy || !note.trim()}>{busy ? 'Sending…' : 'Send'}</button>
        </form>
      )}
    </li>
  )
}
