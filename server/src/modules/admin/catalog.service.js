import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { parseJsonColumn } from '../../lib/json.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * Admin catalogue management — the write side of the catalogue.
 *
 * `catalog.service.js` serves the storefront and is deliberately read-only and
 * `status = 'active'`-only. Admin needs the opposite: every status, the internal fields the
 * storefront must never see (cost price, rejection reason, owning seller), and the ability to
 * change them. Rather than widen the public service with an `isAdmin` flag — the kind of
 * branch that eventually leaks a draft product onto the storefront — this is a separate
 * module with its own shaping.
 *
 * Product approval is modelled on the existing `products.status` enum
 * (draft → pending_review → active | rejected) that migration 002 already defined and nothing
 * had yet driven.
 */

/** Admin-facing product shape. Includes what the storefront shape deliberately omits. */
function shapeAdminProduct(row) {
  return {
    id: row.public_id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description ?? null,
    status: row.status,
    rejectedReason: row.rejected_reason ?? null,
    condition: row.condition_type,
    price: formatMoney(row.price, row.currency_code),
    compareAtPrice: formatMoney(row.compare_at_price, row.currency_code),
    // Admin-only: margin is the whole point of the admin product table, and this field is
    // never present in the storefront shape.
    costPrice: formatMoney(row.cost_price, row.currency_code),
    currencyCode: row.currency_code,
    category: row.category_id ? { id: row.category_id, slug: row.category_slug, name: row.category_name } : null,
    brand: row.brand_id ? { id: row.brand_id, slug: row.brand_slug, name: row.brand_name } : null,
    seller: row.seller_public_id ? { id: row.seller_public_id, slug: row.seller_slug, name: row.seller_store_name } : null,
    rating: { average: Number(row.rating_average), count: row.rating_count },
    // Exact stock, unlike the storefront's deliberately vague in/low-stock booleans.
    stock: row.stock == null ? null : Number(row.stock),
    imageUrl: row.image_url ?? null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const PRODUCT_SELECT = `
  SELECT p.id, p.public_id, p.slug, p.name, p.subtitle, p.description, p.status,
         p.rejected_reason, p.condition_type, p.price, p.compare_at_price, p.cost_price,
         p.currency_code, p.rating_average, p.rating_count, p.published_at,
         p.created_at, p.updated_at,
         p.category_id, c.slug AS category_slug, c.name AS category_name,
         p.brand_id, b.slug AS brand_slug, b.name AS brand_name,
         s.public_id AS seller_public_id, s.slug AS seller_slug, s.store_name AS seller_store_name,
         (SELECT SUM(GREATEST(i.quantity - i.reserved, 0))
            FROM product_variants v JOIN inventory i ON i.variant_id = v.id
           WHERE v.product_id = p.id) AS stock,
         (SELECT pi.url FROM product_images pi
           WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1) AS image_url
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    JOIN sellers s ON s.id = p.seller_id`

/**
 * List products for the admin table.
 *
 * Unlike the storefront listing this returns every status by default — an admin looking for
 * "why isn't this live?" needs to see drafts and rejections, which is exactly what the
 * storefront query filters out.
 */
export async function listProducts({ page = 1, pageSize = 25, status, search, categoryId, sellerId, sort = 'newest' } = {}) {
  const where = ['p.deleted_at IS NULL']
  const params = []

  if (status) { where.push('p.status = ?'); params.push(status) }
  if (categoryId) { where.push('p.category_id = ?'); params.push(categoryId) }
  if (sellerId) { where.push('p.seller_id = ?'); params.push(sellerId) }
  if (search) {
    where.push('(p.name LIKE ? OR p.slug LIKE ?)')
    // Leading wildcard prevents index use, but the admin table is small and correctness
    // (finding "phone" inside "Smartphone") matters more than the scan here.
    params.push(`%${search}%`, `%${search}%`)
  }

  const ORDER = {
    newest: 'p.created_at DESC',
    oldest: 'p.created_at ASC',
    name: 'p.name ASC',
    'price-high': 'p.price DESC',
    'price-low': 'p.price ASC',
  }
  const orderBy = ORDER[sort] ?? ORDER.newest
  const clause = `WHERE ${where.join(' AND ')}`
  const offset = (page - 1) * pageSize

  const rows = await query(
    `${PRODUCT_SELECT} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM products p ${clause}`,
    params,
  )

  return { items: rows.map(shapeAdminProduct), total: Number(total) }
}

/** Counts per status, for the admin product tabs — one query, not one per tab. */
export async function getProductStatusCounts() {
  const rows = await query(
    `SELECT status, COUNT(*) AS count FROM products WHERE deleted_at IS NULL GROUP BY status`,
  )
  const counts = { draft: 0, pending_review: 0, active: 0, rejected: 0, archived: 0 }
  for (const row of rows) counts[row.status] = Number(row.count)
  counts.all = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return counts
}

export async function getProduct(publicId) {
  const row = await queryOne(`${PRODUCT_SELECT} WHERE p.public_id = ? AND p.deleted_at IS NULL`, [publicId])
  if (!row) throw notFound('Product not found.')

  const [images, variants] = await Promise.all([
    query('SELECT url, alt_text, position, width, height FROM product_images WHERE product_id = ? ORDER BY position', [row.id]),
    query(
      `SELECT v.id, v.sku, v.name, v.options, v.price, v.is_default, v.is_active,
              i.quantity, i.reserved, i.low_stock_threshold
         FROM product_variants v
         LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE v.product_id = ? ORDER BY v.position`,
      [row.id],
    ),
  ])

  return {
    ...shapeAdminProduct(row),
    images: images.map((image) => ({ url: image.url, alt: image.alt_text, position: image.position })),
    variants: variants.map((variant) => ({
      id: String(variant.id),
      sku: variant.sku,
      name: variant.name,
      options: parseJsonColumn(variant.options),
      price: variant.price == null ? null : formatMoney(variant.price, row.currency_code),
      isDefault: Boolean(variant.is_default),
      isActive: Boolean(variant.is_active),
      quantity: variant.quantity == null ? null : Number(variant.quantity),
      reserved: variant.reserved == null ? null : Number(variant.reserved),
      lowStockThreshold: variant.low_stock_threshold == null ? null : Number(variant.low_stock_threshold),
    })),
  }
}

/** Turn a name into a URL slug, then make it unique against the table it is going into. */
async function uniqueSlug(table, name, ignoreId = null) {
  const base = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'item'

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await queryOne(
      `SELECT id FROM ${table} WHERE slug = ?${ignoreId ? ' AND id <> ?' : ''}`,
      ignoreId ? [candidate, ignoreId] : [candidate],
    )
    if (!clash) return candidate
  }
  throw conflict('Could not generate a unique slug for that name.')
}

/** Resolve a category/brand/seller public reference to its internal id, or fail cleanly. */
async function resolveId(table, publicColumn, value, label) {
  if (value == null) return null
  const row = await queryOne(`SELECT id FROM ${table} WHERE ${publicColumn} = ?`, [value])
  if (!row) throw badRequest(`${label} not found.`, 'INVALID_REFERENCE')
  return row.id
}

/**
 * Create a product on behalf of a seller.
 *
 * An admin-created product goes straight to `active` unless the caller says otherwise: an
 * admin creating a listing has already made the approval decision, so routing it through
 * pending_review would just make them approve their own work.
 */
export async function createProduct(input) {
  const categoryId = await resolveId('categories', 'slug', input.categorySlug, 'Category')
  const brandId = input.brandSlug ? await resolveId('brands', 'slug', input.brandSlug, 'Brand') : null
  const sellerId = await resolveId('sellers', 'slug', input.sellerSlug, 'Seller')
  const slug = await uniqueSlug('products', input.slug || input.name)

  return withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO products
         (public_id, seller_id, category_id, brand_id, slug, name, subtitle, description,
          currency_code, price, compare_at_price, cost_price, condition_type, status,
          meta_title, meta_description, published_at, rating_average, rating_count,
          created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NOW(3), NOW(3))`,
      [
        sellerId, categoryId, brandId, slug, input.name, input.subtitle ?? '', input.description ?? null,
        input.currencyCode ?? 'PKR', input.price, input.compareAtPrice ?? null, input.costPrice ?? null,
        input.condition ?? 'new', input.status ?? 'active',
        input.metaTitle ?? null, input.metaDescription ?? null,
        (input.status ?? 'active') === 'active' ? new Date() : null,
      ],
    )
    const productId = result.insertId

    // Every product needs at least one variant: the cart, inventory and order lines all key
    // off variant_id, so a product without one is unsellable and looks broken rather than
    // out of stock.
    const [variant] = await connection.execute(
      `INSERT INTO product_variants
         (product_id, seller_id, sku, name, is_default, is_active, position, created_at, updated_at)
       VALUES (?, ?, ?, 'Default', 1, 1, 0, NOW(3), NOW(3))`,
      [productId, sellerId, input.sku || `MRW-${Date.now().toString(36).toUpperCase()}`],
    )
    await connection.execute(
      `INSERT INTO inventory (variant_id, quantity, reserved, low_stock_threshold, allow_backorder, updated_at)
       VALUES (?, ?, 0, ?, 0, NOW(3))`,
      [variant.insertId, input.quantity ?? 0, input.lowStockThreshold ?? 5],
    )

    if (input.images?.length) {
      for (const [position, image] of input.images.entries()) {
        await connection.execute(
          `INSERT INTO product_images (product_id, url, alt_text, position, created_at)
           VALUES (?, ?, ?, ?, NOW(3))`,
          [productId, image.url, image.alt ?? input.name, position],
        )
      }
    }

    await connection.execute('UPDATE sellers SET product_count = product_count + 1 WHERE id = ?', [sellerId])

    const [[row]] = await connection.execute('SELECT public_id FROM products WHERE id = ?', [productId])
    return row.public_id
  })
}

/** Fields an admin may change directly, mapped to their columns. */
const PRODUCT_UPDATABLE = {
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

export async function updateProduct(publicId, input) {
  const product = await queryOne('SELECT id, status FROM products WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!product) throw notFound('Product not found.')

  const sets = []
  const params = []
  for (const [field, column] of Object.entries(PRODUCT_UPDATABLE)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  if (input.categorySlug !== undefined) {
    sets.push('category_id = ?'); params.push(await resolveId('categories', 'slug', input.categorySlug, 'Category'))
  }
  if (input.brandSlug !== undefined) {
    sets.push('brand_id = ?')
    params.push(input.brandSlug ? await resolveId('brands', 'slug', input.brandSlug, 'Brand') : null)
  }
  // Renaming does not re-slug: the old slug is a live URL and may be indexed. Slug changes
  // are an explicit, separate field.
  if (input.slug !== undefined) {
    sets.push('slug = ?'); params.push(await uniqueSlug('products', input.slug, product.id))
  }

  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...params, product.id])
  return getProduct(publicId)
}

/**
 * Approve or reject a product awaiting review.
 *
 * Rejection requires a reason: "rejected" with no explanation is the single most common
 * source of seller support tickets, and the column already exists to hold it.
 */
/**
 * A listing may only go live while its seller is actually allowed to trade.
 *
 * This is the second of two layers. The first is the storefront query, which refuses to
 * return a non-trading seller's products however they got their status. This one refuses to
 * set the status in the first place, so the two cannot disagree and an operator gets a clear
 * error rather than a silent no-op.
 */
function assertSellerCanPublish(sellerStatus, storeName) {
  if (sellerStatus === 'approved') return
  throw conflict(
    `${storeName} is ${sellerStatus}, so its listings cannot be published. ` +
    'Reinstate the store first.',
    'SELLER_NOT_TRADING',
  )
}

export async function setProductApproval(publicId, { approved, reason }) {
  const product = await queryOne(
    `SELECT p.id, p.status, p.name, s.status AS seller_status, s.store_name,
            u.id AS owner_id, u.full_name AS owner_name, u.email AS owner_email
       FROM products p
       JOIN sellers s ON s.id = p.seller_id
       JOIN users u ON u.id = s.user_id
      WHERE p.public_id = ? AND p.deleted_at IS NULL`,
    [publicId],
  )
  if (!product) throw notFound('Product not found.')

  // Approving is a publish. Suspending a seller archives their live listings, but a listing
  // still sitting in the review queue is untouched by that — approving it afterwards would put
  // a suspended store back on the storefront through a door the suspension never closed.
  // Rejecting is always allowed: clearing the queue for a store that is not trading is fine.
  if (approved) assertSellerCanPublish(product.seller_status, product.store_name)

  if (approved) {
    await query(
      `UPDATE products
          SET status = 'active', rejected_reason = NULL,
              published_at = COALESCE(published_at, NOW(3)), updated_at = NOW(3)
        WHERE id = ?`,
      [product.id],
    )
  } else {
    if (!reason) throw badRequest('A rejection reason is required.', 'REASON_REQUIRED')
    await query(
      `UPDATE products SET status = 'rejected', rejected_reason = ?, updated_at = NOW(3) WHERE id = ?`,
      [reason, product.id],
    )
  }
  // Tell the seller either way. A rejection they never hear about is indistinguishable from
  // a listing still sitting in the queue.
  await messaging.send(approved ? 'product.approved' : 'product.rejected', {
    to: product.owner_email,
    userId: product.owner_id,
    variables: {
      sellerName: product.owner_name,
      productName: product.name,
      ...(reason ? { reason } : {}),
    },
  })

  return { previousStatus: product.status, status: approved ? 'active' : 'rejected' }
}

/** Change status directly (publish, archive, return to draft). */
export async function setProductStatus(publicId, status) {
  const product = await queryOne(
    `SELECT p.id, p.status, s.status AS seller_status, s.store_name
       FROM products p JOIN sellers s ON s.id = p.seller_id
      WHERE p.public_id = ? AND p.deleted_at IS NULL`,
    [publicId],
  )
  if (!product) throw notFound('Product not found.')
  // Same rule as approval: only a trading store's listing may be made live.
  if (status === 'active') assertSellerCanPublish(product.seller_status, product.store_name)

  await query(
    `UPDATE products
        SET status = ?,
            published_at = CASE WHEN ? = 'active' THEN COALESCE(published_at, NOW(3)) ELSE published_at END,
            updated_at = NOW(3)
      WHERE id = ?`,
    [status, status, product.id],
  )
  return { previousStatus: product.status, status }
}

/**
 * Soft-delete a product.
 *
 * Never a hard DELETE: `order_items` reference products historically, and removing the row
 * would break every past order that contained it. `deleted_at` is what every read path
 * already filters on.
 */
export async function deleteProduct(publicId) {
  const product = await queryOne(
    'SELECT id, seller_id, name FROM products WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!product) throw notFound('Product not found.')

  await withTransaction(async (connection) => {
    await connection.execute('UPDATE products SET deleted_at = NOW(3), updated_at = NOW(3) WHERE id = ?', [product.id])
    await connection.execute(
      'UPDATE sellers SET product_count = GREATEST(product_count - 1, 0) WHERE id = ?',
      [product.seller_id],
    )
  })
  return { name: product.name }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Every category with its product count, as a flat list plus parent linkage for the tree. */
export async function listCategories() {
  const rows = await query(
    `SELECT c.id, c.parent_id, c.slug, c.name, c.description, c.image_url, c.position,
            c.is_active, c.meta_title, c.meta_description, c.created_at,
            p.slug AS parent_slug, p.name AS parent_name,
            (SELECT COUNT(*) FROM products pr WHERE pr.category_id = c.id AND pr.deleted_at IS NULL) AS product_count
       FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id
      ORDER BY c.position, c.name`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    position: Number(row.position),
    isActive: Boolean(row.is_active),
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    parent: row.parent_id ? { id: String(row.parent_id), slug: row.parent_slug, name: row.parent_name } : null,
    productCount: Number(row.product_count),
    createdAt: row.created_at,
  }))
}

export async function createCategory(input) {
  const parentId = input.parentSlug ? await resolveId('categories', 'slug', input.parentSlug, 'Parent category') : null
  const slug = await uniqueSlug('categories', input.slug || input.name)

  await query(
    `INSERT INTO categories
       (parent_id, slug, name, description, image_url, position, is_active, meta_title, meta_description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      parentId, slug, input.name, input.description ?? null, input.imageUrl ?? null,
      input.position ?? 0, input.isActive === false ? 0 : 1,
      input.metaTitle ?? null, input.metaDescription ?? null,
    ],
  )
  return slug
}

