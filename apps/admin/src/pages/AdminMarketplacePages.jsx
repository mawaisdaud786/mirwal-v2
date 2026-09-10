import { useCallback, useState } from 'react'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import AdminLayout from './AdminLayout'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import { Pagination } from './AdminComponents'
import { useAdminSession } from '../AdminSession'
import api from '../api'
import Icon from '@mirwal/shared/Icon'
import './marketplace-pages.css'

/**
 * Brands, Inventory, Product Approvals, Attributes and Product Reports.
 *
 * Three of these are real now, against the admin catalogue API rather than the public one.
 * The distinction matters and is the reason this file previously said they could not be built:
 *
 *   - The public `GET /products` serves `status = 'active'` only, so a pending-review queue
 *     was genuinely impossible to source from it.
 *   - The public product shape deliberately reports only in-stock/low-stock booleans, never
 *     exact counts, because the Phase 0 audit found the UI inventing "Only 8 left!" urgency.
 *
 * `GET /admin/products` and `GET /admin/inventory` exist for exactly this: every status, and
 * real quantity/reserved/available figures, on an admin-only route. The storefront still never
 * sees either.
 *
 * Attributes and Product Reports moved to AdminOperationsPages, which reads the real
 * and no user-reporting system to read.
 */

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`marketplace-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

function Heading({ title, action }) {
  return (
    <div className="marketplace-heading">
      <div>
        <h1>{title}</h1>
        <p>Home <Icon name="chevron-right" /> Marketplace <Icon name="chevron-right" /> {title}</p>
      </div>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Brands — real CRUD
// ---------------------------------------------------------------------------

/**
 * Sellers waiting on permission to list a protected brand.
 *
 * Sits above the brand table rather than on its own page: the decision to gate a brand and the
 * decisions that follow from it are the same job, and splitting them across two screens is how
 * a queue ends up unattended.
 *
 * Approving without an expiry is allowed but not the default suggestion — distribution
 * agreements end, and an authorisation that never expires outlives the paperwork behind it.
 */
function BrandAuthQueue({ onDecided }) {
  const queue = useApiQuery((signal) => api.admin.brandAuth.list({ status: 'pending', pageSize: 50 }, signal), [])
  const [open, setOpen] = useState(null)
  const [validUntil, setValidUntil] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const items = queue.data?.items ?? []
  if (queue.isLoading || items.length === 0) return null

  const decide = async (id, approved) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.admin.brandAuth.decide(id, {
        approved,
        note: note.trim() || null,
        validUntil: approved && validUntil ? validUntil : null,
      })
      setFlash({ tone: 'success', text: result?.message ?? 'Decision recorded.' })
      setOpen(null); setNote(''); setValidUntil('')
      queue.refetch()
      onDecided?.()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  return (
    <section className="marketplace-subpanel">
      <h2>Brand authorisation requests <em>{items.length}</em></h2>
      <Flash value={flash} />

      <div className="marketplace-table-wrap">
        <table className="marketplace-table">
          <thead><tr><th>Brand</th><th>Seller</th><th>Document</th><th>Asked</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.brand.name}</td>
                <td>
                  {item.seller.storeName}
                  <small>{item.seller.verificationLevel?.replace(/_/g, ' ') ?? 'unverified'}</small>
                </td>
                {/* No document is not a refusal on its own, but it is the usual reason for one. */}
                <td>{item.document ? item.document.name : <em>None attached</em>}</td>
                <td>{new Date(item.requestedAt).toLocaleDateString()}</td>
                <td>
                  <button type="button" onClick={() => { setOpen(open === item.id ? null : item.id); setFlash(null) }} disabled={busy}>
                    {open === item.id ? 'Close' : 'Review'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <form className="marketplace-decision" onSubmit={(event) => event.preventDefault()}>
          <label>
            Valid until
            <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            <small>Leave blank only if the brand granted open-ended permission.</small>
          </label>
          <label>
            Note
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} placeholder="The seller sees this — required when refusing" />
          </label>
          <div>
            <button type="button" className="primary" onClick={() => decide(open, true)} disabled={busy}>
              {busy ? 'Saving…' : 'Approve'}
            </button>
            <button type="button" className="marketplace-danger" onClick={() => decide(open, false)} disabled={busy || note.trim().length < 3}>
              Refuse
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function BrandsPage() {
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const query = useApiQuery((signal) => api.admin.brands.list(signal), [])
  const refresh = useCallback(() => { query.refetch() }, [query])

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

  const create = async (event) => {
    event.preventDefault()
    if (await run(() => api.admin.brands.create({ name: name.trim() }), 'Brand created.')) setName('')
  }

  const brands = (query.data ?? []).filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <AdminLayout>
      <div className="marketplace-page">
        <Heading title="Brands" />
        <section className="marketplace-panel">
          <Flash value={flash} />

          <form className="marketplace-inline-form" onSubmit={create}>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New brand name" required minLength={1} maxLength={150} aria-label="New brand name" />
            <button type="submit" className="primary" disabled={busy || !name.trim()}><Icon name="plus" /> Add brand</button>
          </form>

          <BrandAuthQueue onDecided={refresh} />

          <div className="marketplace-filters">
            <label>
              <Icon name="magnifying-glass" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search brands..." aria-label="Search brands" />
            </label>
          </div>

          {query.isLoading && <LoadingState label="Loading brands" />}
          {query.isError && !query.isLoading && (
            <>
              <p className="marketplace-error-note">{describeApiError(query.error)}</p>
              <ErrorState onRetry={query.refetch} />
            </>
          )}

          {!query.isLoading && !query.isError && (brands.length === 0 ? (
            <EmptyState icon="tags" title="No brands" description="Add a brand above; sellers can then assign their products to it." />
          ) : (
            <div className="marketplace-table-wrap">
              <table className="marketplace-table">
                <thead><tr><th>Brand</th><th>Slug</th><th>Products</th><th>Active</th><th>Protected</th><th /></tr></thead>
                <tbody>
                  {brands.map((brand) => (
                    <tr key={brand.slug}>
                      <td>
                        <button type="button" className="table-link" onClick={() => navigateTo(`/brands/${brand.slug}`)}>{brand.name}</button>
                      </td>
                      <td><code>{brand.slug}</code></td>
                      <td>{brand.productCount}</td>
                      <td>
                        <button
                          type="button"
                          className={`marketplace-toggle ${brand.isActive ? 'on' : ''}`}
                          disabled={busy}
                          onClick={() => run(
                            () => api.admin.brands.update(brand.slug, { isActive: !brand.isActive }),
                            `${brand.name} ${brand.isActive ? 'hidden' : 'shown'}.`,
                          )}
                        >
                          {brand.isActive ? 'Active' : 'Hidden'}
                        </button>
                      </td>
                      <td>
                        {/*
                          Gating is per brand rather than marketplace-wide. Requiring an
                          authorisation letter for every brand would stop the catalogue growing
                          for no safety gain, so the control is put only where the risk is —
                          the brands people actually counterfeit.
                        */}
                        <button
                          type="button"
                          className={`marketplace-toggle ${brand.isGated ? 'on' : ''}`}
                          disabled={busy}
                          onClick={() => run(
                            () => api.admin.brandAuth.setGate(brand.slug, { gated: !brand.isGated }),
                            brand.isGated
                              ? `${brand.name} is open to any seller again.`
                              : `${brand.name} now needs authorisation to list against.`,
                          )}
                          title={brand.isGated
                            ? 'Sellers need an approved authorisation to list this brand'
                            : 'Any seller may list this brand'}
                        >
                          {brand.isGated ? 'Protected' : 'Open'}
                        </button>
                        {brand.pendingRequests > 0 && (
                          <small className="marketplace-pending">{brand.pendingRequests} waiting</small>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="marketplace-danger"
                          disabled={busy}
                          onClick={() => {
                            // The API refuses to delete a brand still in use; saying so up front
                            // beats a 409 the admin has to interpret.
                            if (brand.productCount > 0) {
                              setFlash({ tone: 'error', text: `${brand.name} is used by ${brand.productCount} product(s). Reassign them first.` })
                              return
                            }
                            if (!window.confirm(`Delete brand "${brand.name}"?`)) return
                            run(() => api.admin.brands.remove(brand.slug), 'Brand deleted.')
                          }}
                          aria-label={`Delete ${brand.name}`}
                        >
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// Inventory — real quantities, lowest first
// ---------------------------------------------------------------------------

function InventoryPage() {
  const { can } = useAdminSession()
  const [lowOnly, setLowOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  /**
   * Paged rather than capped at a hundred.
   *
   * `pageSize: 100` was a cap wearing a page's clothes: a catalogue with more variants than
   * that simply had rows nobody could reach, and nothing on screen said so.
   */
  const query = useApiQuery(
    (signal) => api.admin.inventory.list(
      { page, pageSize, ...(lowOnly ? { lowOnly: 'true' } : {}), ...(search ? { search } : {}) },
      signal,
    ),
    [lowOnly, search, page, pageSize],
  )
  const refine = (apply) => { apply(); setPage(1) }

  // Adjusting stock is its own permission on the route; without it this is a read-only view.
  const canAdjust = can('inventory.write')

  const adjust = async (row) => {
    const next = window.prompt(`Set stock for ${row.product.name} (${row.sku}).\nCurrently ${row.quantity}, ${row.reserved} reserved.`, String(row.quantity))
    if (next === null) return
    const quantity = Number(next)
    if (!Number.isInteger(quantity) || quantity < 0) {
      setFlash({ tone: 'error', text: 'Enter a whole number of units, zero or more.' })
      return
    }
    setBusy(row.variantId)
    setFlash(null)
    try {
      await api.admin.inventory.update(row.variantId, { quantity })
      setFlash({ tone: 'success', text: `${row.sku} set to ${quantity}.` })
      query.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }

  const items = query.data?.items ?? []

  return (
    <AdminLayout>
      <div className="marketplace-page">
        <Heading title="Inventory" />
        <section className="marketplace-panel">
          <Flash value={flash} />

          <div className="marketplace-filters">
            <label>
              <Icon name="magnifying-glass" />
              <input value={search} onChange={(event) => refine(() => setSearch(event.target.value))} placeholder="Search product or SKU..." aria-label="Search inventory" />
            </label>
            <label className="marketplace-checkbox">
              <input type="checkbox" checked={lowOnly} onChange={(event) => refine(() => setLowOnly(event.target.checked))} />
              Low stock only
            </label>
          </div>

          {query.isLoading && <LoadingState label="Loading inventory" />}
          {query.isError && !query.isLoading && (
            <>
              <p className="marketplace-error-note">{describeApiError(query.error)}</p>
              <ErrorState onRetry={query.refetch} />
            </>
          )}

          {!query.isLoading && !query.isError && (items.length === 0 ? (
            <EmptyState icon="boxes-stacked" title="Nothing to show" description={lowOnly ? 'No variant is below its low-stock threshold.' : 'No stock records match.'} />
          ) : (
            <div className="marketplace-table-wrap">
              <table className="marketplace-table">
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>Store</th><th>On hand</th><th>Reserved</th><th>Available</th><th>State</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.variantId}>
                      <td>
                        {/* A stock row is a question about a listing and about a store; both
                            were dead strings before. */}
                        {row.product.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/products/${row.product.id}`)}>{row.product.name}</button>
                          : row.product.name}
                        <small>{row.variantName}</small>
                      </td>
                      <td><code>{row.sku}</code></td>
                      <td>
                        {row.seller.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${row.seller.id}`)}>{row.seller.name}</button>
                          : row.seller.name}
                      </td>
                      <td>{row.quantity}</td>
                      <td>{row.reserved}</td>
                      <td><strong>{row.available}</strong></td>
                      <td><span className={`marketplace-stock ${row.stockState}`}>{row.stockState.replace(/-/g, ' ')}</span></td>
                      <td>
                        {canAdjust
                          ? (
                            <button type="button" disabled={busy === row.variantId} onClick={() => adjust(row)}>
                              {busy === row.variantId ? '...' : 'Adjust'}
                            </button>
                          )
                          : <span className="marketplace-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                section="marketplace"
                page={query.data?.pagination?.page ?? page}
                pageSize={query.data?.pagination?.pageSize ?? pageSize}
                total={query.data?.pagination?.total ?? 0}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1) }}
              />

            </div>
          ))}
          <p className="marketplace-footnote">
            Exact quantities are admin-only. The storefront shows shoppers in-stock / low-stock and never a count.
          </p>
        </section>
      </div>
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// Product approvals — the queue that could not exist before
// ---------------------------------------------------------------------------

function ApprovalsPage() {
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  const counts = useApiQuery((signal) => api.admin.products.statusCounts(signal), [])
  const queue = useApiQuery((signal) => api.admin.products.list({ status: 'pending_review', pageSize: 50 }, signal), [])
  const refresh = useCallback(() => { queue.refetch(); counts.refetch() }, [queue, counts])

  const decide = async (product, approved) => {
    let reason
    if (!approved) {
      // A rejection with no reason is the top source of seller support tickets, and the API
      // refuses one, so it is collected here rather than sent and bounced.
      reason = window.prompt(`Why is "${product.name}" being rejected?\nThe seller sees this on their listing.`)
      if (!reason?.trim()) return
    }
    setBusy(product.id)
    setFlash(null)
    try {
      const { message } = await api.admin.products.setApproval(product.id, {
        approved, ...(reason ? { reason: reason.trim() } : {}),
      })
      setFlash({ tone: 'success', text: message })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }

  const items = queue.data?.items ?? []

  return (
    <AdminLayout>
      <div className="marketplace-page">
        <Heading title="Product Approvals" />

        {counts.data && (
          <div className="marketplace-kpis">
            {[
              ['Awaiting review', counts.data.pending_review, 'clipboard-check'],
              ['Live', counts.data.active, 'circle-check'],
              ['Rejected', counts.data.rejected, 'circle-xmark'],
              ['Drafts', counts.data.draft, 'pen'],
            ].map(([label, value, icon]) => (
              <article key={label}>
                <span><Icon name={icon} /></span>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        )}

        <section className="marketplace-panel">
          <Flash value={flash} />

          {queue.isLoading && <LoadingState label="Loading the review queue" />}
          {queue.isError && !queue.isLoading && (
            <>
              <p className="marketplace-error-note">{describeApiError(queue.error)}</p>
              <ErrorState onRetry={queue.refetch} />
            </>
          )}

          {!queue.isLoading && !queue.isError && (items.length === 0 ? (
            <EmptyState
              icon="clipboard-check"
              title="Nothing awaiting review"
              description="Listings a seller submits appear here. Approving one publishes it to the storefront immediately."
            />
          ) : (
            <div className="marketplace-approvals">
              {items.map((product) => (
                <article key={product.id} className="approval-card">
                  {product.imageUrl
                    ? <img src={product.imageUrl} alt="" loading="lazy" />
                    : <div className="approval-noimage"><Icon name="image" /></div>}
                  <div className="approval-body">
                    <strong>{product.name}</strong>
                    {product.subtitle && <p>{product.subtitle}</p>}
                    <small>
                      {product.seller?.name} · {product.category?.name} · {product.price?.display}
                      {product.stock != null && ` · ${product.stock} in stock`}
                    </small>
                    {product.description && <p className="approval-description">{product.description}</p>}
                  </div>
                  <div className="approval-actions">
                    <button type="button" className="approve" disabled={busy === product.id} onClick={() => decide(product, true)}>
                      {busy === product.id ? '...' : 'Approve & publish'}
                    </button>
                    <button type="button" className="reject" disabled={busy === product.id} onClick={() => decide(product, false)}>
                      Reject
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}

export default function AdminMarketplacePage({ type = 'brands' }) {
  if (type === 'brands') return <BrandsPage />
  if (type === 'inventory') return <InventoryPage />
  return <ApprovalsPage />
}
