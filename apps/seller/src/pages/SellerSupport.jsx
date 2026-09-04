import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './seller-support.css'

/**
 * Seller support — real tickets.
 *
 * The old version was fabricated in the most dangerous way this codebase had: the create form
 * pre-filled `defaultValue="Payment rejected"` with a matching fake description, so a seller
 * who submitted without editing would have filed a complaint about a payment problem they
 * never had — and "Submit Request" created nothing anyway, just navigated to a fake list.
 *
 * Everything here writes to `support_tickets` (migration 013) and is answered by Mirwal staff
 * from the admin panel's Support Tickets queue. Fields start empty; nothing is pre-filled.
 *
 * Staff internal notes are stripped server-side, so a seller only ever sees replies actually
 * addressed to them.
 */

const CATEGORIES = [
  ['general', 'General question'],
  ['orders', 'Orders & fulfilment'],
  ['payments', 'Payments & payouts'],
  ['products', 'Products & listings'],
  ['account', 'Account & store'],
  ['technical', 'Technical problem'],
]

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusPill({ value }) {
  return <span className={`seller-support-status ${value}`}>{value}</span>
}

/** The create form. Deliberately empty — see the note above about pre-filled values. */
function CreateRequest() {
  const [form, setForm] = useState({ subject: '', message: '', category: 'general', priority: 'normal' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.seller.tickets.create({
        subject: form.subject.trim(),
        message: form.message.trim(),
        category: form.category,
        priority: form.priority,
      })
      navigateTo(`/support/request/${data.id}`)
    } catch (requestError) {
      setError(describeApiError(requestError))
    } finally { setBusy(false) }
  }

  return (
    <form className="seller-support-form" onSubmit={submit}>
      {error && <p className="seller-support-flash error" role="status"><Icon name="triangle-exclamation" /> {error}</p>}
      <label>
        <span>Subject</span>
        <input value={form.subject} onChange={set('subject')} required minLength={4} maxLength={200} placeholder="Briefly, what is the problem?" />
      </label>
      <div className="seller-support-form-row">
        <label>
          <span>Category</span>
          <select value={form.category} onChange={set('category')}>
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select value={form.priority} onChange={set('priority')}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <label>
        <span>Details</span>
        <textarea value={form.message} onChange={set('message')} required minLength={10} rows={6} placeholder="What happened, what you expected, and any order or product references." />
        <small>At least 10 characters. Include order numbers or product names where you can — it is what lets Mirwal answer without asking first.</small>
      </label>
      <div className="seller-support-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</button>
        <button type="button" onClick={() => navigateTo('/support/requests')}>Cancel</button>
      </div>
    </form>
  )
}

