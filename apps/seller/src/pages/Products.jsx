import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState, Pagination } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import { useSellerSession } from '../SellerSession'
import api from '../api'
import './products.css'
import { navigateTo } from '@mirwal/shared/navigation'

/**
 * Seller's own product list, from `GET /seller/me/products` (ownership-scoped server-side —
 * this seller can never see another seller's rows).
 *
 * The mock version summarised a catalogue of ~8 fake products as "128 total, 98 published, 12
 * drafts, 5 out of stock, 13 low stock" — numbers with no relationship at all to
 * `filteredProducts.length` sitting right below them — plus a fake "Added on May 10, 2025" per
 * row (computed from array index) and fake view/order counts. All of that is real now, computed
 * from the actual fetched list. Two columns are gone rather than faked: SKU (products don't
 * have one — only variants do, and this list is one row per product) and Views/Orders (no
 * page-view tracking or order aggregation exists yet).
 */

const STATUS_LABEL = { active: 'Published', draft: 'Draft', pending_review: 'Pending Review', rejected: 'Rejected', archived: 'Archived' }
const LOW_STOCK_THRESHOLD = 5
/**
 * The store's catalogue.
 *
 * Paged, filtered and searched by the server now. It used to fetch every listing the store had
 * ever created and filter that array in the browser: a seller with two thousand SKUs downloaded
 * all of them to look at ten, the tab counts described only what had arrived, and there was no
 * way to reach anything past the first fetch.
 *
 * The product name is a link rather than a row of icon buttons off to the right. Opening a
 * listing is what a seller does here nine times out of ten, and burying it behind a pencil icon
 * made the obvious action the hidden one.
 *
 * Delete is gated on `catalog.product.delete`, matching the route: a staff member added to a
 * store with read-and-write but not delete sees no delete button rather than an error.
 */
