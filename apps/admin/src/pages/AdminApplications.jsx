import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { LoadingState, ErrorState, EmptyState } from './AdminStates'

/**
 * Reviewing seller applications.
 *
 * The old queue was `GET /sellers?status=pending` — an application treated as a store awaiting
 * a decision. In production that list could only ever be empty, because nothing outside the
 * database seeder created a pending store: there was no way to apply at all. Sellers can apply
 * now, and this is where those applications are decided.
 *
 * Three things this screen is built around:
 *
 *   * **Oldest first, not newest.** A newest-first queue quietly starves the applications that
 *     have waited longest, which is the opposite of what a service-level target measures.
 *
 *   * **Claiming before deciding.** Two reviewers opening the same case both do the work and
 *     one of them wastes it; worse, they can reach different conclusions.
 *
 *   * **Identity is behind a permission.** CNIC and NTN are returned only to a reviewer holding
 *     `seller.kyc.view`, and every such read is written to the PII access log. A reviewer
 *     triaging obviously incomplete applications does not need to see anyone's identity card,
 *     so this screen works without it and simply shows less.
 */

const STATUS_TABS = [
  ['submitted', 'Waiting'],
  ['in_review', 'In review'],
  ['more_info_required', 'Awaiting seller'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
]

/** Mirrors DECISION_CODES on the server, so a rejection is explainable rather than free text. */
const REJECT_REASONS = [
  ['document_illegible', 'Documents could not be read clearly'],
  ['document_mismatch', 'Details do not match the documents'],
  ['document_expired', 'A document has expired'],
  ['identity_unverified', 'Identity could not be confirmed'],
  ['duplicate_account', 'Already has a Mirwal store'],
  ['prohibited_category', 'Sells goods Mirwal does not allow'],
  ['incomplete', 'Required information missing'],
  ['suspected_fraud', 'Refused after a risk review'],
  ['other', 'Other (explain below)'],
]

export default function AdminApplications() {
  const [status, setStatus] = useState('submitted')
  const [selected, setSelected] = useState(null)

  const counts = useApiQuery((signal) => api.admin.applications.counts(signal), [])
  const list = useApiQuery(
    (signal) => api.admin.applications.list({ status, pageSize: 50 }, signal),
    [status],
  )
  // The list endpoint is paginated (`okPage`), so the payload is `{ items, pagination }` —
  // not a bare array.
  const applications = list.data?.items ?? []

  const refresh = () => { list.refetch(); counts.refetch() }

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1>Seller applications</h1>
          <p>
            {counts.data?.waiting ?? 0} waiting
            {counts.data?.overdue > 0 && (
              // Ageing is the number that matters: a queue with no old cases is healthy
              // however long it is, and one with old cases is not however short.
              <> &middot; <b className="app-overdue">{counts.data.overdue} over two days</b></>
            )}
          </p>
        </div>
      </header>

      <nav className="app-tabs">
        {STATUS_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={status === value ? 'active' : ''}
            onClick={() => { setStatus(value); setSelected(null) }}
          >
            {label}
            {counts.data?.[value] > 0 && <em>{counts.data[value]}</em>}
          </button>
        ))}
      </nav>

      {list.isLoading && <LoadingState label="Loading applications" />}
      {list.error && (
        <>
          <p className="app-error" role="alert">{describeApiError(list.error)}</p>
          <ErrorState onRetry={list.refetch} />
        </>
      )}

      {!list.isLoading && !list.error && (
        applications.length === 0
          ? <EmptyState
            title="Nothing here"
            description={status === 'submitted'
              ? 'No applications are waiting. New ones appear here as sellers apply.'
              : 'No applications in this state.'}
          />
          : (
            <table className="admin-table app-table">
              <thead>
                <tr>
                  <th>Reference</th><th>Store</th><th>Applicant</th><th>Type</th><th>Waiting since</th><th />
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td><code>{application.reference}</code></td>
                    <td>
                      <b>{application.storeName}</b>
                      <small>{application.city}{application.province ? `, ${application.province}` : ''}</small>
                    </td>
                    <td>
                      {application.applicant.name}
                      <small>{application.applicant.email}</small>
                    </td>
                    <td>{application.sellerType === 'business' ? 'Business' : 'Individual'}</td>
                    <td>{application.submittedAt ? new Date(`${application.submittedAt}Z`).toLocaleDateString() : '—'}</td>
                    <td><button type="button" onClick={() => setSelected(application.id)}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}

      {selected && (
        <ApplicationDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onDecided={() => { setSelected(null); refresh() }}
        />
      )}
    </div>
  )
}

