import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
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
const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => Number(a.price.amount) - Number(b.price.amount),
  stock: (a, b) => a.stock - b.stock,
  rating: (a, b) => b.rating.average - a.rating.average,
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

const Products = () => {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.seller.products(signal), [])
  const products = useMemo(() => data ?? [], [data])

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const toggleSort = (key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const categories = useMemo(() => [...new Map(products.filter((p) => p.category).map((p) => [p.category.slug, p.category.name])).entries()], [products])

  const counts = useMemo(() => ({
    all: products.length,
    published: products.filter((p) => p.status === 'active').length,
    draft: products.filter((p) => p.status === 'draft' || p.status === 'pending_review').length,
    out: products.filter((p) => p.stock === 0).length,
    low: products.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD).length,
  }), [products])

  const filteredProducts = useMemo(() => {
    const matched = products.filter((product) => {
      const query = searchQuery.toLowerCase()
      const matchesSearch = !query || product.name.toLowerCase().includes(query)
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'published' && product.status === 'active')
        || (statusFilter === 'draft' && (product.status === 'draft' || product.status === 'pending_review'))
      const matchesCategory = categoryFilter === 'all' || product.category?.slug === categoryFilter
      const matchesStock = stockFilter === 'all'
        || (stockFilter === 'out' && product.stock === 0)
        || (stockFilter === 'low' && product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD)
        || (stockFilter === 'in' && product.stock > LOW_STOCK_THRESHOLD)
      return matchesSearch && matchesStatus && matchesCategory && matchesStock
    })
    if (!sort.key) return matched
    const sorted = [...matched].sort(SORTERS[sort.key])
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [products, searchQuery, statusFilter, categoryFilter, stockFilter, sort])
  const resetFilters = () => { setSearchQuery(''); setStatusFilter('all'); setCategoryFilter('all'); setStockFilter('all') }

  return <SellerLayout activeItem="all-products" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Products' }]}>
    <div className="products-container">
      <div className="products-header">
        <div className="products-header-left"><h1>All Products</h1><p>Manage and organize all the products in your store.</p></div>
        <div className="products-header-actions">
          <button type="button" className="btn-add-product" onClick={() => navigateTo('/products/add')}><i className="fa-solid fa-plus" aria-hidden="true" /> Add New Product</button>
        </div>
      </div>

      <div className="products-summary">
        {[['Total Products', counts.all], ['Published', counts.published], ['Drafts', counts.draft], ['Out of Stock', counts.out], ['Low Stock', counts.low]].map(([label, value]) => (
          <article key={label}><span>{label}</span><strong>{value}</strong></article>
        ))}
      </div>

      <section className="products-workspace">
        <div className="products-filter-row">
          <label className="products-search"><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /><input aria-label="Search products" placeholder="Search products by name..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
          <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All Categories</option>
            {categories.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </select>
          <select aria-label="Filter by stock" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}>
            <option value="all">All Stock</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
          <button type="button" className="products-reset" onClick={resetFilters}><i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset</button>
        </div>

        <div className="product-tabs">
          {[['all', 'All', counts.all], ['published', 'Published', counts.published], ['draft', 'Drafts', counts.draft], ['out', 'Out of Stock', counts.out], ['low', 'Low Stock', counts.low]].map(([value, label, count]) => (
            <button type="button" className={statusFilter === value ? 'active' : ''} key={value} onClick={() => setStatusFilter(value)}>{label} ({count})</button>
          ))}
        </div>

        {isLoading && <LoadingState label="Loading products" />}
        {error && !isLoading && <ErrorState title="We could not load your products" description={describeApiError(error)} onRetry={refetch} />}

        {!isLoading && !error && (filteredProducts.length ? (
          <div className="products-table-wrap">
            <table className="products-table">
              <thead><tr>
                <SortHeader id="name" label="Product" sort={sort} onSort={toggleSort} />
                <th className="plain-th">Category</th>
                <SortHeader id="price" label="Price" sort={sort} onSort={toggleSort} />
                <SortHeader id="stock" label="Stock" sort={sort} onSort={toggleSort} />
                <th className="plain-th">Status</th>
                <SortHeader id="rating" label="Rating" sort={sort} onSort={toggleSort} />
                <th className="plain-th">Actions</th>
              </tr></thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.name}</strong></td>
                    <td>{product.category ? <em className="product-category">{product.category.name}</em> : '—'}</td>
                    <td>Rs. {Number(product.price.amount).toLocaleString('en-PK')}</td>
                    <td><strong>{product.stock}</strong><small className={product.stock === 0 ? 'stock-out' : product.stock <= LOW_STOCK_THRESHOLD ? 'stock-low' : 'stock-in'}>{product.stock === 0 ? 'Out of Stock' : product.stock <= LOW_STOCK_THRESHOLD ? 'Low Stock' : 'In Stock'}</small></td>
                    <td><em className={`product-status ${product.status}`}>{STATUS_LABEL[product.status] || product.status}</em></td>
                    <td>{product.rating.count > 0 ? `${product.rating.average.toFixed(1)} (${product.rating.count})` : 'No reviews yet'}</td>
                    <td>
                      <div className="table-product-actions">
                        <button type="button" aria-label={`View ${product.name}`} onClick={() => navigateTo(`/product/${product.slug}`)}><i className="fa-solid fa-eye" aria-hidden="true" /></button>
                        <button type="button" aria-label={`Edit ${product.name}`} onClick={() => navigateTo(`/products/edit/${product.id}`)}><i className="fa-solid fa-pen" aria-hidden="true" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="products-pagination"><span>Showing {filteredProducts.length} of {products.length} products</span></div>
          </div>
        ) : (
          <EmptyState icon={<i className="fa-solid fa-box-open" aria-hidden="true" />} title="No products found" text={products.length ? 'No products match your search or filters. Try adjusting them.' : 'You have not added any products yet.'} actionLabel={products.length ? 'Reset Filters' : 'Add a product'} onAction={products.length ? resetFilters : () => navigateTo('/products/add')} />
        ))}
      </section>
    </div>
  </SellerLayout>
}

export default Products