const Products = () => {
  const { can } = useSellerSession()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState(null)
  const [flash, setFlash] = useState(null)

  // The tab labels map onto real statuses; "drafts" covers both a saved draft and a submission
  // still waiting on Mirwal, because to the seller they are the same thing: not yet selling.
  const statusParam = statusFilter === 'published' ? 'active'
    : statusFilter === 'draft' ? 'draft'
      : statusFilter === 'pending' ? 'pending_review'
        : statusFilter === 'rejected' ? 'rejected'
          : undefined

  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.seller.products(
      { page, pageSize: perPage, ...(statusParam ? { status: statusParam } : {}), ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}) },
      signal,
    ),
    [page, perPage, statusParam, searchQuery],
  )
  const statusCounts = useApiQuery((signal) => api.seller.productStatusCounts(signal), [])

  const products = useMemo(() => data?.items ?? [], [data])
  const pagination = data?.pagination ?? { page, pageSize: perPage, total: 0, totalPages: 1 }
  const counts = statusCounts.data ?? {}

  /**
   * Stock is filtered in the browser, and only the browser.
   *
   * It is derived from `quantity - reserved` across a product's variants, which the list
   * computes rather than stores — there is no column to filter on. Filtering it here means the
   * stock tabs describe the current page and nothing more, so they are labelled without counts
   * rather than showing a number that would be wrong.
   */
  const visible = useMemo(() => products.filter((product) => (
    stockFilter === 'all'
      || (stockFilter === 'out' && product.stock === 0)
      || (stockFilter === 'low' && product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD)
      || (stockFilter === 'in' && product.stock > LOW_STOCK_THRESHOLD)
  )), [products, stockFilter])

  const refine = (apply) => { apply(); setPage(1) }
  const resetFilters = () => refine(() => { setSearchQuery(''); setStatusFilter('all'); setStockFilter('all') })

  const remove = async (product) => {
    if (!window.confirm(`Delete "${product.name}"? Buyers who already ordered it keep their order.`)) return
    setBusyId(product.id)
    setFlash(null)
    try {
      await api.seller.product.remove(product.id)
      setFlash({ tone: 'success', text: `"${product.name}" was removed from your store.` })
      refetch(); statusCounts.refetch()
    } catch (requestError) {
      setFlash({ tone: 'error', text: describeApiError(requestError) })
    } finally { setBusyId(null) }
  }

  return <SellerLayout activeItem="all-products" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Products' }]}>
    <div className="products-container">
      <div className="products-header">
        <div className="products-header-left"><h1>All Products</h1><p>Manage and organize all the products in your store.</p></div>
        <div className="products-header-actions">
          {can('catalog.product.write') && (
            <button type="button" className="btn-add-product" onClick={() => navigateTo('/products/add')}><i className="fa-solid fa-plus" aria-hidden="true" /> Add New Product</button>
          )}
        </div>
      </div>

      <div className="products-summary">
        {[
          ['Total Products', counts.all ?? 0],
          ['Published', counts.active ?? 0],
          ['Awaiting review', counts.pending_review ?? 0],
          ['Drafts', counts.draft ?? 0],
          ['Rejected', counts.rejected ?? 0],
        ].map(([label, value]) => (
          <article key={label}><span>{label}</span><strong>{value}</strong></article>
        ))}
      </div>

      <section className="products-workspace">
        {flash && <p className={`products-flash ${flash.tone}`} role="status">{flash.text}</p>}

        <div className="products-filter-row">
          <label className="products-search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input aria-label="Search products" placeholder="Search products by name or SKU..." value={searchQuery} onChange={(event) => refine(() => setSearchQuery(event.target.value))} />
          </label>
          <select aria-label="Filter by stock" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}>
            <option value="all">All Stock</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
          <button type="button" className="products-reset" onClick={resetFilters}><i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset</button>
        </div>

        <div className="product-tabs">
          {[
            ['all', 'All', counts.all],
            ['published', 'Published', counts.active],
            ['pending', 'Awaiting review', counts.pending_review],
            ['draft', 'Drafts', counts.draft],
            ['rejected', 'Rejected', counts.rejected],
          ].map(([value, label, count]) => (
            <button type="button" className={statusFilter === value ? 'active' : ''} key={value} onClick={() => refine(() => setStatusFilter(value))}>
              {label} ({count ?? 0})
            </button>
          ))}
        </div>

        {isLoading && <LoadingState label="Loading products" />}
        {error && !isLoading && <ErrorState title="We could not load your products" description={describeApiError(error)} onRetry={refetch} />}

        {!isLoading && !error && (visible.length ? (
          <div className="products-table-wrap">
            <table className="products-table">
              <thead><tr>
                <th className="plain-th">Product</th>
                <th className="plain-th">Category</th>
                <th className="plain-th">Price</th>
                <th className="plain-th">Stock</th>
                <th className="plain-th">Status</th>
                <th className="plain-th">Rating</th>
                <th className="plain-th">Actions</th>
              </tr></thead>
              <tbody>
                {visible.map((product) => (
                  <tr key={product.id} className={busyId === product.id ? 'is-busy' : ''}>
                    {/* `data-label` on every cell drives the mobile card layout in products.css
                        (same technique as orders.css) — below the breakpoint each row becomes
                        a card and each cell prints its own label rather than the table
                        overflowing off the side of a phone screen. */}
                    <td className="product-cell" data-label="Product">
                      {product.imageUrl
                        ? <img className="product-thumb" src={product.imageUrl} alt="" />
                        : <span className="product-thumb product-thumb-empty"><i className="fa-solid fa-image" aria-hidden="true" /></span>}
                      {/* Opening the listing is the common action, so it is the name itself. */}
                      <button type="button" className="table-link" onClick={() => navigateTo(`/products/edit/${product.id}`)}>
                        <strong>{product.name}</strong>
                      </button>
                    </td>
                    <td data-label="Category">{product.category ? <em className="product-category">{product.category.name}</em> : '—'}</td>
                    <td data-label="Price">Rs. {Number(product.price.amount).toLocaleString('en-PK')}</td>
                    <td data-label="Stock"><strong>{product.stock}</strong><small className={product.stock === 0 ? 'stock-out' : product.stock <= LOW_STOCK_THRESHOLD ? 'stock-low' : 'stock-in'}>{product.stock === 0 ? 'Out of Stock' : product.stock <= LOW_STOCK_THRESHOLD ? 'Low Stock' : 'In Stock'}</small></td>
                    <td data-label="Status"><em className={`product-status ${product.status}`}>{STATUS_LABEL[product.status] || product.status}</em></td>
                    <td data-label="Rating">{product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : 'No reviews yet'}</td>
                    <td data-label="Actions" className="product-actions-cell">
                      <div className="table-product-actions">
                        {/* Only a live listing has a storefront page to look at. */}
                        {product.status === 'active' && (
                          <button type="button" aria-label={`View ${product.name}`} onClick={() => navigateTo(`/product/${product.slug}`)}><i className="fa-solid fa-eye" aria-hidden="true" /></button>
                        )}
                        {can('catalog.product.write') && (
                          <button type="button" aria-label={`Edit ${product.name}`} onClick={() => navigateTo(`/products/edit/${product.id}`)}><i className="fa-solid fa-pen" aria-hidden="true" /></button>
                        )}
                        {can('catalog.product.delete') && (
                          <button type="button" className="danger" aria-label={`Delete ${product.name}`} disabled={busyId === product.id} onClick={() => remove(product)}><i className="fa-solid fa-trash" aria-hidden="true" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages ?? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}
              perPage={pagination.pageSize}
              total={pagination.total}
              onPageChange={setPage}
              onPerPageChange={(size) => { setPerPage(size); setPage(1) }}
            />
          </div>
        ) : (
          <EmptyState
            icon={<i className="fa-solid fa-box-open" aria-hidden="true" />}
            title="No products found"
            text={pagination.total ? 'No products match your search or filters. Try adjusting them.' : 'You have not added any products yet.'}
            actionLabel={pagination.total ? 'Reset Filters' : 'Add a product'}
            onAction={pagination.total ? resetFilters : () => navigateTo('/products/add')}
          />
        ))}
      </section>
    </div>
  </SellerLayout>
}

export default Products
