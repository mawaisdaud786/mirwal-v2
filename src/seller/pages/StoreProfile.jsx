import { useEffect, useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { navigateTo } from '../../navigation'
import './store-profile.css'
import { products } from '../../data/mockData'

const tabs = [
  { key: 'information', label: 'Store Information' },
  { key: 'branding', label: 'Store Branding' },
  { key: 'business', label: 'Business Information' },
  { key: 'contact', label: 'Contact Information' },
  { key: 'policies', label: 'Store Policies' },
  { key: 'hours', label: 'Store Hours' },
  { key: 'seo', label: 'Store SEO' },
  { key: 'preview', label: 'Store Preview' },
]

const initialProfile = {
  storeName: 'Mirwal Store',
  handle: 'mirwal-store',
  category: 'Electronics',
  subcategory: 'Smart Devices',
  tagline: 'Quality products, happy customers',
  shortDescription: 'Your trusted marketplace for electronics, home essentials and everyday products.',
  fullDescription: 'Mirwal Store brings together carefully selected products, trusted sellers and reliable service. We focus on fast delivery, clear communication and customer-first support.',
  publicUrl: 'https://mirwal.pk/stores/mirwal-store',
  status: 'Active',
}

const initialPolicies = [
  { key: 'return', label: 'Return Policy', enabled: true, updated: 'Jul 10, 2026', content: 'We accept returns within 7 days for unused items in original condition.' },
  { key: 'refund', label: 'Refund Policy', enabled: true, updated: 'Jul 10, 2026', content: 'Refunds are processed within 5–7 business days after approval.' },
  { key: 'cancellation', label: 'Cancellation Policy', enabled: true, updated: 'Jul 08, 2026', content: 'Orders can be cancelled before shipment, or within 2 hours of confirmation.' },
  { key: 'shipping', label: 'Shipping Policy', enabled: true, updated: 'Jul 04, 2026', content: 'Delivery is available across Pakistan with standard, express and pickup options.' },
  { key: 'privacy', label: 'Privacy Policy', enabled: true, updated: 'Jun 29, 2026', content: 'We protect buyer and seller information and use data only for store operations.' },
  { key: 'terms', label: 'Terms & Conditions', enabled: true, updated: 'Jun 21, 2026', content: 'By shopping with us, customers agree to our service and delivery conditions.' },
]

const initialHours = [
  { day: 'Monday', open: true, start: '09:00', end: '18:00' },
  { day: 'Tuesday', open: true, start: '09:00', end: '18:00' },
  { day: 'Wednesday', open: true, start: '09:00', end: '18:00' },
  { day: 'Thursday', open: true, start: '09:00', end: '18:00' },
  { day: 'Friday', open: true, start: '09:00', end: '18:00' },
  { day: 'Saturday', open: true, start: '10:00', end: '17:00' },
  { day: 'Sunday', open: false, start: '09:00', end: '17:00' },
]

const initialSeo = {
  seoTitle: 'Mirwal Store | Electronics & Home Essentials',
  metaDescription: 'Shop trusted electronics, smart devices and home essentials at Mirwal Store with secure checkout and fast delivery across Pakistan.',
  keywords: 'electronics, home appliances, gadgets, pakistan online store',
  socialTitle: 'Mirwal Store',
  socialDescription: 'Shop quality essentials with fast delivery and customer-first support.',
  socialImage: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200&q=80',
}

const statusClassMap = {
  Active: 'success',
  'Vacation Mode': 'warning',
  'Temporarily Closed': 'danger',
  Verified: 'success',
  Pending: 'warning',
  'Needs Attention': 'danger',
  'Not Verified': 'inactive',
  Connected: 'success',
  'Not Connected': 'inactive',
  'Needs attention': 'warning',
}

function StoreProfile({ page = 'information' }) {
  const currentPage = page || 'information'
  const [profile, setProfile] = useState(initialProfile)
  const [policies, setPolicies] = useState(initialPolicies)
  const [hours, setHours] = useState(initialHours)
  const [seo, setSeo] = useState(initialSeo)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) return undefined

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  const completion = useMemo(() => {
    const checks = [
      profile.storeName,
      profile.handle,
      profile.category,
      profile.shortDescription,
      profile.publicUrl,
      profile.status,
    ]
    const completed = checks.filter(Boolean).length
    return Math.round((completed / checks.length) * 100)
  }, [profile])

  const updateProfile = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  const updatePolicy = (key, field, value) => {
    setPolicies((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item))
    setDirty(true)
  }

  const updateHours = (day, field, value) => {
    setHours((current) => current.map((item) => item.day === day ? { ...item, [field]: value } : item))
    setDirty(true)
  }

  const openTab = (key) => {
    navigateTo(`/seller/store/${key}`)
  }

  const saveChanges = (message) => {
    setDirty(false)
    window.alert(message)
  }

  const renderContent = () => {
    switch (currentPage) {
      case 'branding':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Brand Assets</h2>
              </div>
              <div className="upload-grid">
                <div className="upload-card">
                  <label>Store Logo</label>
                  <div className="upload-preview logo-preview" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80)' }} />
                  <div className="upload-actions">
                    <button type="button" className="btn-secondary">Replace</button>
                    <button type="button" className="btn-ghost">Remove</button>
                  </div>
                </div>
                <div className="upload-card">
                  <label>Store Banner</label>
                  <div className="upload-preview banner-preview" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,100,27,0.35), rgba(0,0,0,0.35)), url(https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200&q=80)' }} />
                  <div className="upload-actions">
                    <button type="button" className="btn-secondary">Replace</button>
                    <button type="button" className="btn-ghost">Remove</button>
                  </div>
                </div>
                <div className="upload-card">
                  <label>Store Icon</label>
                  <div className="upload-preview icon-preview">M</div>
                  <div className="upload-actions">
                    <button type="button" className="btn-secondary">Replace</button>
                    <button type="button" className="btn-ghost">Remove</button>
                  </div>
                </div>
              </div>
            </section>

            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Brand Colors</h2>
              </div>
              <div className="color-grid">
                <div className="color-field">
                  <label>Primary</label>
                  <div className="color-row">
                    <span className="color-swatch primary" />
                    <input value="#FF641B" readOnly />
                  </div>
                </div>
                <div className="color-field">
                  <label>Secondary</label>
                  <div className="color-row">
                    <span className="color-swatch secondary" />
                    <input value="#1F2937" readOnly />
                  </div>
                </div>
                <div className="color-field">
                  <label>Accent</label>
                  <div className="color-row">
                    <span className="color-swatch accent" />
                    <input value="#F7A35C" readOnly />
                  </div>
                </div>
              </div>
            </section>

            <section className="store-profile-panel preview-panel">
              <div className="panel-header">
                <h2>Storefront Preview</h2>
              </div>
              <div className="storefront-preview">
                <div className="preview-banner" />
                <div className="preview-header-row">
                  <div className="preview-logo">M</div>
                  <div>
                    <strong>Mirwal Store</strong>
                    <small>Quality products, happy customers</small>
                  </div>
                  <button type="button" className="btn-secondary small">Follow Store</button>
                </div>
                <div className="preview-tabs">
                  <span className="active">Home</span>
                  <span>Products</span>
                  <span>Reviews</span>
                  <span>About</span>
                </div>
              </div>
            </section>
          </div>
        )

      case 'business':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Business Details</h2>
              </div>
              <div className="profile-form-grid">
                <label className="field-block"><span>Legal Business Name</span><input value="Mirwal Store Pvt. Ltd." readOnly /></label>
                <label className="field-block"><span>Business Type</span><input value="Private Limited Company" readOnly /></label>
                <label className="field-block"><span>Registration Number</span><input value="SECP-9283416" readOnly /></label>
                <label className="field-block"><span>NTN / Tax ID</span><input value="NTN-*********" readOnly /></label>
                <label className="field-block"><span>Business Category</span><input value="Retail & E-commerce" readOnly /></label>
              </div>
            </section>

            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Business Address</h2>
              </div>
              <div className="profile-form-grid">
                <label className="field-block full"><span>Address</span><input value="52 Main Gulberg Road" readOnly /></label>
                <label className="field-block"><span>City</span><input value="Lahore" readOnly /></label>
                <label className="field-block"><span>Province</span><input value="Punjab" readOnly /></label>
                <label className="field-block"><span>Postal Code</span><input value="54000" readOnly /></label>
                <label className="field-block"><span>Country</span><input value="Pakistan" readOnly /></label>
              </div>
            </section>

            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Verification Status</h2>
              </div>
              <div className="verification-box">
                <div className="verification-row">
                  <span>Verification Status</span>
                  <span className={`status-badge ${statusClassMap.Verified}`}>Verified</span>
                </div>
                <div className="verification-row">
                  <span>Submitted Date</span>
                  <strong>May 18, 2026</strong>
                </div>
                <div className="verification-row">
                  <span>Documents</span>
                  <strong>NTN, CNIC, Company Registry</strong>
                </div>
                <button type="button" className="btn-primary">Submit for Verification</button>
              </div>
            </section>
          </div>
        )

      case 'contact':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Customer Support</h2>
              </div>
              <div className="profile-form-grid">
                <label className="field-block"><span>Support Email</span><input value="support@mirwalstore.com" readOnly /></label>
                <label className="field-block"><span>Phone</span><input value="+92 300 1234567" readOnly /></label>
                <label className="field-block"><span>WhatsApp</span><input value="+92 300 1234567" readOnly /></label>
                <label className="field-block"><span>Contact Person</span><input value="Ali Ahmed" readOnly /></label>
              </div>
              <div className="toggle-list">
                <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Show email</span></label>
                <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Show phone</span></label>
                <label className="toggle-row"><input type="checkbox" /><span>Show WhatsApp</span></label>
              </div>
            </section>

            <section className="store-profile-panel preview-panel">
              <div className="panel-header">
                <h2>Customer-visible Preview</h2>
              </div>
              <div className="customer-preview-card">
                <strong>Contact this store</strong>
                <div className="customer-preview-row"><i className="fa-solid fa-envelope" /> support@mirwalstore.com</div>
                <div className="customer-preview-row"><i className="fa-solid fa-phone" /> +92 300 1234567</div>
                <button type="button" className="btn-primary">Message Seller</button>
              </div>
            </section>
          </div>
        )

      case 'policies':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel full-width-panel">
              <div className="panel-header">
                <h2>Store Policies</h2>
              </div>
              <div className="policy-list">
                {policies.map((policy) => (
                  <div key={policy.key} className="policy-item">
                    <div className="policy-item-header">
                      <div>
                        <strong>{policy.label}</strong>
                        <small>Last updated: {policy.updated}</small>
                      </div>
                      <label className="switch">
                        <input type="checkbox" checked={policy.enabled} onChange={(event) => updatePolicy(policy.key, 'enabled', event.target.checked)} />
                        <span className="slider" />
                      </label>
                    </div>
                    <textarea value={policy.content} onChange={(event) => updatePolicy(policy.key, 'content', event.target.value)} rows="4" />
                    <div className="policy-preview-box">
                      <span>Customer preview</span>
                      <p>{policy.content}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="action-row">
                <button type="button" className="btn-primary" onClick={() => saveChanges('Store policies saved successfully.')}>Save Policies</button>
              </div>
            </section>
          </div>
        )

      case 'hours':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel full-width-panel">
              <div className="panel-header">
                <h2>Weekly Schedule</h2>
              </div>
              <div className="hours-actions">
                <button type="button" className="btn-secondary">Set all weekdays</button>
                <button type="button" className="btn-secondary">Apply schedule</button>
                <button type="button" className="btn-ghost">Holiday / special closure</button>
              </div>
              <div className="hours-table">
                {hours.map((day) => (
                  <div key={day.day} className="hours-row">
                    <div className="hours-day">{day.day}</div>
                    <label className="toggle-inline"><input type="checkbox" checked={day.open} onChange={(event) => updateHours(day.day, 'open', event.target.checked)} /><span>{day.open ? 'Open' : 'Closed'}</span></label>
                    <label className="field-inline"><span>Opening time</span><input type="time" value={day.start} onChange={(event) => updateHours(day.day, 'start', event.target.value)} /></label>
                    <label className="field-inline"><span>Closing time</span><input type="time" value={day.end} onChange={(event) => updateHours(day.day, 'end', event.target.value)} /></label>
                  </div>
                ))}
              </div>
              <div className="preview-card-inline">
                <strong>Store hours</strong>
                <p>Monday – Friday: 9:00 AM – 6:00 PM</p>
                <p>Saturday: 10:00 AM – 5:00 PM</p>
              </div>
            </section>
          </div>
        )

      case 'seo':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>SEO Settings</h2>
              </div>
              <div className="profile-form-grid">
                <label className="field-block"><span>SEO Title</span><input value={seo.seoTitle} onChange={(event) => setSeo((current) => ({ ...current, seoTitle: event.target.value }))} /><small>{seo.seoTitle.length}/60</small></label>
                <label className="field-block"><span>Meta Description</span><textarea rows="4" value={seo.metaDescription} onChange={(event) => setSeo((current) => ({ ...current, metaDescription: event.target.value }))} /><small>{seo.metaDescription.length}/160</small></label>
                <label className="field-block"><span>Keywords</span><input value={seo.keywords} onChange={(event) => setSeo((current) => ({ ...current, keywords: event.target.value }))} /></label>
                <label className="field-block"><span>Social Title</span><input value={seo.socialTitle} onChange={(event) => setSeo((current) => ({ ...current, socialTitle: event.target.value }))} /></label>
                <label className="field-block"><span>Social Description</span><textarea rows="3" value={seo.socialDescription} onChange={(event) => setSeo((current) => ({ ...current, socialDescription: event.target.value }))} /></label>
                <label className="field-block"><span>Social Image</span><input value={seo.socialImage} onChange={(event) => setSeo((current) => ({ ...current, socialImage: event.target.value }))} /></label>
              </div>
            </section>

            <section className="store-profile-panel preview-panel">
              <div className="panel-header">
                <h2>Preview</h2>
              </div>
              <div className="seo-preview-box">
                <strong>{seo.seoTitle}</strong>
                <small>{profile.publicUrl}</small>
                <p>{seo.metaDescription}</p>
              </div>
              <div className="seo-preview-box social-preview">
                <div className="social-card">
                  <img src={seo.socialImage} alt="Social preview" />
                  <div>
                    <strong>{seo.socialTitle}</strong>
                    <p>{seo.socialDescription}</p>
                  </div>
                </div>
              </div>
              <div className="seo-checklist">
                <h3>SEO checklist</h3>
                <ul>
                  <li>✓ Title is under 60 characters</li>
                  <li>✓ Description includes a key value proposition</li>
                  <li>✓ Keywords are relevant to the storefront</li>
                </ul>
              </div>
              <button type="button" className="btn-primary" onClick={() => saveChanges('SEO settings saved.')}>Save SEO</button>
            </section>
          </div>
        )

      case 'preview':
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel preview-panel full-width-panel">
              <div className="panel-header split-header">
                <h2>Store Preview</h2>
                <div className="panel-actions">
                  <button type="button" className="btn-secondary">Open Public Store</button>
                  <button type="button" className="btn-primary">Edit Store</button>
                </div>
              </div>
              <div className="preview-browser">
                <div className="browser-topbar">
                  <span className="browser-dot orange" />
                  <span className="browser-dot" />
                  <span className="browser-dot" />
                </div>
                <div className="browser-content">
                  <div className="store-preview-banner" />
                  <div className="store-preview-header">
                    <div className="store-preview-logo">M</div>
                    <div>
                      <h3>Mirwal Store</h3>
                      <div className="rating-row"><span>★ 4.8</span><span>Verified</span></div>
                    </div>
                    <div className="preview-actions">
                      <button type="button" className="btn-secondary small">Follow Store</button>
                      <button type="button" className="btn-primary small">Contact Store</button>
                    </div>
                  </div>
                  <div className="preview-tabbar">
                    <span className="active">Home</span>
                    <span>Products</span>
                    <span>Reviews</span>
                    <span>About</span>
                  </div>
                  <div className="preview-main-grid">
                    <div className="preview-products">
                      {products.slice(0, 3).map((product) => (
                        <article key={product.id} className="preview-product-card">
                          <img src={product.image} alt={product.name} />
                          <div>
                            <strong>{product.name}</strong>
                            <small>{product.price}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                    <aside className="preview-about-card">
                      <h4>About</h4>
                      <p>{profile.fullDescription}</p>
                      <ul>
                        <li><strong>Store hours:</strong> Mon–Fri 9 AM – 6 PM</li>
                        <li><strong>Contact:</strong> support@mirwalstore.com</li>
                        <li><strong>Policies:</strong> Return, shipping and privacy policy available</li>
                      </ul>
                    </aside>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )

      case 'information':
      default:
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Store Identity</h2>
              </div>
              <div className="profile-form-grid">
                <label className="field-block"><span>Store Name *</span><input value={profile.storeName} onChange={(event) => updateProfile('storeName', event.target.value)} /></label>
                <label className="field-block"><span>Store Handle / Username *</span><input value={profile.handle} onChange={(event) => updateProfile('handle', event.target.value)} /></label>
                <label className="field-block"><span>Store Category *</span><input value={profile.category} onChange={(event) => updateProfile('category', event.target.value)} /></label>
                <label className="field-block"><span>Store Subcategory</span><input value={profile.subcategory} onChange={(event) => updateProfile('subcategory', event.target.value)} /></label>
                <label className="field-block full"><span>Store Tagline</span><input value={profile.tagline} onChange={(event) => updateProfile('tagline', event.target.value)} /></label>
                <label className="field-block full"><span>Short Description</span><textarea rows="3" value={profile.shortDescription} onChange={(event) => updateProfile('shortDescription', event.target.value)} /></label>
                <label className="field-block full"><span>Full Store Description</span><textarea rows="5" value={profile.fullDescription} onChange={(event) => updateProfile('fullDescription', event.target.value)} /></label>
              </div>
            </section>

            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Store URL</h2>
              </div>
              <div className="profile-form-grid">
                <label className="field-block full"><span>Public Store URL</span><input value={profile.publicUrl} onChange={(event) => updateProfile('publicUrl', event.target.value)} /></label>
              </div>
              <div className="inline-actions">
                <button type="button" className="btn-secondary">Copy URL</button>
                <button type="button" className="btn-ghost">View Store</button>
              </div>
            </section>

            <section className="store-profile-panel">
              <div className="panel-header">
                <h2>Store Status</h2>
              </div>
              <div className="status-options">
                {['Active', 'Vacation Mode', 'Temporarily Closed'].map((state) => (
                  <label key={state} className="status-option">
                    <input type="radio" name="store-status" checked={profile.status === state} onChange={() => updateProfile('status', state)} />
                    <span>{state}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="store-profile-panel full-width-panel">
              <div className="panel-header">
                <h2>Store Completion</h2>
              </div>
              <div className="completion-box">
                <div className="completion-header">
                  <strong>{completion}% Complete</strong>
                  <span className={`status-badge ${completion >= 80 ? 'success' : 'warning'}`}>{completion >= 80 ? 'On track' : 'In progress'}</span>
                </div>
                <div className="progress-bar"><span style={{ width: `${completion}%` }} /></div>
                <ul className="completion-list">
                  <li><span>Business Information</span><em>Completed</em></li>
                  <li><span>Store Logo & Banner</span><em>Completed</em></li>
                  <li><span>Store Policies</span><em>Completed</em></li>
                  <li><span>Social Links</span><em>Pending</em></li>
                </ul>
              </div>
              <div className="action-row">
                <button type="button" className="btn-primary" onClick={() => saveChanges('Store information saved successfully.')}>Save Changes</button>
              </div>
            </section>
          </div>
        )
    }
  }

  return (
    <SellerLayout activeItem="store-profile" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/seller') }, { label: 'Store Profile' }, { label: tabs.find((item) => item.key === currentPage)?.label || 'Store Profile' }]}>
      <div className="store-profile-container">
        <div className="store-profile-header">
          <div>
            <h1>Store Profile</h1>
            <p>Manage your store information and settings to build trust with customers.</p>
          </div>
          <button type="button" className="btn-secondary">View Store</button>
        </div>

        <nav className="store-profile-tabs" aria-label="Store profile sections">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`store-profile-tab ${currentPage === tab.key ? 'active' : ''}`}
              onClick={() => openTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {renderContent()}
      </div>
    </SellerLayout>
  )
}

export default StoreProfile