export async function updateCategory(slug, input) {
  const category = await queryOne('SELECT id FROM categories WHERE slug = ?', [slug])
  if (!category) throw notFound('Category not found.')

  const sets = []
  const params = []
  const map = {
    name: 'name', description: 'description', imageUrl: 'image_url',
    position: 'position', metaTitle: 'meta_title', metaDescription: 'meta_description',
  }
  for (const [field, column] of Object.entries(map)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  if (input.isActive !== undefined) { sets.push('is_active = ?'); params.push(input.isActive ? 1 : 0) }
  if (input.parentSlug !== undefined) {
    const parentId = input.parentSlug ? await resolveId('categories', 'slug', input.parentSlug, 'Parent category') : null
    // A category that is its own ancestor makes the storefront's tree render infinitely.
    if (parentId === category.id) throw badRequest('A category cannot be its own parent.', 'INVALID_PARENT')
    sets.push('parent_id = ?'); params.push(parentId)
  }

  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')
  sets.push('updated_at = NOW(3)')
  await query(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, [...params, category.id])
  return slug
}

/**
 * Delete a category, but only when nothing depends on it.
 *
 * `products.category_id` is NOT NULL, so orphaning products is not merely undesirable — the
 * database would reject it. Failing with a clear message beats surfacing a foreign-key error.
 */
export async function deleteCategory(slug) {
  const category = await queryOne('SELECT id, name FROM categories WHERE slug = ?', [slug])
  if (!category) throw notFound('Category not found.')

  const [{ products }] = await query(
    'SELECT COUNT(*) AS products FROM products WHERE category_id = ? AND deleted_at IS NULL',
    [category.id],
  )
  if (Number(products) > 0) {
    throw conflict(`This category still has ${products} product${Number(products) === 1 ? '' : 's'}. Move them first.`, 'CATEGORY_NOT_EMPTY')
  }
  const [{ children }] = await query('SELECT COUNT(*) AS children FROM categories WHERE parent_id = ?', [category.id])
  if (Number(children) > 0) {
    throw conflict('This category still has subcategories. Remove them first.', 'CATEGORY_HAS_CHILDREN')
  }

  await query('DELETE FROM categories WHERE id = ?', [category.id])
  return { name: category.name }
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export async function listBrands() {
  const rows = await query(
    `SELECT b.id, b.slug, b.name, b.description, b.logo_url, b.is_active, b.created_at,
            (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id AND p.deleted_at IS NULL) AS product_count
       FROM brands b ORDER BY b.name`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    logoUrl: row.logo_url,
    isActive: Boolean(row.is_active),
    productCount: Number(row.product_count),
    createdAt: row.created_at,
  }))
}

