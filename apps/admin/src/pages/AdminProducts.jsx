import { useMemo, useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { Pagination, RowActions } from './AdminComponents'
import { useAdminSession } from '../AdminSession'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import Icon from '@mirwal/shared/Icon'
import './products.css'

function Panel({ children }) { return <section className="products-panel">{children}</section> }

/**
 * Add a product on a seller's behalf.
 *
 * The seller is a required choice rather than an optional field: every product belongs to a
 * store, and the API refuses one without it. An admin adding a listing is adding it to
 * somebody's shop, and the form says so instead of leaving that as an afterthought.
 *
 * Categories, brands and sellers are fetched rather than typed. The API matches on slug, and a
 * hand-typed slug that does not exist produces a validation error an admin cannot diagnose.
 */
function ProductForm() {
  const [form, setForm] = useState({
    name: '', sellerSlug: '', categorySlug: '', brandSlug: '',
    price: '', compareAtPrice: '', sku: '', quantity: '0',
    subtitle: '', description: '', condition: 'new', status: 'active', imageUrl: '',
  })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const categories = useApiQuery((signal) => api.categories.list(signal), [])
  const brands = useApiQuery((signal) => api.brands.list(signal), [])
  const sellers = useApiQuery((signal) => api.sellers.list(signal), [])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const created = await api.admin.products.create({
        name: form.name.trim(),
        sellerSlug: form.sellerSlug,
        categorySlug: form.categorySlug,
        price: form.price,
        quantity: Number(form.quantity || 0),
        condition: form.condition,
        status: form.status,
        // Optional fields are omitted rather than sent empty: the schema validates a value
        // that is present, and "" is not a valid slug, URL or price.
        ...(form.brandSlug ? { brandSlug: form.brandSlug } : {}),
        ...(form.compareAtPrice ? { compareAtPrice: form.compareAtPrice } : {}),
        ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
        ...(form.subtitle.trim() ? { subtitle: form.subtitle.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.imageUrl.trim() ? { images: [{ url: form.imageUrl.trim() }] } : {}),
      })
      // Deliberately no redirect: navigating away remounts this component and throws the
      // confirmation out with it, so the admin never learns whether it worked.
      setFlash({ tone: 'success', text: `"${created.name}" was created.`, created: true })
      setForm((current) => ({ ...current, name: '', sku: '', subtitle: '', description: '', imageUrl: '', price: '' }))
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const loading = categories.isLoading || brands.isLoading || sellers.isLoading

  return (
    <AdminLayout>
      <div className="products-page products-form">
        <div className="products-heading">
          <div>
            <h1>Add New Product</h1>
            <p>Home <Icon name="chevron-right" /> Marketplace <Icon name="chevron-right" /> Add Product</p>
          </div>
        </div>
        <Panel>
          {flash && (
            <p className={`product-flash ${flash.tone}`} role="status">
              <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
              {flash.created && <button type="button" onClick={() => navigateTo('/products')}>View all products</button>}
            </p>
          )}

          {loading ? <LoadingState label="Loading categories and sellers" /> : (
            <form className="product-form" onSubmit={submit}>
              <div className="product-form-grid">
                <label className="wide">
                  Product name
                  <input value={form.name} onChange={set('name')} required minLength={2} maxLength={255} />
                </label>

                <label>
                  Seller
                  <small>Every product belongs to a store. Adding one here adds it to theirs.</small>
                  <select value={form.sellerSlug} onChange={set('sellerSlug')} required>
                    <option value="">Choose a seller</option>
                    {(sellers.data ?? []).map((seller) => (
                      <option key={seller.slug} value={seller.slug}>{seller.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Category
                  <select value={form.categorySlug} onChange={set('categorySlug')} required>
                    <option value="">Choose a category</option>
                    {(categories.data ?? []).map((category) => (
                      <option key={category.slug} value={category.slug}>{category.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Brand <small>Optional</small>
                  <select value={form.brandSlug} onChange={set('brandSlug')}>
                    <option value="">No brand</option>
                    {(brands.data ?? []).map((brand) => (
                      <option key={brand.slug} value={brand.slug}>{brand.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Condition
                  <select value={form.condition} onChange={set('condition')}>
                    <option value="new">New</option>
                    <option value="refurbished">Refurbished</option>
                    <option value="used">Used</option>
                  </select>
                </label>

                <label>
                  Price (Rs.)
                  <input value={form.price} onChange={set('price')} required inputMode="decimal" placeholder="2499" />
                </label>

                <label>
                  Compare-at price <small>Optional. Shown struck through.</small>
                  <input value={form.compareAtPrice} onChange={set('compareAtPrice')} inputMode="decimal" />
                </label>

                <label>
                  Stock quantity
                  <input type="number" value={form.quantity} onChange={set('quantity')} min={0} max={1000000} />
                </label>

                <label>
                  SKU <small>Optional. Generated if left empty.</small>
                  <input value={form.sku} onChange={set('sku')} maxLength={80} />
                </label>

                <label>
                  Publish as
                  <select value={form.status} onChange={set('status')}>
                    <option value="active">Active — visible in the storefront</option>
                    <option value="draft">Draft — not visible yet</option>
                  </select>
                </label>

                <label className="wide">
                  Image URL
                  <small>Optional. Mirwal does not host product images, so this must be a URL the image is already served from.</small>
                  <input value={form.imageUrl} onChange={set('imageUrl')} type="url" maxLength={500} placeholder="https://..." />
                </label>

                <label className="wide">
                  Short subtitle <small>Optional</small>
                  <input value={form.subtitle} onChange={set('subtitle')} maxLength={150} />
                </label>

                <label className="wide">
                  Description <small>Optional</small>
                  <textarea value={form.description} onChange={set('description')} rows={5} maxLength={20000} />
                </label>
              </div>

              <div className="product-form-actions">
                <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Create product'}</button>
                <button type="button" onClick={() => navigateTo('/products')}>Cancel</button>
              </div>
            </form>
          )}
        </Panel>
      </div>
    </AdminLayout>
  )
}

/** The statuses a listing can be in, in the order an operator works through them. */
const STATUS_TABS = [
  ['', 'All'],
  ['pending_review', 'Awaiting review'],
  ['active', 'Live'],
  ['draft', 'Drafts'],
  ['rejected', 'Rejected'],
  ['delisted', 'Delisted'],
  ['archived', 'Archived'],
]

const STATUS_TONE = {
  active: 'published', pending_review: 'pending-approval', draft: 'pending-approval',
  rejected: 'rejected', delisted: 'rejected', archived: 'rejected',
}

function ListingStatus({ value }) {
  return <span className={`product-status ${STATUS_TONE[value] ?? ''}`}>{String(value).replace(/_/g, ' ')}</span>
}

function AdminProductsList() {
  const { can } = useAdminSession()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [busyId, setBusyId] = useState(null)
  const [flash, setFlash] = useState(null)

  /**
   * Filtering, sorting and paging all happen on the server.
   *
   * The page used to pull one capped page of 60 and filter it in the browser, so the search box
   * only ever searched whatever happened to be inside that page — a product outside it simply
   * did not exist as far as the operator could tell, and there was no way to reach page two.
   */
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.admin.products.list(
      {
        page, pageSize, sort,
        ...(status ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      },
      signal,
    ),
    [status, sort, search, page, pageSize],
  )
  const counts = useApiQuery((signal) => api.admin.products.statusCounts(signal), [])

  const items = useMemo(() => data?.items ?? [], [data])
  const pagination = data?.pagination ?? { page, pageSize, total: 0 }

  // Any change to what is being listed sends the reader back to the first page; staying on
  // page 7 of a result set that now has two pages shows an empty table and looks broken.
  const refine = (apply) => { apply(); setPage(1) }

  const run = async (id, action, successText) => {
    setBusyId(id)
    setFlash(null)
    try {
      await action()
      setFlash({ tone: 'success', text: successText })
      refetch(); counts.refetch()
    } catch (actionError) {
      setFlash({ tone: 'error', text: describeApiError(actionError) })
    } finally { setBusyId(null) }
  }

  const byStatus = counts.data ?? {}
  const kpis = [
    // The endpoint calls the grand total `all`; `total` is not a key it returns.
    ['Total listings', String(byStatus.all ?? pagination.total), 'cube', 'orange'],
    ['Awaiting review', String(byStatus.pending_review ?? 0), 'clock', 'amber'],
    ['Live', String(byStatus.active ?? 0), 'circle-check', 'green'],
    ['Rejected', String(byStatus.rejected ?? 0), 'circle-xmark', 'red'],
  ]

  return (
    <AdminLayout>
      <div className="products-page">
        <div className="products-heading">
          <div>
            <h1>Products</h1>
            <p>Home <Icon name="chevron-right" /> Marketplace <Icon name="chevron-right" /> Products</p>
          </div>
          <div className="products-heading-actions">
            <button type="button" disabled title="Bulk import and export are Phase C (C6)"><Icon name="download" /> Export</button>
            <button type="button" disabled title="Bulk import and export are Phase C (C6)"><Icon name="upload" /> Import</button>
            {/* This was disabled saying there was no backend. `POST /admin/products` has
                existed for some time, and the form behind /products/new already uses it. */}
            {can('catalog.product.write') && (
              <button type="button" className="primary" onClick={() => navigateTo('/products/new')}>
                <Icon name="plus" /> Add New Product
              </button>
            )}
          </div>
        </div>

        <div className="product-kpis">
          {kpis.map(([label, value, icon, tone]) => (
            <article className={`product-kpi ${tone}`} key={label}>
              <span><Icon name={icon} /></span>
              <small>{label}</small>
              <strong>{value}</strong>
            </article>
          ))}
        </div>

        <Panel>
          {flash && <p className={`products-flash ${flash.tone}`} role="status">{flash.text}</p>}

          <nav className="product-status-tabs">
            {STATUS_TABS.map(([value, label]) => (
              <button
                type="button"
                key={value || 'all'}
                className={status === value ? 'active' : ''}
                onClick={() => refine(() => setStatus(value))}
              >
                {label}
                {value && byStatus[value] > 0 && <em>{byStatus[value]}</em>}
              </button>
            ))}
          </nav>

          <div className="product-filters">
            <label className="product-search">
              <Icon name="magnifying-glass" />
              <input
                value={search}
                onChange={(event) => refine(() => setSearch(event.target.value))}
                placeholder="Search by product name or SKU..."
                aria-label="Search products"
              />
            </label>
            <select aria-label="Sort" value={sort} onChange={(event) => refine(() => setSort(event.target.value))}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name</option>
              <option value="price-high">Price, high to low</option>
              <option value="price-low">Price, low to high</option>
              {/* A queue sorted by arrival starves the listing most worth opening first. */}
              <option value="risk">Screening risk</option>
            </select>
            <button type="button" onClick={() => refine(() => { setSearch(''); setStatus(''); setSort('newest') })}>
              <Icon name="rotate-left" /> Reset
            </button>
          </div>

          {isLoading && <LoadingState label="Loading products" />}
          {error && !isLoading && <ErrorState onRetry={refetch} />}

          {!isLoading && !error && (items.length ? (
            <>
              <div className="products-table-wrap">
                <table className="products-table">
                  <thead>
                    <tr>
                      <th className="plain-th">Product</th>
                      <th className="plain-th">Category</th><th className="plain-th">Seller</th>
                      <th className="plain-th">Price</th>
                      <th className="plain-th">Stock</th>
                      <th className="plain-th">Status</th>
                      <th className="plain-th">Risk</th>
                      <th className="plain-th" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className={busyId === row.id ? 'is-busy' : ''}>
                        <td className="product-name">
                          {row.imageUrl && <img src={row.imageUrl} alt="" />}
                          {/* Three doors on one row: the listing, its taxonomy and its store. */}
                          <button type="button" className="table-link" onClick={() => navigateTo(`/products/${row.id}`)}>
                            <strong>{row.name}</strong>
                          </button>
                        </td>
                        <td>
                          {row.category
                            ? <button type="button" className="table-link" onClick={() => navigateTo(`/categories/${row.category.slug}`)}>{row.category.name}</button>
                            : '—'}
                        </td>
                        <td>
                          {row.seller
                            ? <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${row.seller.id}`)}>{row.seller.name}</button>
                            : '—'}
                        </td>
                        <td><strong>{row.price.display}</strong></td>
                        <td>{row.stock == null ? '—' : row.stock}</td>
                        <td><ListingStatus value={row.status} /></td>
                        <td>
                          {row.moderationRisk > 0
                            ? <span className={`product-risk ${row.moderationRisk >= 60 ? 'high' : row.moderationRisk >= 30 ? 'medium' : 'low'}`}>{row.moderationRisk}</span>
                            : '—'}
                        </td>
                        <td>
                          <RowActions
                            label={row.name}
                            actions={[
                              { label: 'Open', icon: 'arrow-right', onClick: () => navigateTo(`/products/${row.id}`) },
                              can('catalog.product.approve') && row.status === 'pending_review' && {
                                label: 'Approve', icon: 'circle-check',
                                onClick: () => run(row.id, () => api.admin.products.setApproval(row.id, { approved: true }), `"${row.name}" is live.`),
                              },
                              can('catalog.product.write') && row.status === 'active' && {
                                label: 'Delist', icon: 'eye-slash',
                                onClick: () => run(row.id, () => api.admin.products.setStatus(row.id, 'delisted'), `"${row.name}" was delisted.`),
                              },
                              can('catalog.product.delete') && {
                                label: 'Delete', icon: 'trash', danger: true,
                                confirm: `Delete "${row.name}"? This cannot be undone from here.`,
                                onClick: () => run(row.id, () => api.admin.products.remove(row.id), `"${row.name}" was deleted.`),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                section="products"
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1) }}
              />
            </>
          ) : (
            <EmptyState
              icon="box-open"
              title="No products found"
              description={status ? 'Nothing is in this state right now.' : 'No products match your search. Try adjusting it.'}
              actionLabel="Reset filters"
              onAction={() => refine(() => { setSearch(''); setStatus('') })}
            />
          ))}
        </Panel>
      </div>
    </AdminLayout>
  )
}

export default function AdminProducts({ create = false }) {
  return create ? <ProductForm /> : <AdminProductsList />
}
