import { useCallback, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './add-product.css'
import ProductImages from '../components/ProductImages'

/**
 * Create or edit a listing.
 *
 * This replaces a nine-step wizard whose steps were largely fabricated — an attribute table
 * pre-filled with headphone specifications, an "AI Intelligence" section, invented variant
 * rows, and media upload cards that uploaded nothing — sitting above a banner admitting the
 * form saved nothing at all.
 *
 * What is here is exactly what `POST /seller/me/products` accepts, and nothing else. A field
 * with no backing would be the same lie in a smaller form, so the dropped sections are not
 * hidden or disabled: they are gone, and the note at the foot says which ones and why.
 *
 * A seller cannot publish: the API forces `pending_review` (or `draft`), and editing a live
 * listing sends it back for review. The server's own message says so after saving, rather
 * than this page guessing.
 */

const EMPTY = {
  name: '',
  subtitle: '',
  description: '',
  categorySlug: '',
  brandSlug: '',
  condition: 'new',
  price: '',
  compareAtPrice: '',
  costPrice: '',
  sku: '',
  quantity: '0',
  lowStockThreshold: '5',
  metaTitle: '',
  metaDescription: '',
  images: [],
}

/** Only send optional fields the seller actually filled in. */
function buildPayload(form, { includeStock }) {
  const optional = (value) => (value.trim() === '' ? undefined : value.trim())
  return {
    name: form.name.trim(),
    price: form.price.trim(),
    categorySlug: form.categorySlug,
    condition: form.condition,
    subtitle: optional(form.subtitle),
    description: optional(form.description),
    brandSlug: optional(form.brandSlug),
    compareAtPrice: optional(form.compareAtPrice),
    costPrice: optional(form.costPrice),
    metaTitle: optional(form.metaTitle),
    metaDescription: optional(form.metaDescription),
    // Every URL here was returned by Mirwal's own upload endpoint — the form has no way to
    // supply an arbitrary one, which is what stops a listing loading (and vouching for) an
    // image hosted somewhere else entirely.
    ...(form.images.length ? { images: form.images.map((image) => ({ url: image.url, alt: image.alt || form.name.trim() })) } : {}),
    // Stock and SKU belong to the default variant, which only the create path builds.
    ...(includeStock ? {
      sku: optional(form.sku),
      quantity: Number(form.quantity || 0),
      lowStockThreshold: Number(form.lowStockThreshold || 5),
    } : {}),
  }
}

export default function AddProduct({ editMode = false, productId }) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [loadedId, setLoadedId] = useState(null)
  const [created, setCreated] = useState(null)

  const options = useApiQuery((signal) => api.seller.product.options(signal), [])
  const existing = useApiQuery(
    (signal) => api.seller.product.get(productId, signal),
    [productId],
    { enabled: Boolean(editMode && productId) },
  )

  // Populate the form once the product arrives. Done during render rather than in an effect
  // so the fields are never briefly blank over a product that has already loaded.
  if (editMode && existing.data && loadedId !== existing.data.id) {
    setLoadedId(existing.data.id)
    setForm({
      ...EMPTY,
      name: existing.data.name ?? '',
      subtitle: existing.data.subtitle ?? '',
      description: existing.data.description ?? '',
      categorySlug: existing.data.category?.slug ?? '',
      brandSlug: existing.data.brand?.slug ?? '',
      condition: existing.data.condition ?? 'new',
      price: existing.data.price?.amount ?? '',
      compareAtPrice: existing.data.compareAtPrice?.amount ?? '',
      costPrice: existing.data.costPrice?.amount ?? '',
      metaTitle: existing.data.metaTitle ?? '',
      metaDescription: existing.data.metaDescription ?? '',
      images: (existing.data.images ?? []).map((image) => ({ url: image.url, alt: image.alt ?? '' })),
    })
  }

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = useCallback(async (event, status) => {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const payload = buildPayload(form, { includeStock: !editMode })
      const { data, message } = editMode
        ? await api.seller.product.update(productId, payload)
        : await api.seller.product.create({ ...payload, status })
      // The server's message carries what the seller needs to know — that a live listing has
      // gone back for review, or that a new one is awaiting approval. Deliberately NOT
      // followed by a redirect: navigating away remounts this component and discards the
      // message, so the seller would be moved to a different screen having never been told
      // whether anything was submitted.
      setFlash({ tone: 'success', text: message })
      if (!editMode) setCreated({ id: data.id, status: data.status })
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }, [form, editMode, productId])

  const categories = options.data?.categories ?? []
  const brands = options.data?.brands ?? []
  const loadingExisting = editMode && existing.isLoading

  return (
    <SellerLayout
      activeItem={editMode ? 'all-products' : 'add-product'}
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/') },
        { label: 'Products', onClick: () => navigateTo('/products') },
        { label: editMode ? 'Edit Product' : 'Add New Product' },
      ]}
    >
      <div className="add-product-content">
        <div className="product-builder-header">
          <div>
            <h1>{editMode ? 'Edit product' : 'Add a product'}</h1>
            <p>
              {editMode
                ? 'Changes to a live listing go back to Mirwal for review before republishing.'
                : 'Mirwal reviews new listings before they appear on the storefront.'}
            </p>
          </div>
        </div>

        {flash && (
          <p className={`product-flash ${flash.tone}`} role="status">
            <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
          </p>
        )}

        {editMode && existing.data && (
          <p className="product-status-line">
            Status: <span className={`product-status ${existing.data.status}`}>{existing.data.status.replace('_', ' ')}</span>
          </p>
        )}

        {created && (
          <div className="product-created" role="status">
            <strong>Listing saved as {created.status.replace('_', ' ')}.</strong>
            <div>
              <button type="button" onClick={() => navigateTo(`/products/edit/${created.id}`)}>Edit this listing</button>
              <button type="button" onClick={() => { setForm(EMPTY); setCreated(null); setFlash(null) }}>Add another</button>
              <button type="button" onClick={() => navigateTo('/products')}>Go to My Products</button>
            </div>
          </div>
        )}

        {editMode && existing.data?.rejectedReason && (
          <p className="product-flash error" role="status">
            <Icon name="triangle-exclamation" /> <strong>Rejected:</strong> {existing.data.rejectedReason}
          </p>
        )}

        {loadingExisting ? (
          <p className="product-loading">Loading product...</p>
        ) : editMode && existing.isError ? (
          <p className="product-flash error"><Icon name="triangle-exclamation" /> {describeApiError(existing.error)}</p>
        ) : (
          <form className="product-form" onSubmit={(event) => submit(event, 'pending_review')}>
            <section className="form-section">
              <h2>Basics</h2>
              <label className="product-field">
                <span>Product name *</span>
                <input value={form.name} onChange={set('name')} required minLength={2} maxLength={255} placeholder="Reusable rain poncho" />
              </label>
              <label className="product-field">
                <span>Short description</span>
                <input value={form.subtitle} onChange={set('subtitle')} maxLength={150} placeholder="Travel essential" />
              </label>
              <label className="product-field">
                <span>Full description</span>
                <textarea value={form.description} onChange={set('description')} rows={5} placeholder="What it is, what it is made of, and what a buyer gets." />
              </label>
              <div className="product-field-row">
                <label className="product-field">
                  <span>Category *</span>
                  <select value={form.categorySlug} onChange={set('categorySlug')} required>
                    <option value="">Choose a category</option>
                    {categories.map((category) => (
                      <option key={category.slug} value={category.slug}>
                        {category.isChild ? `— ${category.name}` : category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="product-field">
                  <span>Brand</span>
                  <select value={form.brandSlug} onChange={set('brandSlug')}>
                    <option value="">No brand</option>
                    {brands.map((brand) => <option key={brand.slug} value={brand.slug}>{brand.name}</option>)}
                  </select>
                  {brands.length === 0 && <small>Mirwal has not added any brands yet.</small>}
                </label>
                <label className="product-field">
                  <span>Condition</span>
                  <select value={form.condition} onChange={set('condition')}>
                    <option value="new">New</option>
                    <option value="refurbished">Refurbished</option>
                    <option value="used">Used</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="form-section">
              <h2>Pricing</h2>
              <div className="product-field-row">
                <label className="product-field">
                  <span>Price (PKR) *</span>
                  <input value={form.price} onChange={set('price')} required placeholder="999" inputMode="decimal" />
                </label>
                <label className="product-field">
                  <span>Compare-at price (PKR)</span>
                  <input value={form.compareAtPrice} onChange={set('compareAtPrice')} placeholder="1199" inputMode="decimal" />
                  <small>Must be higher than the price — it is the struck-through figure shoppers see.</small>
                </label>
                <label className="product-field">
                  <span>Cost price (PKR)</span>
                  <input value={form.costPrice} onChange={set('costPrice')} placeholder="600" inputMode="decimal" />
                  <small>Only you and Mirwal see this. Never shown to shoppers.</small>
                </label>
              </div>
            </section>

            {!editMode && (
              <section className="form-section">
                <h2>Stock</h2>
                <div className="product-field-row">
                  <label className="product-field">
                    <span>SKU</span>
                    <input value={form.sku} onChange={set('sku')} maxLength={80} placeholder="Generated if left blank" />
                  </label>
                  <label className="product-field">
                    <span>Quantity</span>
                    <input type="number" min="0" value={form.quantity} onChange={set('quantity')} />
                  </label>
                  <label className="product-field">
                    <span>Low-stock alert at</span>
                    <input type="number" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
                  </label>
                </div>
              </section>
            )}

            <section className="form-section">
              <h2>Images</h2>
              {/*
                This was a single "paste a link to an image you already host" field, because
                Mirwal had no image storage — which meant a seller could not put a photograph
                on a listing, and a listing without one does not sell.

                Uploads now go to Mirwal and come back as a relative path. The form never
                accepts a URL the seller typed: an arbitrary one would make Mirwal's pages load
                third-party content and leak every visitor's IP to whoever hosts it.
              */}
              <ProductImages
                images={form.images}
                onChange={(images) => setForm((current) => ({ ...current, images }))}
                productName={form.name}
              />
            </section>

            <section className="form-section">
              <h2>Search listing</h2>
              <label className="product-field">
                <span>Meta title</span>
                <input value={form.metaTitle} onChange={set('metaTitle')} maxLength={180} placeholder="Defaults to the product name" />
              </label>
              <label className="product-field">
                <span>Meta description</span>
                <textarea value={form.metaDescription} onChange={set('metaDescription')} rows={2} maxLength={320} />
              </label>
            </section>

            <div className="product-form-actions">
              <button type="submit" className="primary-action" disabled={busy}>
                {busy ? 'Saving...' : editMode ? 'Save changes' : 'Submit for review'}
              </button>
              {!editMode && (
                <button type="button" disabled={busy} onClick={(event) => submit(event, 'draft')}>
                  <Icon name="floppy-disk" /> Save as draft
                </button>
              )}
              <button type="button" onClick={() => navigateTo('/products')}>Cancel</button>
            </div>

            <p className="product-form-note">
              Variants, custom attributes, compatibility and shipping dimensions are not collected here:
              Mirwal stores a single default variant per listing today, and a form field with nothing behind
              it would be worse than its absence. Stock for an existing product is edited from My Products.
            </p>
          </form>
        )}
      </div>
    </SellerLayout>
  )
}
