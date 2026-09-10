import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import Icon from '@mirwal/shared/Icon'
import { LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import { useAdminSession } from '../AdminSession'
import api from '../api'
import './products.css'

/**
 * One listing, and everything Mirwal can do to it.
 *
 * There was no product detail page at all: the list was the end of the road, so approving a
 * submission meant working from a name and a thumbnail with no description, no images, no
 * variants, no screening flags and no history of who had touched it before. That is not a
 * decision, it is a guess.
 *
 * Every control is gated on the operator's own permissions, matching `requirePermission` on the
 * route behind it. A product moderator can approve and reject and cannot edit prices; whoever
 * holds `catalog.product.write` can edit and cannot necessarily delete. Hiding a button the
 * server would refuse spares someone a pointless error — it is not the boundary, and the
 * endpoints enforce the same rules independently.
 */

const STATUS_TONE = {
  active: 'published', pending_review: 'pending-approval', draft: 'pending-approval',
  rejected: 'rejected', delisted: 'rejected', archived: 'rejected',
}

/** Editable here. Stock, SKU and images belong to the seller and to inventory, not to this form. */
const FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'price', label: 'Price', money: true, required: true },
  { key: 'compareAtPrice', label: 'Compare-at price', money: true },
  { key: 'costPrice', label: 'Cost price', money: true, help: 'Admin-only. Never shown on the storefront.' },
]