function ApplicationDrawer({ id, onClose, onDecided }) {
  const detail = useApiQuery((signal) => api.admin.applications.get(id, signal), [id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [action, setAction] = useState(null)
  const [note, setNote] = useState('')
  const [code, setCode] = useState('incomplete')

  const application = detail.data

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try { await fn(); onDecided() }
    catch (actionError) { setError(describeApiError(actionError)) }
    finally { setBusy(false) }
  }

  return (
    <aside className="app-drawer" role="dialog" aria-label="Application review">
      <header className="app-drawer-head">
        <h2>{application?.reference ?? 'Application'}</h2>
        <button type="button" onClick={onClose} aria-label="Close"><Icon name="xmark" /></button>
      </header>

      {detail.isLoading && <LoadingState label="Loading" />}
      {detail.error && <p className="app-error" role="alert">{describeApiError(detail.error)}</p>}

      {application && (
        <>
          <dl className="app-facts">
            <dt>Store</dt><dd>{application.storeName}</dd>
            <dt>Type</dt><dd>{application.sellerType === 'business' ? 'Registered business' : 'Individual'}</dd>
            {application.legalName && <><dt>Legal name</dt><dd>{application.legalName}</dd></>}
            <dt>Applicant</dt><dd>{application.applicant.name}</dd>
            <dt>Email</dt><dd>{application.applicant.email}</dd>
            <dt>Phone</dt><dd>{application.applicant.phone}</dd>
            <dt>City</dt><dd>{application.city}, {application.province}</dd>
            {application.categories && <><dt>Sells</dt><dd>{application.categories}</dd></>}
            {application.notes && <><dt>Notes</dt><dd>{application.notes}</dd></>}
          </dl>

          {application.identity ? (
            <section className="app-identity">
              <h3><Icon name="id-card" /> Identity</h3>
              {/* Only present when the reviewer holds `seller.kyc.view`. Reading this wrote a
                  row to the PII access log. */}
              <dl className="app-facts">
                {application.identity.cnic && <><dt>CNIC</dt><dd>{application.identity.cnic}</dd></>}
                {application.identity.dateOfBirth && <><dt>Date of birth</dt><dd>{application.identity.dateOfBirth}</dd></>}
                {application.identity.ntn && <><dt>NTN</dt><dd>{application.identity.ntn}</dd></>}
                {application.identity.businessRegNo && <><dt>Registration</dt><dd>{application.identity.businessRegNo}</dd></>}
              </dl>
              <p className="app-pii-note">This view is recorded in the PII access log.</p>
            </section>
          ) : (
            <p className="app-pii-note">
              Identity details are hidden — they need the KYC permission, which this account does not hold.
            </p>
          )}

          {application.infoRequested && (
            <p className="app-info-requested"><b>Waiting on the applicant:</b> {application.infoRequested}</p>
          )}

          {error && <p className="app-error" role="alert">{error}</p>}

          {['submitted', 'in_review', 'more_info_required'].includes(application.status) && (
            <div className="app-actions">
              {application.status === 'submitted' && (
                <button type="button" onClick={() => run(() => api.admin.applications.claim(id))} disabled={busy}>
                  Claim for review
                </button>
              )}

              {action === null && (
                <>
                  <button type="button" className="app-approve" onClick={() => setAction('approve')} disabled={busy}>Approve</button>
                  <button type="button" onClick={() => setAction('info')} disabled={busy}>Need more info</button>
                  <button type="button" className="app-reject" onClick={() => setAction('reject')} disabled={busy}>Reject</button>
                </>
              )}

              {action === 'approve' && (
                <form
                  className="app-form"
                  onSubmit={(event) => { event.preventDefault(); run(() => api.admin.applications.approve(id, { note: note || null })) }}
                >
                  <p>Approving creates the store and lets this person sign in to Seller Centre.</p>
                  <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Internal note (optional)" maxLength={1000} />
                  <div>
                    <button type="submit" className="app-approve" disabled={busy}>{busy ? 'Approving…' : 'Approve and create store'}</button>
                    <button type="button" onClick={() => setAction(null)} disabled={busy}>Back</button>
                  </div>
                </form>
              )}

              {action === 'info' && (
                <form
                  className="app-form"
                  onSubmit={(event) => { event.preventDefault(); run(() => api.admin.applications.requestInfo(id, { message: note })) }}
                >
                  {/* Shown to the applicant verbatim, which is why it is required: "more
                      information needed" with no statement of what is needed wastes both sides. */}
                  <p>The applicant sees this exactly as written.</p>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="e.g. The CNIC back image is blurred — please re-upload it."
                    minLength={10}
                    maxLength={1000}
                    required
                    rows={3}
                  />
                  <div>
                    <button type="submit" disabled={busy || note.trim().length < 10}>{busy ? 'Sending…' : 'Ask the applicant'}</button>
                    <button type="button" onClick={() => setAction(null)} disabled={busy}>Back</button>
                  </div>
                </form>
              )}

              {action === 'reject' && (
                <form
                  className="app-form"
                  onSubmit={(event) => { event.preventDefault(); run(() => api.admin.applications.reject(id, { code, note: note || null })) }}
                >
                  <p>The applicant is told the reason.</p>
                  <select value={code} onChange={(event) => setCode(event.target.value)}>
                    {REJECT_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={code === 'other' ? 'Required for "other"' : 'Anything to add (optional)'}
                    maxLength={1000}
                    required={code === 'other'}
                    rows={3}
                  />
                  <div>
                    <button type="submit" className="app-reject" disabled={busy || (code === 'other' && !note.trim())}>
                      {busy ? 'Rejecting…' : 'Reject application'}
                    </button>
                    <button type="button" onClick={() => setAction(null)} disabled={busy}>Back</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {application.decisionNote && (
            <p className="app-decision"><b>Decision:</b> {application.decisionCode} — {application.decisionNote}</p>
          )}
        </>
      )}
    </aside>
  )
}