export async function createBrand(input) {
  const slug = await uniqueSlug('brands', input.slug || input.name)
  await query(
    `INSERT INTO brands (slug, name, description, logo_url, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [slug, input.name, input.description ?? null, input.logoUrl ?? null, input.isActive === false ? 0 : 1],
  )
  return slug
}

export async function updateBrand(slug, input) {
  const brand = await queryOne('SELECT id FROM brands WHERE slug = ?', [slug])
  if (!brand) throw notFound('Brand not found.')

  const sets = []
  const params = []
  const map = { name: 'name', description: 'description', logoUrl: 'logo_url' }
  for (const [field, column] of Object.entries(map)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  if (input.isActive !== undefined) { sets.push('is_active = ?'); params.push(input.isActive ? 1 : 0) }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE brands SET ${sets.join(', ')} WHERE id = ?`, [...params, brand.id])
  return slug
}

export async function deleteBrand(slug) {
  const brand = await queryOne('SELECT id, name FROM brands WHERE slug = ?', [slug])
  if (!brand) throw notFound('Brand not found.')

  // brand_id is nullable, so products survive their brand being removed — but silently
  // un-branding a catalogue is a surprise, so it is refused rather than cascaded.
  const [{ products }] = await query(
    'SELECT COUNT(*) AS products FROM products WHERE brand_id = ? AND deleted_at IS NULL',
    [brand.id],
  )
  if (Number(products) > 0) {
    throw conflict(`This brand is used by ${products} product${Number(products) === 1 ? '' : 's'}.`, 'BRAND_IN_USE')
  }

  await query('DELETE FROM brands WHERE id = ?', [brand.id])
  return { name: brand.name }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/**
 * Stock across the marketplace, lowest first — the order an admin actually wants, since the
 * reason to open this page is to find what is about to run out.
 */
export async function listInventory({ page = 1, pageSize = 50, lowOnly = false, search, sellerId } = {}) {
  const where = ['p.deleted_at IS NULL']
  const params = []
  if (lowOnly) where.push('(i.quantity - i.reserved) <= i.low_stock_threshold')
  if (sellerId) { where.push('p.seller_id = ?'); params.push(sellerId) }
  if (search) { where.push('(p.name LIKE ? OR v.sku LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }

  const clause = `WHERE ${where.join(' AND ')}`
  const offset = (page - 1) * pageSize

  const rows = await query(
    `SELECT v.id AS variant_id, v.sku, v.name AS variant_name,
            p.public_id AS product_id, p.name AS product_name, p.slug AS product_slug, p.status,
            s.slug AS seller_slug, s.store_name AS seller_name,
            i.quantity, i.reserved, i.low_stock_threshold, i.allow_backorder, i.updated_at
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN sellers s ON s.id = p.seller_id
       JOIN inventory i ON i.variant_id = v.id
       ${clause}
      ORDER BY (i.quantity - i.reserved) ASC, p.name ASC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN inventory i ON i.variant_id = v.id
       ${clause}`,
    params,
  )

  return {
    items: rows.map((row) => {
      const available = Number(row.quantity) - Number(row.reserved)
      return {
        variantId: String(row.variant_id),
        sku: row.sku,
        variantName: row.variant_name,
        product: { id: row.product_id, name: row.product_name, slug: row.product_slug, status: row.status },
        seller: { slug: row.seller_slug, name: row.seller_name },
        quantity: Number(row.quantity),
        reserved: Number(row.reserved),
        available,
        lowStockThreshold: Number(row.low_stock_threshold),
        allowBackorder: Boolean(row.allow_backorder),
        // Computed here so every consumer agrees on what "low" means.
        stockState: available <= 0 ? 'out-of-stock' : available <= Number(row.low_stock_threshold) ? 'low-stock' : 'in-stock',
        updatedAt: row.updated_at,
      }
    }),
    total: Number(total),
  }
}

export async function updateInventory(variantId, input) {
  const variant = await queryOne(
    `SELECT v.id, v.sku, i.quantity FROM product_variants v
       JOIN inventory i ON i.variant_id = v.id WHERE v.id = ?`,
    [variantId],
  )
  if (!variant) throw notFound('Variant not found.')

  const sets = []
  const params = []
  if (input.quantity !== undefined) { sets.push('quantity = ?'); params.push(input.quantity) }
  if (input.lowStockThreshold !== undefined) { sets.push('low_stock_threshold = ?'); params.push(input.lowStockThreshold) }
  if (input.allowBackorder !== undefined) { sets.push('allow_backorder = ?'); params.push(input.allowBackorder ? 1 : 0) }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE inventory SET ${sets.join(', ')} WHERE variant_id = ?`, [...params, variantId])
  return { sku: variant.sku, previousQuantity: Number(variant.quantity) }
}
