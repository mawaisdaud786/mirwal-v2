import { useRef, useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * Product photographs.
 *
 * `product_images` has existed since migration 002 with no write path outside admin JSON, so
 * a seller could not put a picture on a listing. The form offered "paste a link to an image
 * you already host", which is not something a Pakistani marketplace seller can do — and a
 * listing with no photograph does not sell, so in practice the panel could not produce a
 * usable listing at all.
 *
 * Three decisions worth stating:
 *
 *   * **The seller never supplies a URL.** Uploads return a relative path this server issued.
 *     A field accepting arbitrary URLs would make Mirwal's own pages load third-party content,
 *     leak every visitor's IP to whoever hosts it, and break the listing the day that host
 *     goes away.
 *
 *   * **Order matters and is editable.** The first image is what appears on a search card,
 *     which is the single biggest influence on whether anyone clicks — so it has to be
 *     changeable without re-uploading everything.
 *
 *   * **Alt text is asked for, not demanded.** It is what a screen reader announces and what
 *     image search indexes. Blocking a listing over it would just teach sellers to type "a",
 *     so the field is prompted with the product name as a sensible default.
 */
const MAX_IMAGES = 10

export default function ProductImages({ images, onChange, productName }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const atLimit = images.length >= MAX_IMAGES

  async function upload(fileList) {
    const files = [...fileList].slice(0, MAX_IMAGES - images.length)
    if (!files.length) return

    setBusy(true)
    setError(null)
    const added = []
    try {
      // Sequential rather than parallel: the API caps upload size per request, and a seller on
      // a Pakistani mobile connection uploading six photos at once is more likely to have one
      // fail mid-flight than to finish sooner.
      for (const file of files) {
        const result = await api.seller.media.upload(file, 'product')
        added.push({ url: result.data.url, alt: '' })
      }
      onChange([...images, ...added])
    } catch (uploadError) {
      setError(describeApiError(uploadError))
      // Whatever did upload is kept — making a seller redo four successful uploads because
      // the fifth failed is the wrong trade.
      if (added.length) onChange([...images, ...added])
    } finally {
      setBusy(false)
      // Clearing lets the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const move = (from, to) => {
    if (to < 0 || to >= images.length) return
    const next = [...images]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const setAlt = (index, alt) => {
    onChange(images.map((image, position) => (position === index ? { ...image, alt } : image)))
  }

  return (
    <div className="product-images">
      {images.length > 0 && (
        <ul className="product-image-list">
          {images.map((image, index) => (
            <li key={image.url} className="product-image-item">
              <img src={image.url} alt="" loading="lazy" />
              <div className="product-image-fields">
                {index === 0 && <span className="product-image-primary">Main image</span>}
                <label>
                  <span>Describe this image</span>
                  <input
                    value={image.alt}
                    onChange={(event) => setAlt(index, event.target.value)}
                    placeholder={productName || 'What is in the photo'}
                    maxLength={255}
                  />
                </label>
              </div>
              <div className="product-image-actions">
                <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label="Move earlier">
                  <Icon name="arrow-up" />
                </button>
                <button type="button" onClick={() => move(index, index + 1)} disabled={index === images.length - 1} aria-label="Move later">
                  <Icon name="arrow-down" />
                </button>
                <button type="button" className="product-image-remove" onClick={() => onChange(images.filter((_, i) => i !== index))} aria-label="Remove image">
                  <Icon name="trash" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => upload(event.target.files)}
      />

      <button
        type="button"
        className="product-image-add"
        onClick={() => inputRef.current?.click()}
        disabled={busy || atLimit}
      >
        <Icon name={busy ? 'spinner' : 'plus'} />
        {busy ? 'Uploading…' : images.length ? 'Add another photo' : 'Upload photos'}
      </button>

      {error && <p className="product-image-error" role="alert">{error}</p>}
      <p className="product-image-hint">
        {atLimit
          ? `That is the maximum of ${MAX_IMAGES} images.`
          : 'JPG, PNG, WebP or GIF, up to 5MB each. The first image is the one shoppers see in search results.'}
      </p>
    </div>
  )
}
