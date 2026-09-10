import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * What Mirwal can do to an order after it is placed.
 *
 * All three were missing, and each was being worked around badly:
 *
 *   **Cancelling on someone's behalf.** Support had no route at all, so an operator handling a
 *   seller who telephoned to say they could not supply had to ask the seller to do it or edit
 *   the database. `onBehalfOf` decides whose record it lands on, because attributing a seller's
 *   failure to Mirwal quietly launders their cancellation rate.
 *
 *   **Refunding without a return.** The only way to refund a buyer was to invent a return they
 *   had not filed, which corrupted the return statistics sellers are scored on. A courier that
 *   loses a parcel is not a return.
 *
 *   **Reading the conversation.** When a case is opened over an order, what the two parties
 *   actually said to each other is the evidence.
 */

const CANCELLABLE = ['pending', 'confirmed', 'processing']

export default function AdminOrderIntervention({ order, onChanged }) {
  const [panel, setPanel] = useState(null)
  const [flash, setFlash] = useState(null)

  const sellers = [...new Map(
    order.items.filter((item) => item.seller).map((item) => [item.seller.slug ?? item.seller.id, item.seller]),
  ).values()]

  return (
    <div className="detail-card">
      <h2>Intervene</h2>
      <p className="intervene-lede">
        Everything here is recorded against your account and both parties are told. Refunds are
        capped at what is left unrefunded on the order.
      </p>

      {flash && <p className={`intervene-flash ${flash.tone}`} role="status">{flash.text}</p>}

      <div className="intervene-actions">
        <button type="button" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
          <Icon name="ban" /> Cancel an item
        </button>
        <button type="button" onClick={() => setPanel(panel === 'refund' ? null : 'refund')}>
          <Icon name="rotate-left" /> Refund
        </button>
        <button type="button" onClick={() => setPanel(panel === 'invoice' ? null : 'invoice')}>
          <Icon name="file-invoice" /> Invoice
        </button>
        {sellers.length > 0 && (
          <button type="button" onClick={() => setPanel(panel === 'messages' ? null : 'messages')}>
            <Icon name="comment" /> Conversation
          </button>
        )}
      </div>

      {panel === 'cancel' && (
        <CancelPanel
          order={order}
          onDone={(message) => { setFlash({ tone: 'success', text: message }); setPanel(null); onChanged() }}
        />
      )}
      {panel === 'refund' && (
        <RefundPanel
          order={order}
          onDone={(message) => { setFlash({ tone: 'success', text: message }); setPanel(null); onChanged() }}
        />
      )}
      {panel === 'invoice' && <InvoicePanel orderId={order.id} />}
      {panel === 'messages' && <MessagesPanel orderId={order.id} sellers={sellers} />}
    </div>
  )
}

function CancelPanel({ order, onDone }) {
  const open = order.items.filter((item) => CANCELLABLE.includes(item.status))
  const [itemId, setItemId] = useState(open[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const [onBehalfOf, setOnBehalfOf] = useState('admin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = open.find((item) => String(item.id) === String(itemId))

  if (open.length === 0) {
    return <p className="intervene-empty">Nothing on this order can still be cancelled — everything has shipped or is already closed.</p>
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api.admin.fulfilment.cancelItem(itemId, { quantity, reason: reason.trim(), onBehalfOf })
      onDone(result?.message ?? 'Cancelled.')
    } catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <form className="intervene-form" onSubmit={submit}>
      <label>
        Item
        <select value={itemId} onChange={(event) => { setItemId(event.target.value); setQuantity(1) }}>
          {open.map((item) => (
            <option key={item.id} value={item.id}>{item.product.name} — {item.quantity} × {item.unitPrice.display}</option>
          ))}
        </select>
      </label>

      {selected && Number(selected.quantity) > 1 && (
        <label>
          How many of the {selected.quantity}?
          <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>
            {Array.from({ length: Number(selected.quantity) }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value === Number(selected.quantity) ? `All ${value}` : value}</option>
            ))}
          </select>
        </label>
      )}

      <label>
        Whose record does this land on?
        <select value={onBehalfOf} onChange={(event) => setOnBehalfOf(event.target.value)}>
          <option value="admin">Mirwal — neither party is at fault</option>
          <option value="seller">The seller — they could not supply</option>
          <option value="buyer">The buyer — they asked us to cancel</option>
        </select>
        {/* The distinction seller performance depends on. */}
        <small>A seller who telephoned to cancel is still a seller cancellation.</small>
      </label>

      <label>
        Reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} minLength={3} required placeholder="What both parties are told" />
      </label>

      {error && <p className="intervene-error">{error}</p>}
      <button type="submit" className="app-reject" disabled={busy || reason.trim().length < 3}>
        {busy ? 'Cancelling…' : 'Cancel it'}
      </button>
    </form>
  )
}

