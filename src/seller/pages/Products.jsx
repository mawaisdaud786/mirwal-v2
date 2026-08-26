import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { products } from '../../data/sellerMockData'
import './products.css'
import { navigateTo } from '../../navigation'

const extraProducts = [
  { id: 'prod-005', name: 'iPhone 15 Pro Case', sku: 'MW-PC-005', category: 'Mobile Accessories', price: 799, stock: 55, status: 'Active', views: 1102, orders: 72, imageIcon: 'mobile-screen-button' },
  { id: 'prod-006', name: 'LED Desk Lamp', sku: 'MW-DL-006', category: 'Home & Living', price: 1799, stock: 8, status: 'Draft', views: 210, orders: 10, imageIcon: 'lightbulb' },
  { id: 'prod-007', name: 'Wooden Desk Organizer', sku: 'MW-DO-007', category: 'Home & Living', price: 1299, stock: 0, status: 'Active', views: 321, orders: 18, imageIcon: 'box' },
  { id: 'prod-008', name: 'Ergonomic Wireless Mouse', sku: 'MW-ME-008', category: 'Electronics', price: 1299, stock: 22, status: 'Draft', views: 145, orders: 6, imageIcon: 'computer-mouse' },
]

const iconByProduct = ['headphones', 'stopwatch', 'shoe-prints', 'briefcase']

const Products = () => {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const catalog = useMemo(() => products.map((product, index) => ({ ...product, sku: ['MW-HP-001', 'MW-SW-002', 'MW-RS-003', 'MW-BG-004'][index], views: [1245, 2340, 987, 654][index], orders: [86, 124, 56, 34][index], imageIcon: iconByProduct[index] })).concat(extraProducts), [])
  const filteredProducts = catalog.filter((product) => {
    const query = searchQuery.toLowerCase()
    const matchesSearch = product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query)
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'published' && product.status === 'Active') || product.status.toLowerCase() === statusFilter
    const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter
    const matchesStock = stockFilter === 'all' || (stockFilter === 'out' && product.stock === 0) || (stockFilter === 'low' && product.stock > 0 && product.stock < 15) || (stockFilter === 'in' && product.stock >= 15)
    return matchesSearch && matchesStatus && matchesCategory && matchesStock
  })
  const resetFilters = () => { setSearchQuery(''); setStatusFilter('all'); setCategoryFilter('all'); setStockFilter('all') }

  return <SellerLayout activeItem="all-products" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/seller') }, { label: 'Products' }]}>
    <div className="products-container">
      <div className="products-header"><div className="products-header-left"><h1>All Products</h1><p>Manage and organize all the products in your store.</p></div><div className="products-header-actions"><button type="button" className="products-secondary-action"><i className="fa-solid fa-upload" aria-hidden="true" /> Export</button><button type="button" className="products-secondary-action"><i className="fa-solid fa-download" aria-hidden="true" /> Import</button><button type="button" className="btn-add-product" onClick={() => navigateTo('/seller/products/add')}><i className="fa-solid fa-plus" aria-hidden="true" /> Add New Product</button></div></div>
      <div className="products-summary">{[['Total Products', '128'], ['Published', '98'], ['Drafts', '12'], ['Out of Stock', '5'], ['Low Stock', '13']].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong><button type="button">View all</button></article>)}</div>
      <section className="products-workspace">
        <div className="products-filter-row"><label className="products-search"><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /><input aria-label="Search products" placeholder="Search products by name, SKU..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All Status</option><option value="published">Published</option><option value="draft">Drafts</option></select><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All Categories</option><option>Electronics</option><option>Bags & Luggage</option><option>Accessories</option><option>Home & Living</option><option>Mobile Accessories</option></select><select aria-label="Filter by brand"><option>All Brands</option></select><select aria-label="Filter by stock" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}><option value="all">All Stock</option><option value="in">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option></select><button type="button" className="products-filter-button"><i className="fa-solid fa-filter" aria-hidden="true" /> Filters</button><button type="button" className="products-reset" onClick={resetFilters}><i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset</button></div>
        <div className="product-tabs">{[['all', 'All', 128], ['published', 'Published', 98], ['draft', 'Drafts', 12], ['out', 'Out of Stock', 5], ['low', 'Low Stock', 13]].map(([value, label, count]) => <button type="button" className={statusFilter === value ? 'active' : ''} key={value} onClick={() => setStatusFilter(value)}>{label} ({count})</button>)}</div>
        <div className="products-table-wrap"><table className="products-table"><thead><tr><th><input type="checkbox" aria-label="Select all products" /></th><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Views</th><th>Orders</th><th>Actions</th></tr></thead><tbody>{filteredProducts.map((product, index) => <tr key={product.id}><td><input type="checkbox" aria-label={`Select ${product.name}`} /></td><td><div className="table-product"><span><i className={`fa-solid fa-${product.imageIcon || iconByProduct[index]}`} aria-hidden="true" /></span><div><strong>{product.name}</strong><small>Added on May {10 - index}, 2025</small></div></div></td><td>{product.sku}</td><td><em className="product-category">{product.category}</em></td><td>Rs. {product.price.toLocaleString()}</td><td><strong>{product.stock}</strong><small className={product.stock === 0 ? 'stock-out' : product.stock < 15 ? 'stock-low' : 'stock-in'}>{product.stock === 0 ? 'Out of Stock' : product.stock < 15 ? 'Low Stock' : 'In Stock'}</small></td><td><em className={`product-status ${product.status.toLowerCase()}`}>{product.status === 'Active' ? 'Published' : product.status}</em></td><td>{product.views.toLocaleString()}</td><td>{product.orders}</td><td><div className="table-product-actions"><button type="button" aria-label={`View ${product.name}`}><i className="fa-solid fa-eye" aria-hidden="true" /></button><button type="button" aria-label={`Edit ${product.name}`} onClick={() => navigateTo(`/seller/products/edit/${product.id}`)}><i className="fa-solid fa-pen" aria-hidden="true" /></button><button type="button" aria-label={`More actions for ${product.name}`}><i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" /></button></div></td></tr>)}</tbody></table></div>
        <div className="products-pagination"><span>Showing 1 to {filteredProducts.length} of 128 results</span><div><button type="button" disabled><i className="fa-solid fa-chevron-left" aria-hidden="true" /></button><button type="button" className="active">1</button><button type="button">2</button><button type="button">3</button><span>...</span><button type="button">16</button><button type="button"><i className="fa-solid fa-chevron-right" aria-hidden="true" /></button></div><label>Show <select aria-label="Results per page"><option>10</option></select> per page</label></div>
      </section>
    </div>
  </SellerLayout>
}

export default Products
