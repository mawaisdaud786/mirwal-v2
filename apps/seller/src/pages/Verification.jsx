import { useCallback, useRef, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { getAccessToken } from '@mirwal/shared/apiClient'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './verification.css'
import IdentityDetails from '../components/IdentityDetails'

/**
 * Store verification — uploading identity and business documents for Mirwal to review.
 *
 * This is new: Mirwal previously had no file storage, so there was nowhere for a CNIC scan to
 * go and the page said so. `lib/storage.js` on the API now writes these outside the web root,
 * and they are only ever readable through an authenticated request.
 *
 * The upload goes straight to the API as multipart form data rather than through the shared
 * JSON client, which serialises bodies as JSON and would corrupt the file.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

const formatSize = (bytes) => (bytes < 1024 * 1024
  ? `${Math.round(bytes / 1024)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PK', { dateStyle: 'medium' })
}

export default function SellerVerification() {
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)
  const inputs = useRef({})

  const query = useApiQuery((signal) => api.seller.documents.list(signal), [])
  const refresh = useCallback(() => { query.refetch() }, [query])

  const upload = async (docType, file) => {
    if (!file) return
    setBusy(docType)
    setFlash(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('docType', docType)
      const response = await fetch(`${API_BASE}/seller/me/documents`, {
        method: 'POST',
        // No Content-Type header: the browser must set the multipart boundary itself.
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
        body: form,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Upload failed.')
      setFlash({ tone: 'success', text: payload.message })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: error.message })
    } finally {
      setBusy(null)
      // Clear the picker so choosing the same file again still fires a change event.
      if (inputs.current[docType]) inputs.current[docType].value = ''
    }
  }

  const view = async (doc) => {
    setBusy(doc.id)
    try {
      const response = await fetch(`${API_BASE}/seller/me/documents/${encodeURIComponent(doc.id)}/file`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Could not open that file.')
      const url = URL.createObjectURL(await response.blob())
      window.open(url, '_blank', 'noopener')
      // The tab has the blob by now; releasing it keeps this page from holding the bytes.
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (error) {
      setFlash({ tone: 'error', text: error.message })
    } finally { setBusy(null) }
  }

  const remove = async (doc) => {
    if (!window.confirm(`Remove "${doc.label}"? You can upload a replacement afterwards.`)) return
    setBusy(doc.id)
    setFlash(null)
    try {
      const result = await api.seller.documents.remove(doc.id)
      setFlash({ tone: 'success', text: result?.message ?? 'Document removed.' })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }

  const data = query.data
  const byType = new Map((data?.documents ?? []).map((doc) => [doc.docType, doc]))

  return (
    <SellerLayout
      activeItem="verification"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/') },
        { label: 'Store', onClick: () => navigateTo('/store/profile') },
        { label: 'Verification' },
      ]}
    >
      <div className="verification-page">
        <h1>Store verification</h1>
        <p className="verification-intro">
          Mirwal reviews these to confirm who is trading. They are stored privately and are visible only to
          you and Mirwal staff — never to shoppers, and never on a public link.
        </p>

        {flash && (
          <p className={`verification-flash ${flash.tone}`} role="status">
            <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
          </p>
        )}

        {query.isLoading ? <p className="verification-loading">Loading documents...</p>
          : query.isError ? <p className="verification-flash error"><Icon name="triangle-exclamation" /> {describeApiError(query.error)}</p>
            : (
              <>
                <IdentityDetails />

                <div className={`verification-banner ${data.isVerified ? 'verified' : ''}`}>
                  <Icon name={data.isVerified ? 'circle-check' : 'clock'} />
                  <div>
                    <strong>{data.isVerified ? 'Your store is verified' : 'Verification incomplete'}</strong>
                    <p>
                      {data.isVerified
                        ? 'Every required document has been approved.'
                        : `Still needed: ${data.requirements.filter((r) => r.required && !r.provided).map((r) => r.label).join(', ') || 'approval of the documents you have sent'}.`}
                    </p>
                  </div>
                </div>

                <div className="verification-grid">
                  {data.requirements.map((requirement) => {
                    const doc = byType.get(requirement.type)
                    return (
                      <article key={requirement.type} className={`verification-card ${doc?.status ?? 'empty'}`}>
                        <header>
                          <strong>{requirement.label}</strong>
                          {requirement.required && <em>Required</em>}
                        </header>

                        {doc ? (
                          <>
                            <p className="verification-file">
                              <Icon name="file-lines" /> {doc.originalName}
                              <small>{doc.mimeType} · {formatSize(doc.sizeBytes)} · {formatWhen(doc.uploadedAt)}</small>
                            </p>
                            <span className={`verification-status ${doc.status}`}>{doc.status}</span>
                            {doc.reviewNote && <p className="verification-note">{doc.reviewNote}</p>}
                            <div className="verification-card-actions">
                              <button type="button" disabled={busy === doc.id} onClick={() => view(doc)}>View</button>
                              {doc.status !== 'approved' && (
                                <button type="button" disabled={busy === doc.id} onClick={() => remove(doc)}>Remove</button>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="verification-empty">Not uploaded yet.</p>
                        )}

                        <label className="verification-upload">
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png,image/webp"
                            ref={(element) => { inputs.current[requirement.type] = element }}
                            onChange={(event) => upload(requirement.type, event.target.files?.[0])}
                            disabled={busy === requirement.type || doc?.status === 'approved'}
                          />
                          <span>
                            <Icon name="cloud-arrow-up" />
                            {busy === requirement.type ? 'Uploading...'
                              : doc?.status === 'approved' ? 'Approved — locked'
                                : doc ? 'Replace file' : 'Choose file'}
                          </span>
                        </label>
                      </article>
                    )
                  })}
                </div>

                {data.documents.length === 0 && (
                  <EmptyState
                    icon="id-card"
                    title="No documents yet"
                    description="Upload your CNIC to begin. Mirwal usually reviews within a couple of working days."
                  />
                )}
              </>
            )}

        <p className="verification-footnote">
          PDF, JPG, PNG or WebP, up to 5MB. Mirwal checks the file&rsquo;s actual contents, so renaming a file
          to change its type will not work. An approved document cannot be removed — contact support if one is wrong.
        </p>
      </div>
    </SellerLayout>
  )
}
