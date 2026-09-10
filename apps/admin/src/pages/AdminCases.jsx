import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { LoadingState, ErrorState, EmptyState } from './AdminStates'

/**
 * The case queue.
 *
 * Reporting used to work for exactly one subject — a product — and upholding a report did
 * nothing at all: no takedown, no warning, no record. There was no way to report a seller, a
 * store, a review, an order or a payment, and "Disputes" was a read-only SELECT over return
 * requests with no action on it.
 *
 * A case is one object with many subjects, because a report, a complaint and a dispute are the
 * same thing — someone says something is wrong, a human decides, an action follows. Six
 * near-identical tables would mean six queues, six service levels, and six places to forget an
 * audit row.
 *
 * Two things this screen insists on:
 *
 *   * **Overdue first, then urgent.** A queue sorted by arrival starves the cases that have
 *     waited longest, which is precisely what a service level measures.
 *
 *   * **Resolving and enforcing are separate.** Closing a case says what Mirwal concluded;
 *     enforcement is what it did about it, and one case can produce several actions (warn the
 *     seller *and* delist the product) or none at all. Collapsing them would make "upheld"
 *     silently mean "punished".
 */

const STATUS_TABS = [
  ['reported', 'New'],
  ['under_review', 'In review'],
  ['more_info_required', 'Awaiting reply'],
  ['action_taken', 'Actioned'],
  ['resolved', 'Resolved'],
  ['rejected', 'Rejected'],
]

const RESOLUTION_CODES = [
  ['upheld', 'Upheld — the report was correct'],
  ['partially_upheld', 'Partly upheld'],
  ['no_breach', 'No breach found'],
  ['insufficient_evidence', 'Not enough evidence'],
  ['duplicate', 'Duplicate of another case'],
  ['bad_faith', 'Filed in bad faith'],
  ['resolved_directly', 'Settled between the parties'],
]

const ENFORCEMENT = [
  ['warning', 'Warn the seller'],
  ['product_removed', 'Remove the listing'],
  ['listing_restricted', 'Stop new listings'],
  ['payout_held', 'Hold payouts'],
  ['store_restricted', 'Restrict the store'],
  ['store_suspended', 'Suspend the store'],
  ['store_banned', 'Ban the store'],
]

