import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * The two things a buyer needs after an order is placed and before it arrives.
 *
 *   **The invoice.** Mirwal computed sales tax on every order and no document ever stated it,
 *   so a buyer registered for sales tax could not claim input tax. It is issued once the order
 *   is paid and never rewritten — a later refund is a credit against it, not an edit to it,
 *   which is why an unpaid order shows nothing here rather than a draft.
 *
 *   **A way to reach the store.** A question about a live order could go to Mirwal or nowhere.
 *   There is one thread per store, because a basket split across three sellers is three
 *   conversations, and letting one store see another's would expose the buyer's other
 *   purchases.
 */
export default function OrderAfterSale({ order }) {
  const [open, setOpen] = useState(null)

  const threads = useApiQuery((signal) => api.fulfilment.threads(order.id, signal), [order.id])
  const paid = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded'

  return (
    <section className="order-aftersale">
      <div className="order-aftersale-row">
        <h2>Invoice &amp; messages</h2>
        {paid
          ? <InvoiceLink orderId={order.id} />
          // Said plainly rather than showing a disabled button: an invoice for money that never
          // arrived would put a supply on record that did not happen.
          : <small className="order-aftersale-note">Your invoice appears here once payment is confirmed.</small>}
      </div>

      {threads.error && <p className="order-aftersale-error">{describeApiError(threads.error)}</p>}

      {(threads.data ?? []).map((thread) => (
        <div key={thread.seller.id} className="order-thread">
          <button type="button" onClick={() => setOpen(open === thread.seller.id ? null : thread.seller.id)}>
            <Icon name="comment" />
            <span>Message {thread.seller.storeName}</span>
            {thread.unread > 0 && <em className="order-thread-unread">{thread.unread} new</em>}
            {thread.unread === 0 && thread.messageCount > 0 && <em>{thread.messageCount}</em>}
          </button>
          {open === thread.seller.id && (
            <Thread orderId={order.id} seller={thread.seller} onSent={threads.refetch} />
          )}
        </div>
      ))}
    </section>
  )
}

function InvoiceLink({ orderId }) {
  const [invoice, setInvoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    try { setInvoice(await api.fulfilment.invoice(orderId)) }
    catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  if (error) return <small className="order-aftersale-error">{error}</small>
  if (!invoice) {
    return (
      <button type="button" className="order-invoice-btn" onClick={load} disabled={busy}>
        <Icon name="file-invoice" /> {busy ? 'Fetching…' : 'View tax invoice'}
      </button>
    )
  }

  return (
    <div className="order-invoice">
      <header>
        <div>
          <b>{invoice.issuer.name}</b>
          {invoice.issuer.ntn && <small>NTN {invoice.issuer.ntn}</small>}
          {invoice.issuer.strn && <small>STRN {invoice.issuer.strn}</small>}
          {invoice.issuer.address && <small>{invoice.issuer.address}</small>}
        </div>
        <div className="order-invoice-number">
          <b>{invoice.number}</b>
          <small>{new Date(invoice.issuedAt).toLocaleDateString()}</small>
        </div>
      </header>

      <p className="order-invoice-billto">
        <b>Billed to</b> {invoice.billTo.name}
        {invoice.billTo.address ? ` · ${invoice.billTo.address}` : ''}
      </p>

      <table>
        <thead>
          <tr><th>Item</th><th>Sold by</th><th>Qty</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, index) => (
            <tr key={index}>
              <td>{line.description}</td>
              {/* Each store is a separate supply, with its own registration. */}
              <td>{line.soldBy}{line.sellerStrn ? <small>STRN {line.sellerStrn}</small> : null}</td>
              <td>{line.quantity}</td>
              <td>{line.lineTotal.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="order-invoice-totals">
        <dt>Subtotal</dt><dd>{invoice.totals.subtotal.display}</dd>
        <dt>Discount</dt><dd>-{invoice.totals.discount.display}</dd>
        <dt>Delivery</dt><dd>{invoice.totals.shipping.display}</dd>
        {/* Says how to read the tax line rather than leaving the figure ambiguous. */}
        <dt>{invoice.taxInclusive ? 'Sales tax (included)' : 'Sales tax'}</dt>
        <dd>{invoice.totals.tax.display}</dd>
        <dt><b>Total</b></dt><dd><b>{invoice.totals.total.display}</b></dd>
      </dl>

      <button type="button" className="order-invoice-print" onClick={() => window.print()}>
        <Icon name="print" /> Print
      </button>
    </div>
  )
}

function Thread({ orderId, seller, onSent }) {
  const messages = useApiQuery(
    (signal) => api.fulfilment.thread(orderId, seller.id, signal),
    [orderId, seller.id],
  )
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.fulfilment.send(orderId, seller.id, draft.trim())
      setDraft('')
      messages.refetch()
      onSent?.()
    } catch (requestError) { setError(describeApiError(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <div className="order-thread-body">
      {messages.isLoading && <p className="order-thread-empty">Loading…</p>}
      {messages.error && <p className="order-aftersale-error">{describeApiError(messages.error)}</p>}

      {messages.data?.messages?.length === 0 && (
        <p className="order-thread-empty">
          Ask {seller.storeName} about this order — delivery timing, packaging, anything.
        </p>
      )}

      {(messages.data?.messages ?? []).map((message) => (
        <div key={message.id} className={`order-msg order-msg-${message.side}`}>
          <b>{message.side === 'buyer' ? 'You' : message.side === 'admin' ? 'Mirwal' : seller.storeName}</b>
          <p>{message.body}</p>
          <small>{new Date(message.at).toLocaleString()}</small>
        </div>
      ))}

      {error && <p className="order-aftersale-error">{error}</p>}

      <form onSubmit={send}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder={`Message ${seller.storeName}`}
        />
        <button type="submit" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </div>
  )
}