function RequestList() {
  const [status, setStatus] = useState('')
  const stats = useApiQuery((signal) => api.seller.tickets.stats(signal), [])
  const list = useApiQuery(
    (signal) => api.seller.tickets.list({ pageSize: 50, ...(status ? { status } : {}) }, signal),
    [status],
  )

  if (list.isLoading) return <p className="seller-support-loading">Loading your requests...</p>
  if (list.isError) return <p className="seller-support-flash error"><Icon name="triangle-exclamation" /> {describeApiError(list.error)}</p>

  const items = list.data?.items ?? []

  return (
    <>
      {stats.data && (
        <div className="seller-support-kpis">
          {[['Total', stats.data.total], ['Open', stats.data.open], ['Pending', stats.data.pending], ['Resolved', stats.data.resolved]].map(([label, value]) => (
            <article key={label}><small>{label}</small><strong>{value}</strong></article>
          ))}
        </div>
      )}

      <div className="seller-support-tabs">
        {[['', 'All'], ['open', 'Open'], ['pending', 'Pending'], ['resolved', 'Resolved'], ['closed', 'Closed']].map(([value, label]) => (
          <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>
        ))}
        <button type="button" className="primary" onClick={() => navigateTo('/support/create')}>
          <Icon name="plus" /> New request
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="life-ring"
          title={status ? `No ${status} requests` : 'No support requests yet'}
          description="Raise a request and Mirwal will reply in the thread. You will see every reply here."
        />
      ) : (
        <ul className="seller-support-list">
          {items.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" onClick={() => navigateTo(`/support/request/${ticket.id}`)}>
                <span className="seller-support-list-top">
                  <code>{ticket.reference}</code>
                  <StatusPill value={ticket.status} />
                </span>
                <strong>{ticket.subject}</strong>
                <small>
                  {ticket.category} · {ticket.priority} · {ticket.messageCount} message{ticket.messageCount === 1 ? '' : 's'}
                  {' · '}{formatWhen(ticket.lastMessageAt ?? ticket.createdAt)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function RequestDetail({ id }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const thread = useApiQuery((signal) => api.seller.tickets.get(id, signal), [id])
  const refresh = useCallback(() => { thread.refetch() }, [thread])

  const send = async (event) => {
    event.preventDefault()
    if (!reply.trim()) return
    setBusy(true)
    setFlash(null)
    try {
      await api.seller.tickets.reply(id, { body: reply.trim() })
      setReply('')
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  if (thread.isLoading) return <p className="seller-support-loading">Loading conversation...</p>
  if (thread.isError) {
    return <p className="seller-support-flash error"><Icon name="triangle-exclamation" /> {describeApiError(thread.error)}</p>
  }

  const ticket = thread.data
  const closed = ticket.status === 'closed'

  return (
    <div className="seller-support-thread">
      <header>
        <div>
          <h1>{ticket.subject}</h1>
          <p><code>{ticket.reference}</code> · {ticket.category} · opened {formatWhen(ticket.createdAt)}</p>
        </div>
        <div className="seller-support-thread-actions">
          <StatusPill value={ticket.status} />
          {!closed && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Close this request? You can open a new one if the problem returns.')) return
                setBusy(true)
                try { await api.seller.tickets.close(id); refresh() }
                catch (error) { setFlash({ tone: 'error', text: describeApiError(error) }) }
                finally { setBusy(false) }
              }}
            >
              Close request
            </button>
          )}
        </div>
      </header>

      {flash && <p className={`seller-support-flash ${flash.tone}`} role="status"><Icon name="triangle-exclamation" /> {flash.text}</p>}

      <ol className="seller-support-messages">
        {ticket.messages.map((message) => (
          <li key={message.id} className={`seller-support-message ${message.side}`}>
            <span><strong>{message.side === 'staff' ? 'Mirwal Support' : 'You'}</strong><time>{formatWhen(message.createdAt)}</time></span>
            <p>{message.body}</p>
          </li>
        ))}
      </ol>

      {closed ? (
        <p className="seller-support-closed">
          This request is closed. <button type="button" onClick={() => navigateTo('/support/create')}>Open a new one</button> if you still need help.
        </p>
      ) : (
        <form className="seller-support-reply" onSubmit={send}>
          <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} placeholder="Add a reply..." aria-label="Reply" />
          <button type="submit" className="primary" disabled={busy || !reply.trim()}>{busy ? 'Sending...' : 'Send reply'}</button>
        </form>
      )}
    </div>
  )
}

const TITLES = {
  overview: 'Seller Support',
  requests: 'My Requests',
  create: 'New Support Request',
  categories: 'Support Categories',
  detail: 'Request',
}

export default function SellerSupport({ view = 'overview' }) {
  const params = useParams()

  return (
    <SellerLayout
      activeItem="seller-support"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/') },
        { label: 'Support', onClick: () => navigateTo('/support/requests') },
        { label: TITLES[view] ?? TITLES.overview },
      ]}
    >
      <div className="seller-support-page">
        {view === 'detail' ? (
          <RequestDetail id={params.id} />
        ) : view === 'create' ? (
          <>
            <h1>New support request</h1>
            <p className="seller-support-intro">Mirwal replies in the thread — you will see every response under My Requests.</p>
            <CreateRequest />
          </>
        ) : (
          <>
            <h1>{view === 'requests' ? 'My requests' : 'Support'}</h1>
            <p className="seller-support-intro">Requests you raise here are answered by Mirwal staff.</p>
            <RequestList />
          </>
        )}
      </div>
    </SellerLayout>
  )
}
