import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { deleteImage, storeImage } from '../../lib/media.js'

/**
 * Images that belong to a seller.
 *
 * The gap this closes is blunt: `product_images` has existed since migration 002 and had no
 * write path outside admin JSON, so a seller could not list a product with a photograph. On a
 * marketplace that is not a missing nicety — a listing with no image does not sell, so the
 * seller panel's entire "add product" flow ended at a step that could not be completed.
 *
 * Two rules everything here enforces:
 *
 *   * ownership is structural. Every function takes `sellerId` and filters on it, the same way
 *     products.service.js does. There is no code path that takes an image id alone, so
 *     "attach my image to someone else's product" is not a request that can be formed.
 *
 *   * an image is never referenced by a URL the client supplied. The upload returns a path
 *     this server generated; `store.service.js` and the product path both refuse anything that
 *     is not one. A logo field that accepts an arbitrary URL is a way to make Mirwal's pages
 *     load third-party content and leak every visitor's IP to it.
 */

// A product photo below this is unusable on a phone, which is where almost all Pakistani
// marketplace traffic is. Refusing it at upload is kinder than letting a seller discover their
// listing looks broken.
const MIN_PRODUCT_IMAGE_WIDTH = 500
const MAX_IMAGES_PER_PRODUCT = 10

const PURPOSE_RULES = {
  product: { minWidth: MIN_PRODUCT_IMAGE_WIDTH, minHeight: 500 },
  store_logo: { minWidth: 200, minHeight: 200 },
  store_banner: { minWidth: 1000, minHeight: 200 },
  category: { minWidth: 400, minHeight: 400 },
  banner: { minWidth: 800, minHeight: 200 },
  other: {},
}

function shapeAsset(row) {
  return {
    id: row.public_id,
    url: row.url,
    purpose: row.purpose,
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  }
}

/**
 * Store an uploaded image and record it.
 *
 * A re-upload of identical bytes returns the existing asset rather than writing a second copy.
 * Sellers routinely upload the same photo to several listings, and the checksum makes that
 * free instead of multiplying disk use — it is also the hook a stolen-image check needs later.
 */