export default function AdminProductDetail() {
  const location = useLocation()
  const productId = location.pathname.split('/').filter(Boolean).pop()
  const { can } = useAdminSession()

  const detail = useApiQuery((signal) => api.admin.products.get(productId, signal), [productId])
  const options = useApiQuery((signal) => api.categories.list(signal), [])

  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const product = detail.data

  /**
   * An unsaved edit belongs to the product it was typed against.
   *
   * Navigating from one listing to another reuses this component, so without this the half-typed
   * price for product A would appear over product B and be saved onto it. Adjusted during
   * render rather than in an effect, which is React's own answer to state that depends on a
   * changed prop — an effect here would render the wrong product's draft once before correcting
   * itself.
   */
  const [draftFor, setDraftFor] = useState(productId)
  if (draftFor !== productId) {
    setDraftFor(productId)
    setDraft({})
  }

  useEffect(() => {
    document.title = product ? `${product.name} | Mirwal Admin` : 'Product | Mirwal Admin'
  }, [product])

  if (detail.isLoading) return <AdminLayout><LoadingState label="Loading product" /></AdminLayout>
  if (detail.error) {
    return (
      <AdminLayout>
        <p className="products-flash error" role="alert">{describeApiError(detail.error)}</p>
        <ErrorState onRetry={detail.refetch} />
      </AdminLayout>
    )
  }

  const editable = can('catalog.product.write')
  const dirty = Object.keys(draft).length > 0
  const value = (key) => draft[key] ?? (FIELDS.find((field) => field.key === key)?.money
    ? (product[key]?.amount ?? '')
    : (product[key] ?? ''))

  const run = async (action, successText, { back = false } = {}) => {
    setBusy(true)
    setFlash(null)
    try {
      await action()
      if (back) { navigateTo('/products'); return }
      setFlash({ tone: 'success', text: successText })
      setDraft({})
      detail.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const save = (event) => {
    event.preventDefault()
    // Only what changed is sent: a partial patch means one section's form cannot blank out a
    // field it never displayed.
    run(() => api.admin.products.update(productId, draft), 'Saved.')
  }

  return (
    <AdminLayout>
      <div className="products-page product-detail">
        <div className="products-heading">
          <div>
            <button type="button" className="table-link" onClick={() => navigateTo('/products')}>
              <Icon name="chevron-left" /> All products
            </button>
            <h1>{product.name}</h1>
            <p>
              <span className={`product-status ${STATUS_TONE[product.status] ?? ''}`}>{product.status.replace(/_/g, ' ')}</span>
              {product.seller && (
                <> &middot; <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${product.seller.id}`)}>{product.seller.name}</button></>
              )}
              {product.category && (
                <> &middot; <button type="button" className="table-link" onClick={() => navigateTo(`/categories/${product.category.slug}`)}>{product.category.name}</button></>
              )}
            </p>
          </div>
          <div className="products-heading-actions">
            {can('catalog.product.approve') && product.status === 'pending_review' && (
              <>
                <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.admin.products.setApproval(productId, { approved: true }), 'Approved — the listing is live.')}>
                  <Icon name="circle-check" /> Approve
                </button>
                <button type="button" disabled={busy} onClick={() => setRejecting((current) => !current)}>
                  <Icon name="circle-xmark" /> Reject
                </button>
              </>
            )}
            {editable && product.status === 'active' && (
              <button type="button" disabled={busy} onClick={() => run(() => api.admin.products.setStatus(productId, 'delisted'), 'Delisted.')}>
                <Icon name="eye-slash" /> Delist
              </button>
            )}
            {editable && ['delisted', 'archived'].includes(product.status) && (
              <button type="button" disabled={busy} onClick={() => run(() => api.admin.products.setStatus(productId, 'active'), 'Back on the storefront.')}>
                <Icon name="eye" /> Relist
              </button>
            )}
            {can('catalog.product.delete') && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Delete "${product.name}"? This cannot be undone from here.`)) return
                  run(() => api.admin.products.remove(productId), '', { back: true })
                }}
              >
                <Icon name="trash" /> Delete
              </button>
            )}
          </div>
        </div>

        {flash && <p className={`products-flash ${flash.tone}`} role="status">{flash.text}</p>}

        {rejecting && (
          <form
            className="product-reject"
            onSubmit={(event) => {
              event.preventDefault()
              run(() => api.admin.products.setApproval(productId, { approved: false, reason: reason.trim() }), 'Rejected, and the seller has been told why.')
              setRejecting(false)
            }}
          >
            {/* The API refuses a rejection without a reason, and the seller is shown it. */}
            <label>
              Why is this being rejected? The seller sees this.
              <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={255} required placeholder="Images do not match the product described" />
            </label>
            <div>
              <button type="submit" className="danger" disabled={busy || reason.trim().length < 3}>Reject listing</button>
              <button type="button" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
            </div>
          </form>
        )}

        {product.rejectedReason && (
          <p className="product-rejected-note"><b>Rejected:</b> {product.rejectedReason}</p>
        )}

        {/* What automated screening found. A score, not a verdict — nothing here approves or
            rejects, it only says which listing was worth opening first. */}
        {product.moderationFlags?.length > 0 && (
          <section className="product-flags">
            <h2>Screening flagged this <em>risk {product.moderationRisk}</em></h2>
            <ul>
              {product.moderationFlags.map((flag, index) => (
                <li key={index}>
                  <b>{String(flag.code ?? '').replace(/_/g, ' ')}</b>
                  {flag.matched ? <span> — matched &ldquo;{flag.matched}&rdquo;</span> : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="product-detail-grid">
          <section className="products-panel">
            <h2>Details</h2>
            <form onSubmit={save}>
              <div className="product-detail-fields">
                {FIELDS.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <input
                      value={value(field.key)}
                      onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                      disabled={!editable}
                      required={field.required}
                      inputMode={field.money ? 'decimal' : undefined}
                    />
                    {field.help && <small>{field.help}</small>}
                  </label>
                ))}
                <label className="product-detail-wide">
                  <span>Category</span>
                  <select
                    value={draft.categorySlug ?? product.category?.slug ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, categorySlug: event.target.value }))}
                    disabled={!editable}
                  >
                    {(options.data ?? []).map((category) => (
                      <option key={category.slug} value={category.slug}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="product-detail-wide">
                  <span>Description</span>
                  <textarea
                    rows={6}
                    maxLength={20000}
                    value={draft.description ?? product.description ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    disabled={!editable}
                  />
                </label>
              </div>

              {editable
                ? (
                  <div className="product-form-actions">
                    <button type="submit" className="primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button>
                    {dirty && <button type="button" onClick={() => setDraft({})} disabled={busy}>Discard</button>}
                  </div>
                )
                // Said plainly rather than showing a dead Save button.
                : <p className="product-readonly">You can review this listing but not edit it. Editing needs the catalogue-write permission.</p>}
            </form>
          </section>

          <aside className="products-panel">
            <h2>Stock &amp; variants</h2>
            {product.variants?.length > 0 ? (
              <table className="products-table">
                <thead><tr><th>Variant</th><th>Price</th><th>Stock</th></tr></thead>
                <tbody>
                  {product.variants.map((variant) => (
                    <tr key={variant.id}>
                      <td>{variant.name ?? 'Default'}</td>
                      <td>{variant.price?.display ?? product.price.display}</td>
                      <td>{variant.quantity ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="product-readonly">No variants — stock sits on the listing itself.</p>}

            {product.images?.length > 0 && (
              <>
                <h2>Images</h2>
                <div className="product-detail-images">
                  {product.images.map((image, index) => <img key={index} src={image.url} alt={image.alt ?? ''} />)}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </AdminLayout>
  )
}
