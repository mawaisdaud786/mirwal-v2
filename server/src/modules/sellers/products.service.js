import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { parseJsonColumn } from '../../lib/json.js'

/**
 * Seller product management — the write side of a seller's own catalogue.
 *
 * Ownership is structural, not checked-then-trusted: every function here takes `sellerId` as
 * its first argument, and that value only ever comes from `req.seller.id`, which
 * `requireSeller` resolved from the access token. There is no code path where a seller id
 * arrives from the request body or a URL parameter, so "edit another store's product" is not
 * a request that can be expressed, let alone one that has to be rejected.
 *
 * The other rule: a seller cannot publish themselves. New and edited listings land in
 * `pending_review` and an admin moves them to `active` (see admin/catalog.service.js
 * `setProductApproval`). A seller may move their own product between `draft` and
 * `pending_review`, and may `archived` it to take it off sale — but never to `active`.
 */

/** Statuses a seller is allowed to set on their own product. `active` is deliberately absent. */
const SELLER_SETTABLE_STATUSES = ['draft', 'pending_review', 'archived']

/** Fetch a product and prove it belongs to this seller, or fail the same way for both cases. */
async function ownedProduct(sellerId, publicId) {
  const product = await queryOne(
    'SELECT id, seller_id, status, name, currency_code FROM products WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  // A product that exists but belongs to someone else and a product that does not exist are
  // reported identically: distinguishing them turns this endpoint into a way to confirm
  // which product ids are real.
  if (!product || product.seller_id !== sellerId) throw notFound('Product not found.')
  return product
}

async function resolveCategoryId(slug) {
  const row = await queryOne('SELECT id FROM categories WHERE slug = ? AND is_active = 1', [slug])
  if (!row) throw badRequest('That category does not exist.', 'INVALID_CATEGORY')
  return row.id
}

async function resolveBrandId(slug) {
  if (!slug) return null
  const row = await queryOne('SELECT id FROM brands WHERE slug = ? AND is_active = 1', [slug])
  if (!row) throw badRequest('That brand does not exist.', 'INVALID_BRAND')
  return row.id
}

async function uniqueProductSlug(name, ignoreId = null) {
  const base = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'product'
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await queryOne(
      `SELECT id FROM products WHERE slug = ?${ignoreId ? ' AND id <> ?' : ''}`,
      ignoreId ? [candidate, ignoreId] : [candidate],
    )
    if (!clash) return candidate
  }
  throw conflict('Could not generate a unique link for that product name.')
}

