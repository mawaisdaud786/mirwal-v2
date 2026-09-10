import { useEffect, useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import './store-profile.css'

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
  const { data: store, refetch: refetchStore } = useApiQuery((signal) => api.seller.store(signal), [])
  const { data: sellerProducts } = useApiQuery((signal) => api.seller.products({ pageSize: 100 }, signal), [])
  const items = sellerProducts?.items ?? []
  const rated = items.filter((p) => p.rating.count > 0)
  const totalReviews = rated.reduce((sum, p) => sum + p.rating.count, 0)
  const avgRating = rated.length ? (rated.reduce((sum, p) => sum + p.rating.average * p.rating.count, 0) / totalReviews).toFixed(1) : null

  const [draft, setDraft] = useState({})
  const policiesQuery = useApiQuery((signal) => api.seller.policies.get(signal), [])
  /**
   * The saved policies, with the seller's unsaved edits layered on top.
   *
   * Same pattern as the profile draft above: no effect syncing fetched data into state, which
   * would need a setState-on-load and re-render cascade. Reading through to the query result
   * means the form shows real values the moment they arrive.
   */
  const [policyDraft, setPolicyDraft] = useState({})
  const policyForm = {
    returnsAccepted: policiesQuery.data?.returnsAccepted ?? true,
    returnWindowDays: policiesQuery.data?.returnWindowDays ?? null,
    returnShippingPaidBy: policiesQuery.data?.returnShippingPaidBy ?? 'buyer',
    exchangeOffered: policiesQuery.data?.exchangeOffered ?? false,
    dispatchDays: policiesQuery.data?.dispatchDays ?? null,
    returnsText: policiesQuery.data?.returnsText ?? '',
    shippingText: policiesQuery.data?.shippingText ?? '',
    warrantyText: policiesQuery.data?.warrantyText ?? '',
    ...policyDraft,
  }
  const updatePolicy = (field, value) => {
    setPolicyDraft((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }
  const [hours, setHours] = useState(initialHours)
  const [seo, setSeo] = useState(initialSeo)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(null)

  // The editable draft starts empty and falls back to the real store record for display —
  // once the seller edits a field, their draft value takes over from there. This avoids
  // syncing the fetched store into local state via an effect (which would need a synchronous
  // setState-on-load, a cascading-render anti-pattern) while still seeding real values instead
  // of the hard-coded "Mirwal Store" / "mirwal-store" every seller used to see regardless of
  // who they were.
  const profile = {
    ...initialProfile,
    ...draft,
    storeName: draft.storeName ?? store?.name ?? initialProfile.storeName,
    shortDescription: draft.shortDescription ?? store?.description ?? initialProfile.shortDescription,
    about: draft.about ?? store?.about ?? initialProfile.about,
    supportEmail: draft.supportEmail ?? store?.support?.email ?? initialProfile.supportEmail,
    supportPhone: draft.supportPhone ?? store?.support?.phone ?? initialProfile.supportPhone,
    addressLine1: draft.addressLine1 ?? store?.address?.line1 ?? initialProfile.addressLine1,
    addressLine2: draft.addressLine2 ?? store?.address?.line2 ?? initialProfile.addressLine2,
    city: draft.city ?? store?.address?.city ?? initialProfile.city,
    province: draft.province ?? store?.address?.province ?? initialProfile.province,
    postalCode: draft.postalCode ?? store?.address?.postalCode ?? initialProfile.postalCode,
    logoUrl: draft.logoUrl ?? store?.logoUrl ?? null,
    bannerUrl: draft.bannerUrl ?? store?.bannerUrl ?? null,
    handle: draft.handle ?? store?.slug ?? initialProfile.handle,
    status: draft.status ?? store?.status ?? initialProfile.status,
    publicUrl: draft.publicUrl ?? (store?.slug ? `${window.location.origin}/seller/${store.slug}` : initialProfile.publicUrl),
  }

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
  }, [profile.storeName, profile.handle, profile.category, profile.shortDescription, profile.publicUrl, profile.status])

  const updateProfile = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  const updateHours = (day, field, value) => {
    setHours((current) => current.map((item) => item.day === day ? { ...item, [field]: value } : item))
    // Distinguishes "the seller edited hours" from "the form rendered its defaults", so
    // opening the tab and saving cannot overwrite stored hours with placeholder values.
    setDraft((current) => ({ ...current, hoursTouched: true }))
    setDirty(true)
  }

  const openTab = (key) => {
    navigateTo(`/store/${key}`)
  }

  /**
   * Save.
   *
   * `PATCH /seller/me/store` is a partial update: only the keys sent are written, so saving
   * the SEO tab cannot blank out the contact tab. Each tab therefore sends its own fields
   * rather than the whole draft.
   *
   * Two fields on this form are deliberately not sent, because the API refuses them:
   *
   *   * the storefront handle — a public URL that buyers bookmark and search engines index,
   *     so renaming it is an admin action with a redirect, not a form field;
   *   * legal name and business type — those were checked against documents, and letting a
   *     seller edit them afterwards would make the verified badge meaningless.
   *
   * Renaming the store *is* allowed, and drops the verified badge until Mirwal has looked at
   * the new name. The server says so in its response, and that message is surfaced rather
   * than swallowed — losing a badge silently would read as a bug or a punishment.
   */
  const savePolicies = async () => {
    setSaving(true)
    setFlash(null)
    try {
      const result = await api.seller.policies.update(policyForm)
      setDirty(false)
      setPolicyDraft({})
      // The server's own notice when a return window shorter than Mirwal's minimum was raised —
      // surfaced rather than swallowed, so the seller is not surprised by what buyers see.
      setFlash({ tone: result?.data?.notice ? 'info' : 'success', text: result?.message ?? 'Policies saved.' })
      policiesQuery.refetch()
    } catch (saveError) {
      setFlash({ tone: 'error', text: describeApiError(saveError) })
    } finally {
      setSaving(false)
    }
  }

  const saveChanges = async (section = currentPage) => {
    setSaving(true)
    setFlash(null)
    try {
      const patch = buildPatch(section)
      if (!Object.keys(patch).length) {
        setFlash({ tone: 'info', text: 'Nothing has changed.' })
        return
      }
      const result = await api.seller.updateStore(patch)
      setDirty(false)
      setFlash({ tone: 'success', text: result?.message ?? 'Store updated.' })
      refetchStore()
    } catch (saveError) {
      setFlash({ tone: 'error', text: describeApiError(saveError) })
    } finally {
      setSaving(false)
    }
  }

  /** Only the fields belonging to the tab being saved, and only those the API accepts. */
  const buildPatch = (section) => {
    const patch = {}
    const put = (key, value) => { if (value !== undefined) patch[key] = value }

    if (section === 'seo') {
      put('metaTitle', seo.metaTitle)
      put('metaDescription', seo.metaDescription)
      return patch
    }
    if (section === 'branding') {
      put('logoUrl', draft.logoUrl)
      put('bannerUrl', draft.bannerUrl)
      return patch
    }
    if (section === 'contact') {
      put('supportEmail', draft.supportEmail)
      put('supportPhone', draft.supportPhone)
      put('addressLine1', draft.addressLine1)
      put('addressLine2', draft.addressLine2)
      put('city', draft.city)
      put('province', draft.province)
      put('postalCode', draft.postalCode)
      return patch
    }
    if (section === 'hours') {
      // Only sent when the seller actually edited them, so opening the tab and saving does
      // not overwrite stored hours with the form's defaults.
      if (draft.hoursTouched) {
        patch.businessHours = Object.fromEntries(
          hours.map((entry) => [entry.day, entry.open ? `${entry.start} - ${entry.end}` : 'Closed']),
        )
      }
      return patch
    }
    // information / business / preview all edit the store's own description fields.
    put('name', draft.storeName)
    put('description', draft.shortDescription)
    put('about', draft.about)
    return patch
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
                  <div className="preview-logo">{(store?.name || profile.storeName || '?').charAt(0).toUpperCase()}</div>
                  <div>
                    <strong>{store?.name || profile.storeName}</strong>
                    <small>{profile.tagline}</small>
                  </div>
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

      case 'hours':
        /*
          The tab existed in the nav with no screen behind it, so `updateHours` was orphaned
          and `businessHours` — a column added for exactly this — was never written.

          Stored as a weekday-keyed map of free text ("09:00 - 18:00", "Closed"). Free text
          because these are read by a person deciding whether to message the seller, never
          computed against: a marketplace does not close at 6pm, and pretending the field is
          structured would invite code that treats it as if it were.
        */
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel full-width-panel">
              <div className="panel-header">
                <h2>Store hours</h2>
                <p className="panel-note">Shown on your store page so buyers know when to expect a reply. Orders arrive at any hour.</p>
              </div>
              <div className="hours-list">
                {hours.map((entry) => (
                  <div className="hours-row" key={entry.day}>
                    <label className="hours-day">
                      <input
                        type="checkbox"
                        checked={entry.open}
                        onChange={(event) => updateHours(entry.day, 'open', event.target.checked)}
                      />
                      <span>{entry.day}</span>
                    </label>
                    {entry.open ? (
                      <div className="hours-times">
                        <input type="time" value={entry.start} onChange={(event) => updateHours(entry.day, 'start', event.target.value)} />
                        <span>to</span>
                        <input type="time" value={entry.end} onChange={(event) => updateHours(entry.day, 'end', event.target.value)} />
                      </div>
                    ) : <span className="hours-closed">Closed</span>}
                  </div>
                ))}
              </div>
              <div className="panel-actions">
                <button type="button" className="btn-primary" onClick={() => saveChanges('hours')} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Hours'}
                </button>
              </div>
            </section>
          </div>
        )

      case 'policies':
        /*
          These used to be six free-text blocks — return, refund, cancellation, shipping,
          privacy, terms — none of which was stored and none of which anything acted on.

          What replaced them is what `store_policies` actually models: the promises Mirwal can
          *enforce*. A return window is checked when a buyer files a return and quoted back in a
          dispute; a dispatch promise is measured against when the parcel was handed over. A
          paragraph headed "Cancellation Policy" is neither.

          The free text that remains explains those rules rather than substituting for them.
        */
        return (
          <div className="store-profile-grid">
            <section className="store-profile-panel full-width-panel">
              <div className="panel-header">
                <h2>Returns &amp; delivery promises</h2>
                <p className="panel-note">These appear on your product pages and are what buyers are held to.</p>
              </div>

              {policiesQuery.isLoading ? <p className="panel-note">Loading…</p> : (
                <div className="policy-fields">
                  <label className="policy-toggle">
                    <input
                      type="checkbox"
                      checked={policyForm.returnsAccepted}
                      onChange={(event) => updatePolicy('returnsAccepted', event.target.checked)}
                    />
                    <span>
                      <b>Accept returns</b>
                      <small>Turning this off does not remove Mirwal&rsquo;s own buyer protection on faulty or wrong items.</small>
                    </span>
                  </label>

                  <label className="policy-field">
                    <span>Return window (days)</span>
                    <input
                      type="number"
                      min={policiesQuery.data?.defaults?.returnWindowDays ?? 0}
                      max={365}
                      value={policyForm.returnWindowDays ?? ''}
                      placeholder={`Mirwal default: ${policiesQuery.data?.defaults?.returnWindowDays ?? 7}`}
                      onChange={(event) => updatePolicy('returnWindowDays', event.target.value === '' ? null : Number(event.target.value))}
                    />
                    <small>
                      Leave blank to use Mirwal&rsquo;s {policiesQuery.data?.defaults?.returnWindowDays ?? 7} days. You can offer
                      longer, not shorter.
                    </small>
                  </label>

                  <label className="policy-field">
                    <span>Dispatch within (days)</span>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={policyForm.dispatchDays ?? ''}
                      placeholder={`Mirwal default: ${policiesQuery.data?.defaults?.dispatchDays ?? 2}`}
                      onChange={(event) => updatePolicy('dispatchDays', event.target.value === '' ? null : Number(event.target.value))}
                    />
                    <small>How long you have to hand an order to a courier before it counts as late.</small>
                  </label>

                  <label className="policy-field">
                    <span>Who pays return postage?</span>
                    <select
                      value={policyForm.returnShippingPaidBy}
                      onChange={(event) => updatePolicy('returnShippingPaidBy', event.target.value)}
                    >
                      <option value="buyer">The buyer</option>
                      <option value="seller">I do</option>
                    </select>
                    <small>When the item is faulty or wrong, you pay regardless — this covers change-of-mind returns.</small>
                  </label>

                  <label className="policy-toggle">
                    <input
                      type="checkbox"
                      checked={policyForm.exchangeOffered}
                      onChange={(event) => updatePolicy('exchangeOffered', event.target.checked)}
                    />
                    <span>
                      <b>Offer exchanges</b>
                      <small>Buyers can ask for a replacement instead of a refund.</small>
                    </span>
                  </label>

                  <label className="policy-field wide">
                    <span>Returns, in your own words</span>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={policyForm.returnsText ?? ''}
                      onChange={(event) => updatePolicy('returnsText', event.target.value)}
                      placeholder="Anything a buyer should know before returning something."
                    />
                  </label>

                  <label className="policy-field wide">
                    <span>Delivery notes</span>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={policyForm.shippingText ?? ''}
                      onChange={(event) => updatePolicy('shippingText', event.target.value)}
                      placeholder="Areas you deliver to, cut-off times, anything unusual."
                    />
                  </label>

                  <label className="policy-field wide">
                    <span>Warranty</span>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={policyForm.warrantyText ?? ''}
                      onChange={(event) => updatePolicy('warrantyText', event.target.value)}
                      placeholder="What you guarantee, and for how long."
                    />
                  </label>
                </div>
              )}

              <div className="panel-actions">
                <button type="button" className="btn-primary" onClick={savePolicies} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Policies'}
                </button>
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
              <button type="button" className="btn-primary" onClick={() => saveChanges('seo')} disabled={saving}>{saving ? 'Saving…' : 'Save SEO'}</button>
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
                    <div className="store-preview-logo">{(store?.name || profile.storeName || '?').charAt(0).toUpperCase()}</div>
                    <div>
                      <h3>{store?.name || profile.storeName}</h3>
                      <div className="rating-row"><span>{avgRating ? `★ ${avgRating}` : 'No reviews yet'}</span></div>
                    </div>
                    <div className="preview-actions">
                      <button type="button" className="btn-primary small" onClick={() => navigateTo(`/seller/${store?.slug || ''}`)}>Open Public Store</button>
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
                      {items.length === 0 && <p className="section-help">No products yet.</p>}
                      {items.slice(0, 3).map((product) => (
                        <article key={product.id} className="preview-product-card">
                          <div>
                            <strong>{product.name}</strong>
                            <small>Rs. {Number(product.price.amount).toLocaleString('en-PK')}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                    <aside className="preview-about-card">
                      <h4>About</h4>
                      <p>{profile.fullDescription}</p>
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
                <button type="button" className="btn-primary" onClick={() => saveChanges()} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </section>
          </div>
        )
    }
  }

  return (
    <SellerLayout activeItem="store-profile" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Store Profile' }, { label: tabs.find((item) => item.key === currentPage)?.label || 'Store Profile' }]}>
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

        {/* Whatever the last save actually did — including the server's own notice when a
            rename drops the verified badge. */}
        {flash && <p className={`store-flash store-flash-${flash.tone}`} role="status">{flash.text}</p>}
        {renderContent()}
      </div>
    </SellerLayout>
  )
}

export default StoreProfile