function RefundPanel({ order, onDone }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState('goodwill')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const paid = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded'

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api.admin.fulfilment.refund(order.id, { amount: amount.trim(), reason: reason.trim(), kind })
      onDone(result?.message ?? 'Refund recorded.')
    } catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <form className="intervene-form" onSubmit={submit}>
      {!paid && (
        <p className="intervene-empty">
          This order has not been paid, so there is nothing to send back. Cancel the items instead.
        </p>
      )}
      <label>
        Amount (order total {order.total.display})
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500.00" inputMode="decimal" required disabled={!paid} />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(event) => setKind(event.target.value)} disabled={!paid}>
          <option value="goodwill">Goodwill — an apology, not a return</option>
          <option value="chargeback">Chargeback — the bank took it back</option>
        </select>
      </label>
      <label>
        Reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} minLength={3} required disabled={!paid} placeholder="Courier lost the parcel" />
        <small>Goes on the record and onto the buyer&rsquo;s statement.</small>
      </label>
      {error && <p className="intervene-error">{error}</p>}
      <button type="submit" className="app-reject" disabled={busy || !paid || !amount.trim() || reason.trim().length < 3}>
        {busy ? 'Recording…' : 'Issue refund'}
      </button>
    </form>
  )
}

function InvoicePanel({ orderId }) {
  const invoice = useApiQuery((signal) => api.admin.fulfilment.invoice(orderId, signal), [orderId])

  if (invoice.isLoading) return <p className="intervene-empty">Loading…</p>
  if (invoice.error) return <p className="intervene-error">{describeApiError(invoice.error)}</p>

  const data = invoice.data
  return (
    <div className="intervene-invoice">
      <p><b>{data.number}</b> · issued {new Date(data.issuedAt).toLocaleDateString()}</p>
      <p>{data.issuer.name}{data.issuer.strn ? ` · STRN ${data.issuer.strn}` : ''}</p>
      <table className="admin-table">
        <thead><tr><th>Item</th><th>Sold by</th><th>Qty</th><th>Amount</th></tr></thead>
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={index}>
              <td>{line.description}</td>
              <td>{line.soldBy}</td>
              <td>{line.quantity}</td>
              <td>{line.lineTotal.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {data.taxInclusive ? 'Sales tax (included)' : 'Sales tax'} {data.totals.tax.display}
        {' · '}Total {data.totals.total.display}
      </p>

      {/* Credit notes sit against the invoice rather than inside it: the invoice stands, and a
          refund does not rewrite what was charged. */}
      {data.credits?.length > 0 && (
        <div className="intervene-credits">
          <h3>Credits against this invoice</h3>
          {data.credits.map((credit) => (
            <p key={credit.id}>
              {credit.amount.display} · {credit.kind}
              {credit.reason ? ` · ${credit.reason}` : ''}
              {credit.settled ? '' : ' · not yet paid'}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function MessagesPanel({ orderId, sellers }) {
  const [sellerId, setSellerId] = useState(sellers[0]?.id ?? sellers[0]?.slug ?? '')
  const [note, setNote] = useState('')
  const [internal, setInternal] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const thread = useApiQuery(
    (signal) => api.admin.fulfilment.thread(orderId, sellerId, signal),
    [orderId, sellerId],
  )

  async function send(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.admin.fulfilment.reply(orderId, sellerId, { body: note.trim(), isInternal: internal })
      setNote('')
      thread.refetch()
    } catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <div className="intervene-thread">
      {sellers.length > 1 && (
        <label>
          Store
          {/* One thread per store: a basket split across three sellers is three conversations. */}
          <select value={sellerId} onChange={(event) => setSellerId(event.target.value)}>
            {sellers.map((seller) => (
              <option key={seller.id ?? seller.slug} value={seller.id ?? seller.slug}>{seller.name}</option>
            ))}
          </select>
        </label>
      )}

      {thread.isLoading && <p className="intervene-empty">Loading…</p>}
      {thread.error && <p className="intervene-error">{describeApiError(thread.error)}</p>}
      {thread.data?.messages?.length === 0 && <p className="intervene-empty">Nothing has been said on this order.</p>}

      {(thread.data?.messages ?? []).map((message) => (
        <div key={message.id} className={message.isInternal ? 'intervene-msg intervene-internal' : 'intervene-msg'}>
          <b>{message.side}{message.isInternal ? ' · internal' : ''}</b>
          <p>{message.body}</p>
        </div>
      ))}

      {error && <p className="intervene-error">{error}</p>}

      <form onSubmit={send}>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={4000} placeholder="Note, or a message to both parties" />
        <label className="intervene-check">
          <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
          {/* Defaults to internal: a note written for colleagues that reaches the buyer and the
              seller by accident is the costlier mistake. */}
          Internal — neither party sees this
        </label>
        <button type="submit" disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add'}</button>
      </form>
    </div>
  )
}