/** One of the seller's own products, with everything the edit form needs to repopulate. */
export async function getProduct(sellerId, publicId) {
  await ownedProduct(sellerId, publicId)

  const row = await queryOne(
    `SELECT p.id, p.public_id, p.slug, p.name, p.subtitle, p.description, p.status,
            p.rejected_reason, p.condition_type, p.price, p.compare_at_price, p.cost_price,
            p.currency_code, p.rating_average, p.rating_count, p.meta_title, p.meta_description,
            p.published_at, p.created_at, p.updated_at,
            c.slug AS category_slug, c.name AS category_name,
            b.slug AS brand_slug, b.name AS brand_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.public_id = ?`,
    [publicId],
  )

  const [images, variants] = await Promise.all([
    query('SELECT url, alt_text, position FROM product_images WHERE product_id = ? ORDER BY position', [row.id]),
    query(
      `SELECT v.id, v.sku, v.name, v.options, v.price, v.is_default, v.is_active,
              i.quantity, i.reserved, i.low_stock_threshold, i.allow_backorder
         FROM product_variants v
         LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE v.product_id = ? ORDER BY v.position`,
      [row.id],
    ),
  ])

  return {
    id: row.public_id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    status: row.status,
    // The seller's most important field when a listing was turned down.
    rejectedReason: row.rejected_reason,
    condition: row.condition_type,
    price: formatMoney(row.price, row.currency_code),
    compareAtPrice: formatMoney(row.compare_at_price, row.currency_code),
    costPrice: formatMoney(row.cost_price, row.currency_code),
    currencyCode: row.currency_code,
    category: { slug: row.category_slug, name: row.category_name },
    brand: row.brand_slug ? { slug: row.brand_slug, name: row.brand_name } : null,
    rating: { average: Number(row.rating_average), count: row.rating_count },
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    images: images.map((image) => ({ url: image.url, alt: image.alt_text, position: image.position })),
    variants: variants.map((variant) => ({
      id: String(variant.id),
      sku: variant.sku,
      name: variant.name,
      options: parseJsonColumn(variant.options),
      price: variant.price == null ? null : formatMoney(variant.price, row.currency_code),
      isDefault: Boolean(variant.is_default),
      isActive: Boolean(variant.is_active),
      quantity: Number(variant.quantity ?? 0),
      reserved: Number(variant.reserved ?? 0),
      lowStockThreshold: Number(variant.low_stock_threshold ?? 5),
      allowBackorder: Boolean(variant.allow_backorder),
    })),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Create a listing for this seller.
 *
 * Always `pending_review` unless the seller explicitly saved a draft — a seller publishing
 * straight to the storefront would make the admin approval queue decorative.
 */
export async function createProduct(sellerId, input) {
  const categoryId = await resolveCategoryId(input.categorySlug)
  const brandId = await resolveBrandId(input.brandSlug)
  const slug = await uniqueProductSlug(input.name)
  const status = input.status === 'draft' ? 'draft' : 'pending_review'

  const publicId = await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO products
         (public_id, seller_id, category_id, brand_id, slug, name, subtitle, description,
          currency_code, price, compare_at_price, cost_price, condition_type, status,
          meta_title, meta_description, rating_average, rating_count, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NOW(3), NOW(3))`,
      [
        sellerId, categoryId, brandId, slug, input.name, input.subtitle ?? '', input.description ?? null,
        input.currencyCode ?? 'PKR', input.price, input.compareAtPrice ?? null, input.costPrice ?? null,
        input.condition ?? 'new', status, input.metaTitle ?? null, input.metaDescription ?? null,
      ],
    )
    const productId = result.insertId

    // A default variant plus its inventory row, for the same reason as the admin path: cart,
    // inventory and order lines all key off variant_id, so a product without one is unsellable.
    const [variant] = await connection.execute(
      `INSERT INTO product_variants
         (product_id, seller_id, sku, name, is_default, is_active, position, created_at, updated_at)
       VALUES (?, ?, ?, 'Default', 1, 1, 0, NOW(3), NOW(3))`,
      [productId, sellerId, input.sku || `MRW-${Date.now().toString(36).toUpperCase()}`],
    )
    await connection.execute(
      `INSERT INTO inventory (variant_id, quantity, reserved, low_stock_threshold, allow_backorder, updated_at)
       VALUES (?, ?, 0, ?, ?, NOW(3))`,
      [variant.insertId, input.quantity ?? 0, input.lowStockThreshold ?? 5, input.allowBackorder ? 1 : 0],
    )

    for (const [position, image] of (input.images ?? []).entries()) {
      await connection.execute(
        'INSERT INTO product_images (product_id, url, alt_text, position, created_at) VALUES (?, ?, ?, ?, NOW(3))',
        [productId, image.url, image.alt ?? input.name, position],
      )
    }

    await connection.execute('UPDATE sellers SET product_count = product_count + 1 WHERE id = ?', [sellerId])

    const [[created]] = await connection.execute('SELECT public_id FROM products WHERE id = ?', [productId])
    return created.public_id
  })

  return getProduct(sellerId, publicId)
}

const UPDATABLE = {
  name: 'name',
  subtitle: 'subtitle',
  description: 'description',
  price: 'price',
  compareAtPrice: 'compare_at_price',
  costPrice: 'cost_price',
  condition: 'condition_type',
  metaTitle: 'meta_title',
  metaDescription: 'meta_description',
}

/**
 * Edit one of this seller's products.
 *
 * Editing a live listing sends it back to `pending_review`: otherwise a seller could get an
 * innocuous product approved and then swap its content for something else, using approval as
 * a one-time gate rather than an ongoing one.
 */
export async function updateProduct(sellerId, publicId, input) {
  const product = await ownedProduct(sellerId, publicId)

  const sets = []
  const params = []
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  if (input.categorySlug !== undefined) {
    sets.push('category_id = ?'); params.push(await resolveCategoryId(input.categorySlug))
  }
  if (input.brandSlug !== undefined) {
    sets.push('brand_id = ?'); params.push(await resolveBrandId(input.brandSlug))
  }
  if (!sets.length && input.images === undefined) {
    throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')
  }

  const requiresReview = product.status === 'active'
  if (requiresReview) { sets.push("status = 'pending_review'") }
  sets.push('updated_at = NOW(3)')

  await withTransaction(async (connection) => {
    if (sets.length) {
      await connection.execute(
        `UPDATE products SET ${sets.join(', ')} WHERE id = ? AND seller_id = ?`,
        [...params, product.id, sellerId],
      )
    }
    // Images are replaced wholesale rather than diffed: the client sends the gallery it wants
    // in the order it wants, and position is derived from that order.
    if (input.images !== undefined) {
      await connection.execute('DELETE FROM product_images WHERE product_id = ?', [product.id])
      for (const [position, image] of input.images.entries()) {
        await connection.execute(
          'INSERT INTO product_images (product_id, url, alt_text, position, created_at) VALUES (?, ?, ?, ?, NOW(3))',
          [product.id, image.url, image.alt ?? product.name, position],
        )
      }
    }
  })

  const updated = await getProduct(sellerId, publicId)
  return { product: updated, returnedToReview: requiresReview }
}

/** Move a product between the statuses a seller controls. Never to `active`. */
export async function setProductStatus(sellerId, publicId, status) {
  const product = await ownedProduct(sellerId, publicId)
  if (!SELLER_SETTABLE_STATUSES.includes(status)) {
    throw forbidden('Only Mirwal can publish a listing. Submit it for review instead.', 'STATUS_NOT_SELLER_SETTABLE')
  }
  await query(
    'UPDATE products SET status = ?, updated_at = NOW(3) WHERE id = ? AND seller_id = ?',
    [status, product.id, sellerId],
  )
  return { previousStatus: product.status, status }
}

/** Soft-delete, for the same order-history reason as the admin path. */
export async function deleteProduct(sellerId, publicId) {
  const product = await ownedProduct(sellerId, publicId)
  await withTransaction(async (connection) => {
    await connection.execute(
      'UPDATE products SET deleted_at = NOW(3), updated_at = NOW(3) WHERE id = ? AND seller_id = ?',
      [product.id, sellerId],
    )
    await connection.execute(
      'UPDATE sellers SET product_count = GREATEST(product_count - 1, 0) WHERE id = ?',
      [sellerId],
    )
  })
  return { name: product.name }
}

/** Update stock on a variant this seller owns. */
export async function updateVariantInventory(sellerId, variantId, input) {
  const variant = await queryOne(
    `SELECT v.id, v.sku, p.seller_id
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND p.deleted_at IS NULL`,
    [variantId],
  )
  if (!variant || variant.seller_id !== sellerId) throw notFound('Variant not found.')

  const sets = []
  const params = []
  if (input.quantity !== undefined) { sets.push('quantity = ?'); params.push(input.quantity) }
  if (input.lowStockThreshold !== undefined) { sets.push('low_stock_threshold = ?'); params.push(input.lowStockThreshold) }
  if (input.allowBackorder !== undefined) { sets.push('allow_backorder = ?'); params.push(input.allowBackorder ? 1 : 0) }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE inventory SET ${sets.join(', ')} WHERE variant_id = ?`, [...params, variantId])
  return { sku: variant.sku }
}

/**
 * The category and brand lists a seller needs to fill in the product form.
 *
 * Only active entries: offering a seller a category the storefront has switched off would
 * produce listings that are approved and then invisible.
 */
export async function getProductFormOptions() {
  const [categories, brands] = await Promise.all([
    query('SELECT slug, name, parent_id FROM categories WHERE is_active = 1 ORDER BY position, name'),
    query('SELECT slug, name FROM brands WHERE is_active = 1 ORDER BY name'),
  ])
  return {
    categories: categories.map((row) => ({ slug: row.slug, name: row.name, isChild: row.parent_id != null })),
    brands: brands.map((row) => ({ slug: row.slug, name: row.name })),
    conditions: ['new', 'refurbished', 'used'],
  }
}
