import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import Icon from '@mirwal/shared/Icon'
import { Pagination } from './AdminComponents'
import { LoadingState, ErrorState, EmptyState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import { useAdminSession } from '../AdminSession'
import api from '../api'
import './categories.css'
import './products.css'

/**
 * One category or one brand, with the listings that sit under it.
 *
 * Both lists offered inline create, an active toggle and a delete, and nothing else: a taxonomy
 * row could not be opened, so "what is actually in this category" was a question the panel
 * could not answer, and editing a description or the SEO fields was impossible from anywhere.
 *
 * One component for both because they are the same shape — a named bucket with a slug, a
 * description, an active flag and a set of products — and two near-identical files would be two
 * places to forget the same permission check.
 *
 * There is no `GET /admin/categories/:slug`, and this deliberately does not add one. Both
 * taxonomies are small enough to arrive whole in the list call the page already makes, and an
 * endpoint invented to satisfy a UI pattern is an endpoint to keep in sync forever.
 */

const KINDS = {
  categories: {
    label: 'Category',
    plural: 'Categories',
    read: 'catalog.category.read',
    write: 'catalog.category.write',
    list: (signal) => api.admin.categories.list(signal),
    update: (slug, body) => api.admin.categories.update(slug, body),
    remove: (slug) => api.admin.categories.remove(slug),
    filterKey: 'categoryId',
  },
  brands: {
    label: 'Brand',
    plural: 'Brands',
    read: 'catalog.brand.read',
    write: 'catalog.brand.write',
    list: (signal) => api.admin.brands.list(signal),
    update: (slug, body) => api.admin.brands.update(slug, body),
    remove: (slug) => api.admin.brands.remove(slug),
    filterKey: 'brandId',
  },
}

const FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'description', label: 'Description', textarea: true },
  { key: 'metaTitle', label: 'SEO title' },
  { key: 'metaDescription', label: 'SEO description', textarea: true },
]

export default function AdminTaxonomyDetail({ kind = 'categories' }) {
  const config = KINDS[kind]
  const location = useLocation()
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop())
  const { can } = useAdminSession()

  const all = useApiQuery((signal) => config.list(signal), [kind])
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [page, setPage] = useState(1)

  const record = (all.data ?? []).find((row) => row.slug === slug)

  const products = useApiQuery(
    (signal) => (record
      ? api.admin.products.list({ page, pageSize: 10, [config.filterKey]: record.id }, signal)
      : Promise.resolve(null)),
    [record?.id, page],
  )

  if (all.isLoading) return <AdminLayout><LoadingState label={`Loading ${config.label.toLowerCase()}`} /></AdminLayout>
  if (all.error) {
    return (
      <AdminLayout>
        <p className="products-flash error" role="alert">{describeApiError(all.error)}</p>
        <ErrorState onRetry={all.refetch} />
      </AdminLayout>
    )
  }
  if (!record) {
    return (
      <AdminLayout>
        <div className="categories-page">
          <EmptyState icon="box-open" title={`${config.label} not found`} description={`Nothing on Mirwal uses the slug "${slug}".`} actionLabel={`Back to ${config.plural}`} onAction={() => navigateTo(`/${kind}`)} />
        </div>
      </AdminLayout>
    )
  }

  const editable = can(config.write)
  const dirty = Object.keys(draft).length > 0
  const value = (key) => draft[key] ?? record[key] ?? ''

  const run = async (action, successText, { back = false } = {}) => {
    setBusy(true)
    setFlash(null)
    try {
      await action()
      if (back) { navigateTo(`/${kind}`); return }
      setFlash({ tone: 'success', text: successText })
      setDraft({})
      all.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const productPage = products.data
  const productItems = productPage?.items ?? []

  return (
    <AdminLayout>
      <div className="categories-page">
        <button type="button" className="table-link" onClick={() => navigateTo(`/${kind}`)}>
          <Icon name="chevron-left" /> All {config.plural.toLowerCase()}
        </button>

        <div className="products-heading">
          <div>
            <h1>{record.name}</h1>
            <p>
              <code>{record.slug}</code>
              {record.parent && (
                <> &middot; under <button type="button" className="table-link" onClick={() => navigateTo(`/categories/${record.parent.slug}`)}>{record.parent.name}</button></>
              )}
              &middot; {record.productCount} product{record.productCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="products-heading-actions">
            {editable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(
                  () => config.update(record.slug, { isActive: !record.isActive }),
                  record.isActive ? `${record.name} is hidden from the storefront.` : `${record.name} is visible again.`,
                )}
              >
                <Icon name={record.isActive ? 'eye-slash' : 'eye'} /> {record.isActive ? 'Hide' : 'Show'}
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  // The API refuses to delete a taxonomy still in use; saying so up front beats
                  // a 409 the operator has to interpret.
                  if (record.productCount > 0) {
                    setFlash({ tone: 'error', text: `${record.name} is used by ${record.productCount} product(s). Reassign them first.` })
                    return
                  }
                  if (!window.confirm(`Delete "${record.name}"?`)) return
                  run(() => config.remove(record.slug), '', { back: true })
                }}
              >
                <Icon name="trash" /> Delete
              </button>
            )}
          </div>
        </div>

        {flash && <p className={`products-flash ${flash.tone}`} role="status">{flash.text}</p>}

        <section className="products-panel">
          <h2>Details</h2>
          <form onSubmit={(event) => { event.preventDefault(); run(() => config.update(record.slug, draft), 'Saved.') }}>
            <div className="product-detail-fields">
              {FIELDS.map((field) => (
                <label key={field.key} className={field.textarea ? 'product-detail-wide' : ''}>
                  <span>{field.label}</span>
                  {field.textarea
                    ? (
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={value(field.key)}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        disabled={!editable}
                      />
                    )
                    : (
                      <input
                        value={value(field.key)}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        disabled={!editable}
                        required={field.required}
                      />
                    )}
                </label>
              ))}
            </div>
            {editable
              ? (
                <div className="product-form-actions">
                  <button type="submit" className="primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button>
                  {dirty && <button type="button" onClick={() => setDraft({})} disabled={busy}>Discard</button>}
                </div>
              )
              : <p className="product-readonly">You can view this but not edit it. Editing needs the catalogue-write permission.</p>}
          </form>
        </section>

        <section className="products-panel">
          <h2>Products in this {config.label.toLowerCase()}</h2>
          {products.isLoading && <LoadingState label="Loading products" />}
          {products.error && <p className="products-flash error">{describeApiError(products.error)}</p>}

          {!products.isLoading && !products.error && (productItems.length === 0
            ? <p className="product-readonly">Nothing is listed under this {config.label.toLowerCase()} yet.</p>
            : (
              <>
                <div className="products-table-wrap">
                  <table className="products-table">
                    <thead><tr><th>Product</th><th>Seller</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
                    <tbody>
                      {productItems.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <button type="button" className="table-link" onClick={() => navigateTo(`/products/${product.id}`)}>{product.name}</button>
                          </td>
                          <td>
                            {product.seller
                              ? <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${product.seller.id}`)}>{product.seller.name}</button>
                              : '—'}
                          </td>
                          <td>{product.price.display}</td>
                          <td>{product.stock ?? '—'}</td>
                          <td>{String(product.status).replace(/_/g, ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  section="products"
                  page={productPage.pagination.page}
                  pageSize={productPage.pagination.pageSize}
                  total={productPage.pagination.total}
                  onPage={setPage}
                />
              </>
            ))}
        </section>
      </div>
    </AdminLayout>
  )
}
