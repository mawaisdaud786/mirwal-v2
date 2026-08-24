import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import './add-product.css'

const AddProduct = ({ editMode = false, productId = null }) => {
  const [formData, setFormData] = useState({
    title: '',
    category: '',
    brand: '',
    shortDescription: '',
    description: '',
    regularPrice: '',
    salePrice: '',
    costPrice: '',
    stockQuantity: '',
    lowStockThreshold: '',
    sku: '',
    barcode: '',
    weight: '',
    dimensions: { length: '', width: '', height: '' },
    status: 'publish',
  })

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleDimensionChange = (dimension, value) => {
    setFormData((prev) => ({
      ...prev,
      dimensions: { ...prev.dimensions, [dimension]: value },
    }))
  }

  const handleSubmit = (status) => {
    const updatedData = { ...formData, status }
    console.log('Submitting product:', updatedData)
    // Handle form submission
  }

  return (
    <SellerLayout
      activeItem={editMode ? 'edit-product' : 'add-product'}
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => window.history.pushState({}, '', '/seller') },
        { label: 'Products', onClick: () => window.history.pushState({}, '', '/seller/products') },
        { label: editMode ? 'Edit Product' : 'Add New Product' },
      ]}
    >
      <div className="add-product-content">
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px', fontFamily: 'var(--font-heading)' }}>
            {editMode ? 'Edit Product' : 'Add New Product'}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0' }}>
            {editMode ? 'Update product information and details.' : 'Add a new product to your store and start selling.'}
          </p>
        </div>

        <div className="add-product-container">
          {/* Main Content */}
          <div>
            {/* Product Information */}
            <div className="form-section">
              <h2 className="form-section-title">Product Information</h2>

              <div className="form-group">
                <label className="form-label">
                  Product Title <span className="form-label-required">*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  name="title"
                  placeholder="Enter product title"
                  value={formData.title}
                  onChange={handleInputChange}
                />
                <div className="form-help">Choose a clear and specific title for your product.</div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Category <span className="form-label-required">*</span>
                  </label>
                  <select className="form-select" name="category" value={formData.category} onChange={handleInputChange}>
                    <option value="">Select category</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Fashion">Fashion</option>
                    <option value="Home">Home & Garden</option>
                    <option value="Sports">Sports & Outdoors</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Brand (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    name="brand"
                    placeholder="Enter brand name"
                    value={formData.brand}
                    onChange={handleInputChange}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Short Description</label>
                <textarea
                  className="form-textarea"
                  name="shortDescription"
                  placeholder="Brief description (will show on product card)"
                  value={formData.shortDescription}
                  onChange={handleInputChange}
                  style={{ minHeight: '60px' }}
                />
                <div className="form-help">0/160 characters. This appears on product listings.</div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Full Description <span className="form-label-required">*</span>
                </label>
                <textarea
                  className="form-textarea"
                  name="description"
                  placeholder="Write detailed description about your product..."
                  value={formData.description}
                  onChange={handleInputChange}
                  style={{ minHeight: '150px' }}
                />
                <div className="form-help">Describe your product in detail. You can add images, tables more.</div>
              </div>
            </div>

            {/* Product Images */}
            <div className="form-section">
              <h2 className="form-section-title">Product Images</h2>
              <div className="image-upload-area">
                <div className="image-upload-icon">⬆️</div>
                <div className="image-upload-text">Drag and drop images here or</div>
                <button className="image-upload-button">Choose Files</button>
                <div className="image-upload-hint">JPG, PNG - Max size 2MB, up to 8 images</div>
              </div>
            </div>

            {/* Pricing */}
            <div className="form-section">
              <h2 className="form-section-title">Pricing</h2>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Regular Price <span className="form-label-required">*</span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    name="regularPrice"
                    placeholder="0"
                    value={formData.regularPrice}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Sale Price (Optional)</label>
                  <input
                    type="number"
                    className="form-input"
                    name="salePrice"
                    placeholder="0"
                    value={formData.salePrice}
                    onChange={handleInputChange}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Cost Price (For your reference)</label>
                <input
                  type="number"
                  className="form-input"
                  name="costPrice"
                  placeholder="0"
                  value={formData.costPrice}
                  onChange={handleInputChange}
                />
                <div className="form-help">Leave empty if product is not on sale</div>
              </div>
            </div>

            {/* Inventory */}
            <div className="form-section">
              <h2 className="form-section-title">Inventory</h2>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Stock Quantity <span className="form-label-required">*</span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    name="stockQuantity"
                    placeholder="0"
                    value={formData.stockQuantity}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Low Stock Threshold</label>
                  <input
                    type="number"
                    className="form-input"
                    name="lowStockThreshold"
                    placeholder="10"
                    value={formData.lowStockThreshold}
                    onChange={handleInputChange}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">SKU (Stock Keeping Unit)</label>
                  <input
                    type="text"
                    className="form-input"
                    name="sku"
                    placeholder="Unique product code"
                    value={formData.sku}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Barcode (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    name="barcode"
                    placeholder="Product barcode"
                    value={formData.barcode}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            </div>

            {/* Shipping */}
            <div className="form-section">
              <h2 className="form-section-title">Shipping</h2>

              <div className="form-group">
                <label className="form-label">Weight</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0"
                    value={formData.weight}
                    onChange={(e) => handleInputChange(e)}
                    style={{ flex: 1 }}
                  />
                  <select className="form-select" style={{ flex: '0 0 60px' }}>
                    <option>kg</option>
                    <option>g</option>
                    <option>lb</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Dimensions (L × W × H)</label>
                <div className="form-row">
                  <input
                    type="number"
                    className="form-input"
                    placeholder="Length"
                    value={formData.dimensions.length}
                    onChange={(e) => handleDimensionChange('length', e.target.value)}
                  />
                  <input
                    type="number"
                    className="form-input"
                    placeholder="Width"
                    value={formData.dimensions.width}
                    onChange={(e) => handleDimensionChange('width', e.target.value)}
                  />
                  <input
                    type="number"
                    className="form-input"
                    placeholder="Height"
                    value={formData.dimensions.height}
                    onChange={(e) => handleDimensionChange('height', e.target.value)}
                  />
                </div>
                <div className="form-help">Scan or enter product barcode</div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="add-product-sidebar">
            {/* Product Status */}
            <div className="sidebar-card">
              <h3 className="sidebar-card-title">📊 Status</h3>
              <div className="sidebar-option">
                <input
                  type="radio"
                  id="publish"
                  name="status"
                  value="publish"
                  checked={formData.status === 'publish'}
                  onChange={handleInputChange}
                />
                <label htmlFor="publish" style={{ flex: 1, cursor: 'pointer' }}>
                  <div className="sidebar-option-label">Publish</div>
                  <div className="sidebar-option-text">Product will be live on your store</div>
                </label>
              </div>
              <div className="sidebar-option">
                <input
                  type="radio"
                  id="draft"
                  name="status"
                  value="draft"
                  checked={formData.status === 'draft'}
                  onChange={handleInputChange}
                />
                <label htmlFor="draft" style={{ flex: 1, cursor: 'pointer' }}>
                  <div className="sidebar-option-label">Draft</div>
                  <div className="sidebar-option-text">Save as draft and publish later</div>
                </label>
              </div>
              <div className="sidebar-option">
                <input
                  type="radio"
                  id="private"
                  name="status"
                  value="private"
                  checked={formData.status === 'private'}
                  onChange={handleInputChange}
                />
                <label htmlFor="private" style={{ flex: 1, cursor: 'pointer' }}>
                  <div className="sidebar-option-label">Private</div>
                  <div className="sidebar-option-text">Only you can view this product</div>
                </label>
              </div>
            </div>

            {/* Quick Links */}
            <div className="sidebar-card">
              <h3 className="sidebar-card-title">🔗 Quick Links</h3>
              <button
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--color-primary-light)',
                  border: '1px solid var(--color-primary)',
                  color: 'var(--color-primary)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  marginBottom: '8px',
                  transition: 'all 180ms ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--color-primary)'
                  e.target.style.color = '#fff'
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--color-primary-light)'
                  e.target.style.color = 'var(--color-primary)'
                }}
              >
                👁️ Preview Product
              </button>
              <button
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'transparent',
                  border: '1px solid var(--color-border-light)',
                  color: 'var(--color-text)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 180ms ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.borderColor = 'var(--color-primary)'
                  e.target.style.color = 'var(--color-primary)'
                }}
                onMouseLeave={(e) => {
                  e.target.style.borderColor = 'var(--color-border-light)'
                  e.target.style.color = 'var(--color-text)'
                }}
              >
                💾 View Drafts
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="form-actions">
        <button className="btn-cancel" onClick={() => window.history.back()}>
          Cancel
        </button>
        <button
          className="btn-draft"
          onClick={() => handleSubmit('draft')}
        >
          💾 Save as Draft
        </button>
        <button
          className="btn-publish"
          onClick={() => handleSubmit('publish')}
        >
          ✓ {editMode ? 'Update Product' : 'Publish Product'}
        </button>
      </div>
    </SellerLayout>
  )
}

export default AddProduct
