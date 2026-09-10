import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { getAccessToken } from '@mirwal/shared/apiClient'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './seller-pages.css'

/**
 * Seller verification — reviewing the identity documents sellers upload.
 *
 * Previously not connected because Mirwal had no file storage; `lib/storage.js` is that
 * capability, and these are the documents it holds.
 *
 * Viewing a document is a deliberate two-step: the bytes are never in this page's data, and
 * the file is fetched only when an admin asks for it, through an authenticated request that
 * re-checks their permission. There is no static URL to leak, and nothing is prefetched — a
 * queue of CNICs should not all be pulled down just because the page rendered.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

const formatSize = (bytes) => (bytes < 1024 * 1024
  ? `${Math.round(bytes / 1024)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

export default function AdminVerification() {
  const [status, setStatus] = useState('pending')
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)
  const [viewing, setViewing] = useState(null)

  const query = useApiQuery(
    (signal) => api.admin.sellerDocuments.list({ pageSize: 100, ...(status ? { status } : {}) }, signal),
    [status],
  )
  const refresh = useCallback(() => { query.refetch() }, [query])

  /**
   * Fetch the file with the caller's bearer token and hand it to the browser as a blob URL.
   *
   * A plain <a href> or <img src> cannot carry the Authorization header, so the only
   * alternative would be a URL that authenticates itself — a link that leaks someone's CNIC
   * to anyone it is forwarded to.
   */
  const view = async (doc) => {
    setBusy(doc.id)
    setFlash(null)
    try {
      const response = await fetch(`${API_BASE}/admin/seller-documents/${encodeURIComponent(doc.id)}/file`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
      })
      if (!response.ok) throw new Error(`Could not load the file (${response.status}).`)
      const blob = await response.blob()
      // Revoked when the viewer closes, so the object URL does not outlive the modal.
      setViewing({ doc, url: URL.createObjectURL(blob), isImage: blob.type.startsWith('image/') })
    } catch (error) {
      setFlash({ tone: 'error', text: error.message })
    } finally { setBusy(null) }
  }

  const closeViewer = () => {
    if (viewing) URL.revokeObjectURL(viewing.url)
    setViewing(null)
  }

  const decide = async (doc, decision) => {
    let note
    if (decision === 'rejected') {
      // The API refuses a reasonless rejection, and the seller is emailed this text.
      note = window.prompt(`Why is "${doc.label}" being rejected?\nThe seller receives this by email.`)
      if (!note?.trim()) return
    }
    setBusy(doc.id)
    setFlash(null)
    try {
      const result = await api.admin.sellerDocuments.review(doc.id, {
        status: decision,
        ...(note ? { note: note.trim() } : { note: 'Verified.' }),
      })
      setFlash({ tone: 'success', text: result.message })
      closeViewer()
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }

  const items = query.data?.items ?? []
  const stats = query.data?.stats

  return (
    <AdminLayout>
      <div className="seller-page">
        <div className="seller-heading">
          <div>
            <h1>Seller Verification</h1>
            <p>Home <Icon name="chevron-right" /> Sellers <Icon name="chevron-right" /> Verification</p>
          </div>
        </div>

        {stats && (
          <div className="seller-kpis">
            {[
              ['Awaiting review', stats.pending, 'clock', 2],
              ['Approved', stats.approved, 'circle-check', 1],
              ['Rejected', stats.rejected, 'circle-xmark', 3],
              ['Total', stats.total, 'folder-open', 0],
            ].map(([label, value, icon, tone]) => (
              <article key={label}>
                <span className={`seller-kpi-icon tone-${tone}`}><Icon name={icon} /></span>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        )}

        <section className="seller-panel">
          {flash && (
            <p className={`seller-flash ${flash.tone}`} role="status">
              <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
            </p>
          )}

          <div className="seller-tabs">
            {[['pending', 'Awaiting review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([value, label]) => (
              <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>
            ))}
          </div>

          {query.isLoading && <LoadingState label="Loading documents" />}
          {query.isError && !query.isLoading && (
            <>
              <p className="seller-error-note">{describeApiError(query.error)}</p>
              <ErrorState onRetry={query.refetch} />
            </>
          )}

          {!query.isLoading && !query.isError && (items.length === 0 ? (
            <EmptyState
              icon="id-card"
              title={status === 'pending' ? 'Nothing awaiting review' : 'No documents'}
              description="Sellers upload verification documents from their portal; they arrive here for review."
            />
          ) : (
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead><tr><th>Store</th><th>Document</th><th>File</th><th>Uploaded</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {items.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.seller?.name ?? '—'}</td>
                      <td><strong>{doc.label}</strong></td>
                      <td>
                        {doc.originalName}
                        <small>{doc.mimeType} · {formatSize(doc.sizeBytes)}</small>
                      </td>
                      <td>{formatWhen(doc.uploadedAt)}</td>
                      <td>
                        <span className={`seller-status ${doc.status}`}>{doc.status}</span>
                        {doc.reviewNote && <small>{doc.reviewNote}</small>}
                      </td>
                      <td className="seller-row-actions">
                        <button type="button" disabled={busy === doc.id} onClick={() => view(doc)}>
                          {busy === doc.id ? '...' : 'View'}
                        </button>
                        {doc.status === 'pending' && (
                          <>
                            <button type="button" className="approve" disabled={busy === doc.id} onClick={() => decide(doc, 'approved')}>Approve</button>
                            <button type="button" className="reject" disabled={busy === doc.id} onClick={() => decide(doc, 'rejected')}>Reject</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <p className="seller-footnote">
            Documents are stored outside the web root and are never served statically. Each view is an
            authenticated request that re-checks your permission, and the file is not cached.
          </p>
        </section>

        {viewing && (
          <div className="doc-viewer" role="dialog" aria-label={`${viewing.doc.label} from ${viewing.doc.seller?.name ?? 'seller'}`}>
            <div className="doc-viewer-inner">
              <header>
                <div>
                  <strong>{viewing.doc.label}</strong>
                  <small>{viewing.doc.seller?.name} · {viewing.doc.originalName}</small>
                </div>
                <button type="button" onClick={closeViewer} aria-label="Close"><Icon name="xmark" /></button>
              </header>
              {viewing.isImage
                ? <img src={viewing.url} alt="" />
                : <iframe src={viewing.url} title="Document" />}
              {viewing.doc.status === 'pending' && (
                <footer>
                  <button type="button" className="approve" onClick={() => decide(viewing.doc, 'approved')}>Approve</button>
                  <button type="button" className="reject" onClick={() => decide(viewing.doc, 'rejected')}>Reject</button>
                </footer>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
