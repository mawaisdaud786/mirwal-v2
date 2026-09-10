import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './support-queue.css'

/**
 * The support queue — the staff side of the tickets sellers and customers open.
 *
 * This replaces the "Seller Complaints" placeholder, which said there was no ticketing system.
 * There is one now (migration 013), and it is the same table the seller panel writes to: a
 * seller's "Create Request" lands here, and a reply here appears in their thread.
 *
 * Internal notes are the one thing that does not cross that boundary. They are marked in the
 * composer and stripped server-side from every requester read, so the "Internal note" toggle
 * genuinely means "the person who raised this will never see it".
 */

const STATUS_TABS = [
  ['', 'All'],
  ['open', 'Open'],
  ['pending', 'Pending'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
]

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminSupportQueue() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reply, setReply] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const stats = useApiQuery((signal) => api.admin.tickets.stats(signal), [])
  const list = useApiQuery(
    (signal) => api.admin.tickets.list(
      { pageSize: 50, ...(status ? { status } : {}), ...(search ? { search } : {}) },
      signal,
    ),
    [status, search],
  )
  const thread = useApiQuery(
    (signal) => api.admin.tickets.get(openId, signal),
    [openId],
    { enabled: Boolean(openId) },
  )

  const refresh = useCallback(() => { list.refetch(); stats.refetch(); if (openId) thread.refetch() },
    [list, stats, thread, openId])

  const run = async (action, successText) => {
    setBusy(true)
    setFlash(null)
    try {
      await action()
      setFlash({ tone: 'success', text: successText })
      refresh()
      return true
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
      return false
    } finally { setBusy(false) }
  }

  const sendReply = async (event) => {
    event.preventDefault()
    if (!reply.trim()) return
    const ok = await run(
      () => api.admin.tickets.reply(openId, { body: reply.trim(), isInternal }),
      isInternal ? 'Internal note added — the requester cannot see it.' : 'Reply sent.',
    )
    if (ok) { setReply(''); setIsInternal(false) }
  }

  const items = list.data?.items ?? []

  return (
    <AdminLayout>
      <div className="support-page">
        <Heading section="support" crumb="Customers" title="Support Tickets" />

        {stats.data && (
          <div className="support-kpis">
            {[
              ['Total', stats.data.total, 'inbox', 0],
              ['Open', stats.data.open, 'envelope-open', 2],
              ['Pending', stats.data.pending, 'clock', 2],
              ['Resolved', stats.data.resolved, 'circle-check', 1],
            ].map(([label, value, icon, tone]) => (
              <article key={label}>
                <span className={`support-kpi-icon tone-${tone}`}><Icon name={icon} /></span>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        )}

        <section className="support-panel">
          {flash && (
            <p className={`support-flash ${flash.tone}`} role="status">
              <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
            </p>
          )}

          <div className="support-tabs">
            {STATUS_TABS.map(([value, label]) => (
              <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
            <label className="support-search">
              <Icon name="magnifying-glass" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search subject or reference..."
                aria-label="Search tickets"
              />
            </label>
          </div>

          {list.isLoading && <LoadingState label="Loading tickets" />}
          {list.isError && !list.isLoading && (
            <>
              <p className="support-error-note">{describeApiError(list.error)}</p>
              <ErrorState onRetry={list.refetch} />
            </>
          )}

          {!list.isLoading && !list.isError && (items.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No tickets"
              description={status ? `No ${status} tickets right now.` : 'Nobody has raised a support request yet. Requests opened from the seller portal or the storefront appear here.'}
            />
          ) : (
            <div className="support-layout">
              <div className="support-list">
                {items.map((ticket) => (
                  <button
                    type="button"
                    key={ticket.id}
                    className={`support-item ${openId === ticket.id ? 'active' : ''}`}
                    onClick={() => { setOpenId(ticket.id); setReply(''); setIsInternal(false); setFlash(null) }}
                  >
                    <span className="support-item-top">
                      <code>{ticket.reference}</code>
                      <em className={`support-status ${ticket.status}`}>{ticket.status}</em>
                    </span>
                    <strong>{ticket.subject}</strong>
                    <small>
                      {ticket.store ? ticket.store.name : ticket.requester?.name ?? 'Customer'}
                      {' · '}{ticket.priority}{' · '}{ticket.messageCount} message{ticket.messageCount === 1 ? '' : 's'}
                    </small>
                  </button>
                ))}
              </div>

              <div className="support-thread">
                {!openId ? (
                  <EmptyState icon="comments" title="Select a ticket" description="Choose a request on the left to read and reply to it." />
                ) : thread.isLoading ? (
                  <LoadingState label="Loading conversation" />
                ) : thread.isError ? (
                  <ErrorState onRetry={thread.refetch} />
                ) : thread.data && (
                  <>
                    <header className="support-thread-head">
                      <div>
                        <h2>{thread.data.subject}</h2>
                        <p>
                          <code>{thread.data.reference}</code> · {thread.data.store ? thread.data.store.name : thread.data.requester?.name}
                          {thread.data.requester?.email ? ` · ${thread.data.requester.email}` : ''}
                        </p>
                      </div>
                      <div className="support-thread-actions">
                        <select
                          value={thread.data.status}
                          disabled={busy}
                          onChange={(event) => run(
                            () => api.admin.tickets.update(openId, { status: event.target.value }),
                            `Ticket marked ${event.target.value}.`,
                          )}
                          aria-label="Ticket status"
                        >
                          {['open', 'pending', 'resolved', 'closed'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <select
                          value={thread.data.priority}
                          disabled={busy}
                          onChange={(event) => run(
                            () => api.admin.tickets.update(openId, { priority: event.target.value }),
                            `Priority set to ${event.target.value}.`,
                          )}
                          aria-label="Ticket priority"
                        >
                          {['low', 'normal', 'high', 'urgent'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </div>
                    </header>

                    <ol className="support-messages">
                      {thread.data.messages.map((message) => (
                        <li key={message.id} className={`support-message ${message.side}${message.isInternal ? ' internal' : ''}`}>
                          <span className="support-message-meta">
                            <strong>{message.author}</strong>
                            {message.isInternal && <em><Icon name="lock" /> Internal — not visible to the requester</em>}
                            <time>{formatWhen(message.createdAt)}</time>
                          </span>
                          <p>{message.body}</p>
                        </li>
                      ))}
                    </ol>

                    <form className="support-composer" onSubmit={sendReply}>
                      <textarea
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        rows={3}
                        placeholder={isInternal ? 'Internal note for Mirwal staff only...' : 'Reply to the requester...'}
                        aria-label="Reply"
                      />
                      <div className="support-composer-actions">
                        <label className={isInternal ? 'internal-on' : ''}>
                          <input type="checkbox" checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} />
                          <Icon name="lock" /> Internal note
                        </label>
                        <button type="submit" className="primary" disabled={busy || !reply.trim()}>
                          {busy ? 'Sending...' : isInternal ? 'Add note' : 'Send reply'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}