export default function AdminCases() {
  const [tab, setTab] = useState('reported')
  const [selected, setSelected] = useState(null)

  const stats = useApiQuery((signal) => api.admin.cases.stats(signal), [])
  const list = useApiQuery(
    (signal) => api.admin.cases.list({ status: tab, pageSize: 50 }, signal),
    [tab],
  )

  const cases = list.data?.items ?? []
  const refresh = () => { list.refetch(); stats.refetch() }

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1>Trust &amp; safety</h1>
          <p>
            {stats.data?.open ?? 0} open
            {stats.data?.overdue > 0 && <> &middot; <b className="app-overdue">{stats.data.overdue} past their service level</b></>}
          </p>
        </div>
      </header>

      <nav className="app-tabs">
        {STATUS_TABS.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setSelected(null) }}>
            {label}
            {stats.data?.byStatus?.[value] > 0 && <em>{stats.data.byStatus[value]}</em>}
          </button>
        ))}
      </nav>

      {list.isLoading && <LoadingState label="Loading cases" />}
      {list.error && (
        <>
          <p className="app-error" role="alert">{describeApiError(list.error)}</p>
          <ErrorState onRetry={list.refetch} />
        </>
      )}

      {!list.isLoading && !list.error && (
        cases.length === 0
          ? <EmptyState
            title="Nothing here"
            description={tab === 'reported'
              ? 'No new reports. Product, seller and counterfeit reports arrive here.'
              : 'No cases in this state.'}
          />
          : (
            <table className="admin-table app-table">
              <thead>
                <tr><th>Reference</th><th>Type</th><th>About</th><th>Against</th><th>Priority</th><th /></tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} className={item.overdue ? 'case-overdue' : ''}>
                    <td>
                      <code>{item.reference}</code>
                      {item.overdue && <small className="app-overdue">Overdue</small>}
                    </td>
                    <td>{item.type.replace(/_/g, ' ')}</td>
                    <td>
                      <b>{item.subject.summary || item.subject.type}</b>
                      {item.reasonCode && <small>{item.reasonCode.replace(/_/g, ' ')}</small>}
                    </td>
                    <td>{item.against?.storeName ?? '—'}</td>
                    <td><em className={`case-priority case-${item.priority}`}>{item.priority}</em></td>
                    <td><button type="button" onClick={() => setSelected(item.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}

      {selected && (
        <CaseDrawer id={selected} onClose={() => setSelected(null)} onChanged={refresh} />
      )}
    </div>
  )
}

function CaseDrawer({ id, onClose, onChanged }) {
  const detail = useApiQuery((signal) => api.admin.cases.get(id, signal), [id])
  const [panel, setPanel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [message, setMessage] = useState('')
  const [internal, setInternal] = useState(true)
  const [resolution, setResolution] = useState('upheld')
  const [note, setNote] = useState('')
  const [actionType, setActionType] = useState('warning')
  const [reasonNote, setReasonNote] = useState('')

  const item = detail.data

  const run = async (fn, { close = false } = {}) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
      if (close) onClose(); else { detail.refetch(); setPanel(null) }
    } catch (actionError) {
      setError(describeApiError(actionError))
    } finally { setBusy(false) }
  }

  return (
    <aside className="app-drawer" role="dialog" aria-label="Case">
      <header className="app-drawer-head">
        <h2>{item?.reference ?? 'Case'}</h2>
        <button type="button" onClick={onClose} aria-label="Close"><Icon name="xmark" /></button>
      </header>

      {detail.isLoading && <LoadingState label="Loading" />}
      {detail.error && <p className="app-error" role="alert">{describeApiError(detail.error)}</p>}

      {item && (
        <>
          <dl className="app-facts">
            <dt>Type</dt><dd>{item.type.replace(/_/g, ' ')}</dd>
            <dt>About</dt><dd>{item.subject.summary || item.subject.type}</dd>
            {item.reasonCode && <><dt>Reason</dt><dd>{item.reasonCode.replace(/_/g, ' ')}</dd></>}
            {item.against && <><dt>Against</dt><dd>{item.against.storeName}</dd></>}
            {/* Staff-only. Showing a reporter to the seller they reported is how a reporting
                system becomes a retaliation system — the API withholds it from everyone else. */}
            <dt>Reported by</dt><dd>{item.reporter?.name ?? 'Anonymous'}</dd>
            <dt>Status</dt><dd>{item.status.replace(/_/g, ' ')}</dd>
          </dl>

          {item.details && <p className="case-details">{item.details}</p>}

          {item.resolution && (
            <p className="app-decision">
              <b>Resolved:</b> {item.resolution.code.replace(/_/g, ' ')}
              {item.resolution.note ? ` — ${item.resolution.note}` : ''}
            </p>
          )}

          {item.messages?.length > 0 && (
            <section className="case-thread">
              <h3>Thread</h3>
              {item.messages.map((entry, index) => (
                <div key={index} className={entry.isInternal ? 'case-msg case-internal' : 'case-msg'}>
                  <b>{entry.authorSide}{entry.isInternal ? ' · internal' : ''}</b>
                  <p>{entry.body}</p>
                </div>
              ))}
            </section>
          )}

          {error && <p className="app-error" role="alert">{error}</p>}

          {panel === null && (
            <div className="app-actions">
              <button type="button" onClick={() => run(() => api.admin.cases.assign(id))} disabled={busy}>Assign to me</button>
              <button type="button" onClick={() => setPanel('message')} disabled={busy}>Add note</button>
              {item.against && (
                <button type="button" className="app-reject" onClick={() => setPanel('enforce')} disabled={busy}>Take action</button>
              )}
              <button type="button" className="app-approve" onClick={() => setPanel('resolve')} disabled={busy}>Resolve</button>
            </div>
          )}

          {panel === 'message' && (
            <form className="app-form" onSubmit={(event) => { event.preventDefault(); run(() => api.admin.cases.message(id, { body: message, isInternal: internal })); setMessage('') }}>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} required maxLength={4000} placeholder="What you found, or a reply to the reporter" />
              <label className="case-check">
                <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                {/* Defaults to internal: a note written for colleagues that reaches the
                    reporter by accident is the costlier mistake. */}
                Internal note — the reporter does not see this
              </label>
              <div>
                <button type="submit" disabled={busy || !message.trim()}>{busy ? 'Saving…' : 'Add'}</button>
                <button type="button" onClick={() => setPanel(null)} disabled={busy}>Back</button>
              </div>
            </form>
          )}

          {panel === 'enforce' && (
            <form
              className="app-form"
              onSubmit={(event) => {
                event.preventDefault()
                run(() => api.admin.sellers.enforce(item.against.id, {
                  actionType, reasonCode: item.reasonCode ?? 'policy', note: reasonNote || null, caseId: item.id,
                }))
              }}
            >
              <p>Recorded against {item.against.storeName}, who is told what happened and can appeal.</p>
              <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
                {ENFORCEMENT.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <textarea value={reasonNote} onChange={(event) => setReasonNote(event.target.value)} rows={3} placeholder="What the seller is told" maxLength={2000} />
              <div>
                <button type="submit" className="app-reject" disabled={busy}>{busy ? 'Applying…' : 'Apply action'}</button>
                <button type="button" onClick={() => setPanel(null)} disabled={busy}>Back</button>
              </div>
            </form>
          )}

          {panel === 'resolve' && (
            <form
              className="app-form"
              onSubmit={(event) => {
                event.preventDefault()
                run(() => api.admin.cases.resolve(id, {
                  status: resolution === 'no_breach' || resolution === 'bad_faith' ? 'rejected' : 'resolved',
                  resolutionCode: resolution,
                  note: note || null,
                }), { close: true })
              }}
            >
              <p>Closing the case records what Mirwal concluded. Any action taken is separate and stays on the seller&rsquo;s record.</p>
              <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                {RESOLUTION_CODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Note for the record" maxLength={2000} />
              <div>
                <button type="submit" className="app-approve" disabled={busy}>{busy ? 'Closing…' : 'Close case'}</button>
                <button type="button" onClick={() => setPanel(null)} disabled={busy}>Back</button>
              </div>
            </form>
          )}
        </>
      )}
    </aside>
  )
}
