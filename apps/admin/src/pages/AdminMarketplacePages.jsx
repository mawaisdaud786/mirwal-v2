import { useCallback, useState } from 'react'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import AdminLayout from './AdminLayout'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
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
                <thead><tr><th>Brand</th><th>Slug</th><th>Products</th><th>Active</th><th /></tr></thead>
                <tbody>
                  {brands.map((brand) => (
                    <tr key={brand.slug}>
                      <td>{brand.name}</td>
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
  const [lowOnly, setLowOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  const query = useApiQuery(
    (signal) => api.admin.inventory.list(
      { pageSize: 100, ...(lowOnly ? { lowOnly: 'true' } : {}), ...(search ? { search } : {}) },
      signal,
    ),
    [lowOnly, search],
  )

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
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product or SKU..." aria-label="Search inventory" />
            </label>
            <label className="marketplace-checkbox">
              <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
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
                      <td>{row.product.name}<small>{row.variantName}</small></td>
                      <td><code>{row.sku}</code></td>
                      <td>{row.seller.name}</td>
                      <td>{row.quantity}</td>
                      <td>{row.reserved}</td>
                      <td><strong>{row.available}</strong></td>
                      <td><span className={`marketplace-stock ${row.stockState}`}>{row.stockState.replace(/-/g, ' ')}</span></td>
                      <td>
                        <button type="button" disabled={busy === row.variantId} onClick={() => adjust(row)}>
                          {busy === row.variantId ? '...' : 'Adjust'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