export async function upload({ buffer, originalName, purpose = 'other', sellerId = null, userId = null }) {
  if (!PURPOSE_RULES[purpose]) {
    throw badRequest(`Unknown image purpose "${purpose}".`, 'INVALID_PURPOSE')
  }

  const stored = await storeImage(buffer, originalName, PURPOSE_RULES[purpose])

  const duplicate = sellerId
    ? await queryOne(
      `SELECT * FROM media_assets
        WHERE seller_id = ? AND checksum = ? AND purpose = ? AND deleted_at IS NULL`,
      [sellerId, stored.checksum, purpose],
    )
    : null

  if (duplicate) {
    // The freshly written file is redundant; remove it rather than leaving an orphan on disk.
    await deleteImage(stored.storedName)
    return { ...shapeAsset(duplicate), reused: true }
  }

  const publicId = randomUUID()
  await query(
    `INSERT INTO media_assets
       (public_id, seller_id, uploaded_by, purpose, original_name, stored_name, url,
        mime_type, size_bytes, width, height, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId, sellerId, userId, purpose, stored.safeOriginalName, stored.storedName, stored.url,
      stored.mimeType, stored.size, stored.width, stored.height, stored.checksum,
    ],
  )

  const row = await queryOne('SELECT * FROM media_assets WHERE public_id = ?', [publicId])
  return { ...shapeAsset(row), reused: false }
}

/** A seller's own library, so they can reuse a photo instead of re-uploading it. */
export async function listForSeller(sellerId, { purpose, page = 1, pageSize = 50 } = {}) {
  const where = ['seller_id = ?', 'deleted_at IS NULL']
  const params = [sellerId]
  if (purpose) { where.push('purpose = ?'); params.push(purpose) }

  const rows = await query(
    `SELECT * FROM media_assets WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM media_assets WHERE ${where.join(' AND ')}`,
    params,
  )
  return { items: rows.map(shapeAsset), total: Number(total) }
}

/**
 * Attach images to a product, replacing whatever was there.
 *
 * Replace rather than append because the caller is a form that owns the whole gallery
 * including its order, and an append-only endpoint would make removing image three impossible
 * without a second call that could half-fail.
 *
 * Every asset is re-checked as belonging to this seller inside the transaction. Without that,
 * a seller could attach a competitor's photograph by id — which is both theft and a way to
 * make a rival's product page break when the original is deleted.
 */
export async function setProductImages(sellerId, productPublicId, images) {
  if (images.length > MAX_IMAGES_PER_PRODUCT) {
    throw badRequest(`A listing can have at most ${MAX_IMAGES_PER_PRODUCT} images.`, 'TOO_MANY_IMAGES')
  }

  const product = await queryOne(
    'SELECT id, seller_id FROM products WHERE public_id = ? AND deleted_at IS NULL',
    [productPublicId],
  )
  if (!product) throw notFound('Product not found.')
  if (String(product.seller_id) !== String(sellerId)) {
    // Deliberately "not found", not "forbidden": confirming the id exists tells a prober that
    // they guessed a real product belonging to someone else.
    throw notFound('Product not found.')
  }

  const assetIds = images.map((image) => image.assetId)
  const assets = assetIds.length
    ? await query(
      `SELECT id, public_id, url FROM media_assets
        WHERE public_id IN (${assetIds.map(() => '?').join(',')})
          AND seller_id = ? AND deleted_at IS NULL`,
      [...assetIds, sellerId],
    )
    : []

  const byPublicId = new Map(assets.map((asset) => [asset.public_id, asset]))
  const missing = assetIds.filter((id) => !byPublicId.has(id))
  if (missing.length) {
    throw badRequest('One of those images is not in your library.', 'ASSET_NOT_FOUND')
  }

  await withTransaction(async (connection) => {
    await connection.execute('DELETE FROM product_images WHERE product_id = ?', [product.id])
    for (const [index, image] of images.entries()) {
      const asset = byPublicId.get(image.assetId)
      await connection.execute(
        `INSERT INTO product_images (product_id, media_asset_id, url, alt_text, position, width, height)
         SELECT ?, id, url, ?, ?, width, height FROM media_assets WHERE id = ?`,
        [product.id, String(image.altText ?? '').slice(0, 255), index, asset.id],
      )
    }
  })

  return { productId: productPublicId, imageCount: images.length }
}

/**
 * Soft-delete an image.
 *
 * Refused while a listing still uses it. Deleting the bytes out from under a live product page
 * turns it into a broken image for every visitor, and "it was deleted on purpose" is not a
 * distinction a shopper can make.
 */
export async function remove(sellerId, publicId) {
  const asset = await queryOne(
    'SELECT id, seller_id, stored_name FROM media_assets WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!asset) throw notFound('Image not found.')
  if (String(asset.seller_id) !== String(sellerId)) throw notFound('Image not found.')

  const [{ uses }] = await query(
    'SELECT COUNT(*) AS uses FROM product_images WHERE media_asset_id = ?',
    [asset.id],
  )
  if (Number(uses) > 0) {
    throw conflict(
      `This image is used by ${uses} listing${Number(uses) > 1 ? 's' : ''}. Remove it from those first.`,
      'ASSET_IN_USE',
    )
  }

  const inUseAsBranding = await queryOne(
    'SELECT id FROM sellers WHERE id = ? AND (logo_url = (SELECT url FROM media_assets WHERE id = ?) OR banner_url = (SELECT url FROM media_assets WHERE id = ?))',
    [sellerId, asset.id, asset.id],
  )
  if (inUseAsBranding) {
    throw conflict('This image is your store logo or banner. Replace it first.', 'ASSET_IN_USE')
  }

  // Soft-delete the row, then remove the file. In that order: a row that outlives its file is
  // a broken image, while a file that outlives its row is only wasted disk.
  await query('UPDATE media_assets SET deleted_at = NOW(3) WHERE id = ?', [asset.id])
  await deleteImage(asset.stored_name)
  return { deleted: true }
}

/**
 * Confirm that a URL is one this server issued and this seller owns.
 *
 * Used by the store service before writing a logo or banner. `store.service.js` already
 * refuses anything that is not a relative path; this is the second half — a relative path that
 * points at someone else's asset is still not this seller's to use.
 */
export async function assertOwnedUrl(sellerId, url) {
  if (url == null || url === '') return null
  const asset = await queryOne(
    'SELECT url FROM media_assets WHERE url = ? AND seller_id = ? AND deleted_at IS NULL',
    [url, sellerId],
  )
  if (!asset) {
    throw forbidden('That image is not in your library. Upload it first.', 'ASSET_NOT_OWNED')
  }
  return asset.url
}

export { MAX_IMAGES_PER_PRODUCT, MIN_PRODUCT_IMAGE_WIDTH }
