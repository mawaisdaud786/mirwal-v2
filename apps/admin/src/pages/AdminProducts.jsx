import { useMemo, useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import Icon from '@mirwal/shared/Icon'
import './products.css'

/**
 * Products was 10 hard-coded rows (borrowing images from the unrelated public `mockData.js`)
 * with invented SKUs, barcodes, sellers, sales counts, ratings and a "May 24, 2025" created
 * date on every row, six KPI cards claiming "84,291 total products" and "2,340 pending
 * approval," and an "Add New Product" form whose Save button just flipped local state to
 * "saved" with nothing behind it.
 *
 * The list below reads the public catalogue (`GET /products`, the same
 * endpoint the public storefront uses) only ever returns `status = 'active'` products — there
 * is no way to see a pending-approval or rejected queue through it, because those states are
 * invisible to every public/admin-facing endpoint that exists. It also deliberately never
 * exposes an exact stock count (see the comment in `catalog.service.js`'s `shapeProduct` — the
 * original mock UI's "Only 8 items left!" was flagged as false urgency in the Phase 0 audit),
 * only in-stock/low-stock/out-of-stock booleans. So this page shows real product names, images,
 * categories, sellers, prices, ratings and publish dates, real stock badges (not fake exact
 * counts), and KPIs that are honestly derivable — total products, and in/low/out-of-stock
 * breakdowns computed from the full real catalog rather than one fabricated page of it. SKU,
 * barcode, sales counts, and a pending/rejected queue are dropped rather than invented.
 * Add New Product is a real form now — `POST /admin/products` exists, and it creates a listing
 * against a chosen seller. Export/Import stay disabled and explained rather than left to
 * silently do nothing.
 */

// The API caps pageSize at 60 (catalog.schemas.js) so a caller can't request the whole
// catalogue in one request. Kept at the cap so the KPIs below stay accurate for as long as
// the real catalog fits in one page; see `haveAll` for the honest fallback once it doesn't.
const PAGE_SIZE = 60

function Status({ inStock, lowStock }) {
  if (!inStock) return <span className="product-status rejected">Out of Stock</span>
  if (lowStock) return <span className="product-status pending-approval">Low Stock</span>
  return <span className="product-status published">In Stock</span>
}

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

const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => Number(a.price.amount) - Number(b.price.amount),
  rating: (a, b) => b.rating.average - a.rating.average,
  published: (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0),
}

function SortHeader({ id, label, sort, onSort }) {
  const active = sort.key === id
  return <th>
    <button type="button" className={`sort-header${active ? ' active' : ''}`} onClick={() => onSort(id)}>
      {label}
      <i className={`fa-solid fa-arrow-${active && sort.dir === 'asc' ? 'up' : 'down'}${active ? '' : ' is-idle'}`} aria-hidden="true" />
    </button>
  </th>
}

function AdminProductsList() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All Stock')
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.products.list({ pageSize: PAGE_SIZE }, signal), [])
  const items = useMemo(() => data?.items ?? [], [data])
  const total = data?.pagination.total ?? 0
  const haveAll = items.length === total

  const toggleSort = (key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const kpis = useMemo(() => {
    if (!haveAll) return [['Total Products', String(total), 'cube', 'orange']]
    const outOfStock = items.filter((p) => !p.availability.inStock).length
    const lowStock = items.filter((p) => p.availability.inStock && p.availability.lowStock).length
    const healthyStock = items.length - outOfStock - lowStock
    return [
      ['Total Products', String(total), 'cube', 'orange'],
      ['Healthy Stock', String(healthyStock), 'circle-check', 'green'],
      ['Low Stock', String(lowStock), 'triangle-exclamation', 'amber'],
      ['Out of Stock', String(outOfStock), 'box-open', 'red'],
    ]
  }, [items, total, haveAll])

  const filtered = useMemo(() => {
    const matched = items.filter((p) => {
      const stockStatus = !p.availability.inStock ? 'Out of Stock' : p.availability.lowStock ? 'Low Stock' : 'In Stock'
      const matchesStatus = status === 'All Stock' || stockStatus === status
      const matchesSearch = `${p.name} ${p.category?.name ?? ''} ${p.seller?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())
      return matchesStatus && matchesSearch
    })
    if (!sort.key) return matched
    const sorted = [...matched].sort(SORTERS[sort.key])
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [items, search, status, sort])

  return (
    <AdminLayout>
      <div className="products-page">
        <div className="products-heading">
          <div>
            <h1>Products</h1>
            <p>Home <Icon name="chevron-right" /> Marketplace <Icon name="chevron-right" /> Products</p>
          </div>
          <div className="products-heading-actions">
            <button type="button" disabled title="There is no admin backend yet"><Icon name="download" /> Export</button>
            <button type="button" disabled title="There is no admin backend yet"><Icon name="upload" /> Import</button>
            <button type="button" className="primary" disabled title="There is no admin backend yet — nowhere to save a new product">
              <Icon name="plus" /> Add New Product
            </button>
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
          <div className="product-filters">
            <label className="product-search">
              <Icon name="magnifying-glass" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by product name, category, or seller..." aria-label="Search products" />
            </label>
            <select aria-label="Filter by stock" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>All Stock</option>
              <option>In Stock</option>
              <option>Low Stock</option>
              <option>Out of Stock</option>
            </select>
            <button type="button" onClick={() => { setSearch(''); setStatus('All Stock') }}><Icon name="rotate-left" /> Reset</button>
          </div>

          {isLoading && <LoadingState label="Loading products" />}
          {error && !isLoading && <ErrorState onRetry={refetch} />}

          {!isLoading && !error && (filtered.length ? (
            <div className="products-table-wrap">
              <table className="products-table">
                <thead>
                  <tr>
                    <SortHeader id="name" label="Product" sort={sort} onSort={toggleSort} />
                    <th className="plain-th">Category</th><th className="plain-th">Seller</th>
                    <SortHeader id="price" label="Price" sort={sort} onSort={toggleSort} />
                    <th className="plain-th">Stock</th>
                    <SortHeader id="rating" label="Rating" sort={sort} onSort={toggleSort} />
                    <SortHeader id="published" label="Published" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td className="product-name">
                        {row.images[0] && <img src={row.images[0].url} alt="" />}
                        <span><strong>{row.name}</strong></span>
                      </td>
                      <td>{row.category?.name ?? '—'}</td>
                      <td>{row.seller?.name ?? '—'}</td>
                      <td><strong>{row.price.display}</strong></td>
                      <td><Status inStock={row.availability.inStock} lowStock={row.availability.lowStock} /></td>
                      <td>{row.rating.count > 0 ? <span className="rating"><Icon name="star" /> {row.rating.average.toFixed(1)}<small>({row.rating.count})</small></span> : '—'}</td>
                      <td>{row.publishedAt ? new Date(row.publishedAt).toLocaleDateString('en-PK') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="box-open" title="No products found" description="No products match your search or filters. Try adjusting them." actionLabel="Reset Filters" onAction={() => { setSearch(''); setStatus('All Stock') }} />
          ))}

          {filtered.length > 0 && <div className="products-footer"><span>Showing {filtered.length} of {total} products{!haveAll ? ' (showing the first ' + PAGE_SIZE + ')' : ''}</span></div>}
        </Panel>
      </div>
    </AdminLayout>
  )
}

export default function AdminProducts({ create = false }) {
  return create ? <ProductForm /> : <AdminProductsList />
}
