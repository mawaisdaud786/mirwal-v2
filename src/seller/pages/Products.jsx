import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { products } from '../../data/sellerMockData'
import './products.css'

const Products = () => {
  const [view, setView] = useState('grid') // 'grid' or 'list'
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')

  // Filter and sort products
  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || product.status.toLowerCase() === statusFilter.toLowerCase()
    return matchesSearch && matchesStatus
  })

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'price-low') return a.price - b.price
    if (sortBy === 'price-high') return b.price - a.price
    if (sortBy === 'stock') return b.stock - a.stock
    return 0
  })

  const handleAddProduct = () => {
    window.history.pushState({}, '', '/seller/products/add')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const handleEditProduct = (productId) => {
    window.history.pushState({}, '', `/seller/products/edit/${productId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <SellerLayout
      activeItem="all-products"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => window.history.pushState({}, '', '/seller') },
        { label: 'Products' },
      ]}
    >
      <div className="products-container">
        {/* Header */}
        <div className="products-header">
          <div className="products-header-left">
            <h1>Products</h1>
            <p>Manage and organize your product catalog.</p>
          </div>
          <button className="btn-add-product" onClick={handleAddProduct}>
            ➕ Add Product
          </button>
        </div>

        {/* Filters */}
        <div className="product-filters">
          <div className="filter-group">
            <label className="filter-label">Search Products</label>
            <input
              type="text"
              className="filter-input"
              placeholder="Search by name, SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">Status</label>
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Out of Stock">Out of Stock</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Category</label>
            <select className="filter-select">
              <option>All Categories</option>
              <option>Electronics</option>
              <option>Bags & Luggage</option>
              <option>Accessories</option>
            </select>
          </div>

          <div className="filter-actions">
            <button
              className="btn-reset"
              onClick={() => {
                setSearchQuery('')
                setStatusFilter('all')
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* View Controls */}
        <div className="product-view-controls">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${view === 'grid' ? 'active' : ''}`}
              onClick={() => setView('grid')}
              title="Grid View"
            >
              ⊞
            </button>
            <button
              className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => setView('list')}
              title="List View"
            >
              ☰
            </button>
          </div>
          <div className="sort-controls">
            <span>Sort by:</span>
            <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">Name</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
              <option value="stock">Stock Level</option>
            </select>
          </div>
        </div>

        {/* Products Grid / List */}
        {view === 'grid' ? (
          <div className="products-grid">
            {sortedProducts.map((product) => (
              <div key={product.id} className="product-grid-item">
                <div className="product-grid-image">
                  {product.image}
                  <div
                    className={`product-grid-badge ${product.status === 'Inactive' ? 'inactive' : product.status === 'Draft' ? 'draft' : ''}`}
                  >
                    {product.status}
                  </div>
                </div>
                <div className="product-grid-content">
                  <h3 className="product-grid-name" title={product.name}>
                    {product.name}
                  </h3>
                  <div className="product-grid-sku">{product.sku}</div>
                  <div className="product-grid-price">Rs. {product.price.toLocaleString()}</div>
                  <div className="product-grid-stock">
                    {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                  </div>
                  <div className="product-grid-actions">
                    <button className="product-action-btn" onClick={() => handleEditProduct(product.id)}>
                      Edit
                    </button>
                    <button className="product-action-btn danger">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="product-list">
            {sortedProducts.map((product) => (
              <div key={product.id} className="product-list-item">
                <div className="product-list-image">{product.image}</div>
                <div className="product-list-info">
                  <div className="product-list-name">{product.name}</div>
                  <div className="product-list-meta">
                    {product.sku} • Rs. {product.price.toLocaleString()} • {product.stock} in stock
                  </div>
                </div>
                <div className="product-list-actions">
                  <button className="product-list-action-btn" onClick={() => handleEditProduct(product.id)}>
                    ✎
                  </button>
                  <button className="product-list-action-btn">👁️</button>
                  <button className="product-list-action-btn">⋮</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SellerLayout>
  )
}

export default Products
