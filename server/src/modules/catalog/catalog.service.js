import { query, queryOne } from '../../db/pool.js'
import { notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { parseJsonColumn } from '../../lib/json.js'

/**
 * Catalog read services.
 *
 * Two rules run through all of this:
 *
 * 1. Only `status = 'active'` products are ever visible publicly. Draft, pending-review,
 *    rejected and archived products belong to their seller and to admins, never to the
 *    storefront.
 *
 * 2. Money crosses the boundary as a string, not a float — see lib/money.js. The frontend
 *    previously carried "Rs. 202,000" and re-parsed it with a regex in six places — this
 *    replaces that without reintroducing float rounding.
 */

/** Shape a product row for the API. Never leaks cost_price or internal ids. */
function shapeProduct(row, images = [], saleTags = []) {
  const price = formatMoney(row.price, row.currency_code)
  const compareAt = formatMoney(row.compare_at_price, row.currency_code)
  const discountPercent = row.compare_at_price
    ? Math.round(((Number(row.compare_at_price) - Number(row.price)) / Number(row.compare_at_price)) * 100)
    : null

  return {
    id: row.public_id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description ?? null,
    price,
    compareAtPrice: compareAt,
    discountPercent,
    saleTags,
    condition: row.condition_type,
    rating: {
      // Real aggregates only. Zero reviews reads as zero, never as a flattering default.
      average: Number(row.rating_average),
      count: row.rating_count,
    },
    category: row.category_slug ? { slug: row.category_slug, name: row.category_name } : null,
    brand: row.brand_slug ? { slug: row.brand_slug, name: row.brand_name } : null,
    seller: row.seller_slug ? { slug: row.seller_slug, name: row.seller_store_name } : null,
    availability: {
      inStock: Number(row.sellable ?? 0) > 0,
      // Deliberately not the exact count: exposing stock invites scraping, and the audit
      // found the UI hard-coding "Only 8 items left!" as false urgency.
      lowStock: Number(row.sellable ?? 0) > 0 && Number(row.sellable) <= Number(row.low_stock_threshold ?? 5),
    },
    images: images.map((image) => ({
      url: image.url,
      alt: image.alt_text || row.name,
      width: image.width,
      height: image.height,
    })),
    publishedAt: row.published_at,
  }
}

/**
 * The seller-side half of "is this listing buyable".
 *
 * `products.status = 'active'` is not sufficient on its own. Suspending a seller archives
 * their live products in the same transaction (admin/sellers.service.js), which is correct —
 * but it is a single write, and a listing can become active again afterwards by a route that
 * knows nothing about the seller: approving a queued product, or an admin publishing one
 * directly. A rejected, banned, closed or soft-deleted seller is never archived at all.
 *
 * So the storefront asserts it on every read as well. Two independent layers, and the query
 * is the one that cannot be bypassed by a later status change.
 */
const SELLER_IS_TRADING = "s.status = 'approved' AND s.deleted_at IS NULL"

/**
 * The same rule for queries that do not already join `sellers` — facet counts, category and
 * brand tallies, and id-based lookups. An EXISTS keeps those queries' shapes untouched, and
 * costs one index seek per row against sellers' primary key.
 */
const sellerTrading = (alias = 'p') =>
  `EXISTS (SELECT 1 FROM sellers st WHERE st.id = ${alias}.seller_id
             AND st.status = 'approved' AND st.deleted_at IS NULL)`

const PRODUCT_SELECT = `
  SELECT p.id, p.public_id, p.slug, p.name, p.subtitle, p.description,
         p.currency_code, p.price, p.compare_at_price, p.condition_type,
         p.rating_average, p.rating_count, p.published_at,
         c.slug AS category_slug, c.name AS category_name,
         b.slug AS brand_slug,    b.name AS brand_name,
         s.slug AS seller_slug,   s.store_name AS seller_store_name,
         COALESCE(SUM(GREATEST(i.quantity - i.reserved, 0)), 0) AS sellable,
         MIN(i.low_stock_threshold) AS low_stock_threshold
    FROM products p
    JOIN categories c ON c.id = p.category_id
    JOIN sellers    s ON s.id = p.seller_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
    LEFT JOIN inventory i ON i.variant_id = v.id
`

/** Attach images to many products in one query — avoids an N+1 per card. */
async function withImages(rows) {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(',')
  const [images, promotions] = await Promise.all([query(
    `SELECT product_id, url, alt_text, width, height
       FROM product_images
      WHERE product_id IN (${placeholders})
      ORDER BY product_id, position, id`,
    ids,
  ), query(
    `SELECT DISTINCT pp.product_id, p.kind, p.name
       FROM promotion_products pp JOIN promotions p ON p.id = pp.promotion_id
      WHERE pp.product_id IN (${placeholders}) AND p.status = 'active' AND p.deleted_at IS NULL
        AND (p.starts_at IS NULL OR p.starts_at <= CURRENT_TIMESTAMP(3))
        AND (p.ends_at IS NULL OR p.ends_at > CURRENT_TIMESTAMP(3))
      ORDER BY pp.product_id, p.priority DESC, p.name`,
    ids,
  )])
  const byProduct = new Map()
  for (const image of images) {
    if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, [])
    byProduct.get(image.product_id).push(image)
  }
  const byProductSale = new Map()
  for (const promotion of promotions) {
    if (!byProductSale.has(promotion.product_id)) byProductSale.set(promotion.product_id, [])
    byProductSale.get(promotion.product_id).push({ kind: promotion.kind, name: promotion.name })
  }
  return rows.map((row) => shapeProduct(row, byProduct.get(row.id) ?? [], byProductSale.get(row.id) ?? []))
}

const SORTS = {
  recommended: 'p.rating_average DESC, p.rating_count DESC, p.id DESC',
  newest: 'p.published_at DESC, p.id DESC',
  'price-low': 'p.price ASC, p.id ASC',
  'price-high': 'p.price DESC, p.id DESC',
  rating: 'p.rating_average DESC, p.rating_count DESC, p.id DESC',
}

/**
 * Faceted product listing.
 *
 * The filter set mirrors what ExplorePage already sends, so the existing UI can be pointed
 * at this without redesigning it: q, category, brand, minPrice, maxPrice, rating,
 * availability, sort, page.
 */
export async function listProducts(params) {
  const {
    q, category, brand, type, seller, saleType, minPrice, maxPrice, rating, minDiscount,
    availability, sort = 'recommended', page = 1, pageSize = 24,
  } = params

  const where = ["p.status = 'active'", 'p.deleted_at IS NULL', SELLER_IS_TRADING]
  const args = []

  if (q) {
    // Prefix-boolean FULLTEXT so partial words still match while typing.
    where.push('MATCH(p.name, p.subtitle, p.description) AGAINST (? IN BOOLEAN MODE)')
    args.push(q.split(/\s+/).filter(Boolean).map((term) => `+${term.replace(/[+\-><()~*"@]/g, '')}*`).join(' '))
  }
  if (category?.length) { where.push(`c.slug IN (${category.map(() => '?').join(',')})`); args.push(...category) }
  if (brand?.length)    { where.push(`b.slug IN (${brand.map(() => '?').join(',')})`);    args.push(...brand) }
  if (seller)           { where.push('s.slug = ?'); args.push(seller) }
  if (minPrice != null) { where.push('p.price >= ?'); args.push(minPrice) }
  if (maxPrice != null) { where.push('p.price <= ?'); args.push(maxPrice) }
  if (rating != null)   { where.push('p.rating_average >= ?'); args.push(rating) }
  // `subtitle` is the product "type" the storefront facets on (Smartphone, Laptop, ...).
  if (type?.length)     { where.push(`p.subtitle IN (${type.map(() => '?').join(',')})`); args.push(...type) }
  if (saleType) {
    where.push(`EXISTS (
      SELECT 1 FROM promotions promo
       WHERE promo.kind = ? AND promo.status = 'active' AND promo.deleted_at IS NULL
         AND (promo.starts_at IS NULL OR promo.starts_at <= CURRENT_TIMESTAMP(3))
         AND (promo.ends_at IS NULL OR promo.ends_at > CURRENT_TIMESTAMP(3))
         AND (NOT EXISTS (SELECT 1 FROM promotion_products scoped WHERE scoped.promotion_id = promo.id)
           OR EXISTS (SELECT 1 FROM promotion_products linked WHERE linked.promotion_id = promo.id AND linked.product_id = p.id))
    )`)
    args.push(saleType)
  }
  // Minimum discount percent. Also powers the "On sale" facet, which is minDiscount >= 1.
  // Rounded the same way shapeProduct() rounds discountPercent for display — otherwise a
  // product shown as "30% OFF" (a true discount of 29.69%, rounded up) fails a ">= 30" filter.
  if (minDiscount != null) {
    where.push('p.compare_at_price IS NOT NULL AND ROUND((p.compare_at_price - p.price) / p.compare_at_price * 100) >= ?')
    args.push(minDiscount)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const having = availability === 'in-stock' ? 'HAVING sellable > 0' : ''
  const orderBy = SORTS[sort] ?? SORTS.recommended
  const offset = (page - 1) * pageSize

  const rows = await query(
    `${PRODUCT_SELECT} ${whereSql}
      GROUP BY p.id ${having}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    [...args, pageSize, offset],
  )

  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total FROM (
       SELECT p.id, COALESCE(SUM(GREATEST(i.quantity - i.reserved, 0)) , 0) AS sellable
         FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN sellers    s ON s.id = p.seller_id
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
         LEFT JOIN inventory i ON i.variant_id = v.id
       ${whereSql}
       GROUP BY p.id ${having}
     ) AS matched`,
    args,
  )

  return { items: await withImages(rows), page, pageSize, total: Number(totalRow.total) }
}

/**
 * Facet values available across the live catalogue, with counts.
 *
 * Explore previously derived its brand list from a hard-coded array and its type list from
 * `product.type`, which produced filter values that matched nothing. These come from the
 * data, so every option shown returns at least one result.
 */
export async function getFacets() {
  const [categories, brands, types, saleTypes, bounds] = await Promise.all([
    query(`SELECT c.slug, c.name, COUNT(*) AS count
             FROM products p JOIN categories c ON c.id = p.category_id
            WHERE p.status = 'active' AND p.deleted_at IS NULL AND ${sellerTrading()}
            GROUP BY c.id ORDER BY c.name`),
    query(`SELECT b.slug, b.name, COUNT(*) AS count
             FROM products p JOIN brands b ON b.id = p.brand_id
            WHERE p.status = 'active' AND p.deleted_at IS NULL AND ${sellerTrading()}
            GROUP BY b.id ORDER BY count DESC, b.name`),
    query(`SELECT p.subtitle AS value, COUNT(*) AS count
             FROM products p
            WHERE p.status = 'active' AND p.deleted_at IS NULL AND p.subtitle <> ''
              AND ${sellerTrading()}
            GROUP BY p.subtitle ORDER BY count DESC, p.subtitle`),
    query(`SELECT kind, MIN(name) AS name
             FROM promotions
            WHERE status = 'active' AND deleted_at IS NULL
              AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP(3))
              AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3))
            GROUP BY kind ORDER BY MIN(priority) DESC, kind`),
    queryOne(`SELECT MIN(price) AS min_price, MAX(price) AS max_price
                FROM products WHERE status = 'active' AND deleted_at IS NULL`),
  ])

  return {
    categories: categories.map((r) => ({ slug: r.slug, name: r.name, count: Number(r.count) })),
    brands: brands.map((r) => ({ slug: r.slug, name: r.name, count: Number(r.count) })),
    types: types.map((r) => ({ value: r.value, count: Number(r.count) })),
    saleTypes: saleTypes.map((r) => ({ kind: r.kind, name: r.name })),
    price: { min: Number(bounds?.min_price ?? 0), max: Number(bounds?.max_price ?? 0) },
  }
}

export async function getProductBySlug(slug) {
  const row = await queryOne(
    `${PRODUCT_SELECT}
      WHERE p.slug = ? AND p.status = 'active' AND p.deleted_at IS NULL
        AND ${SELLER_IS_TRADING}
      GROUP BY p.id`,
    [slug],
  )
  if (!row) throw notFound('Product not found.', 'PRODUCT_NOT_FOUND')

  const [shaped] = await withImages([row])
  const variants = await query(
    `SELECT v.id, v.sku, v.name, v.options, v.price,
            COALESCE(GREATEST(i.quantity - i.reserved, 0), 0) AS sellable
       FROM product_variants v
       LEFT JOIN inventory i ON i.variant_id = v.id
      WHERE v.product_id = ? AND v.is_active = 1
      ORDER BY v.position, v.id`,
    [row.id],
  )

  return {
    ...shaped,
    variants: variants.map((variant) => ({
      sku: variant.sku,
      name: variant.name,
      // MariaDB's JSON is LONGTEXT, so it arrives as a string and is parsed here.
      options: parseJsonColumn(variant.options),
      price: variant.price ? formatMoney(variant.price, row.currency_code) : shaped.price,
      inStock: Number(variant.sellable) > 0,
    })),
  }
}

/**
 * Products by internal id, in the order the ids were given.
 *
 * Exists so a module that already knows *which* products it wants (the wishlist, which
 * stores product ids) reuses this module's shaping — same price/stock/rating rules, same
 * excluded columns — instead of writing a second, drifting copy of PRODUCT_SELECT.
 * Inactive or deleted products are dropped, so a wishlist never renders a delisted product.
 */
export async function listProductsByIds(ids) {
  if (ids.length === 0) return []
  const rows = await query(
    `${PRODUCT_SELECT}
      WHERE p.id IN (${ids.map(() => '?').join(',')})
        AND p.status = 'active' AND p.deleted_at IS NULL
        AND ${SELLER_IS_TRADING}
      GROUP BY p.id`,
    ids,
  )
  const shaped = await withImages(rows)
  const byId = new Map(shaped.map((product, index) => [String(rows[index].id), product]))
  return ids.map((id) => byId.get(String(id))).filter(Boolean)
}

export async function listCategories() {
  const rows = await query(
    `SELECT c.id, c.parent_id, c.slug, c.name, c.description, c.image_url,
            COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
                           AND p.deleted_at IS NULL AND ${sellerTrading()}
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.position, c.name`,
  )

  const byId = new Map(rows.map((row) => [row.id, {
    slug: row.slug, name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    productCount: Number(row.product_count),
    children: [],
  }]))

  const roots = []
  for (const row of rows) {
    if (row.parent_id && byId.has(row.parent_id)) byId.get(row.parent_id).children.push(byId.get(row.id))
    else roots.push(byId.get(row.id))
  }
  return roots
}

export async function getCategoryBySlug(slug) {
  const row = await queryOne(
    `SELECT slug, name, description, image_url, meta_title, meta_description
       FROM categories WHERE slug = ? AND is_active = 1`,
    [slug],
  )
  if (!row) throw notFound('Category not found.', 'CATEGORY_NOT_FOUND')
  return {
    slug: row.slug, name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    meta: { title: row.meta_title, description: row.meta_description },
  }
}

export async function listBrands() {
  const rows = await query(
        `SELECT b.slug, b.name, b.logo_url,
          (SELECT pi.url FROM product_images pi
            JOIN products bp ON bp.id = pi.product_id
           WHERE bp.brand_id = b.id AND bp.status = 'active' AND bp.deleted_at IS NULL
             AND ${sellerTrading('bp')}
           ORDER BY pi.position, pi.id LIMIT 1) AS image_url,
          COUNT(p.id) AS product_count
       FROM brands b
       LEFT JOIN products p ON p.brand_id = b.id AND p.status = 'active'
                           AND p.deleted_at IS NULL AND ${sellerTrading()}
      WHERE b.is_active = 1
      GROUP BY b.id
      ORDER BY b.name`,
  )
  return rows.map((row) => ({
    slug: row.slug, name: row.name,
    logoUrl: row.logo_url ?? null,
    imageUrl: row.image_url ?? null,
    productCount: Number(row.product_count),
  }))
}

export async function listSellers() {
  const rows = await query(
        `SELECT s.slug, s.store_name, s.description, s.logo_url, s.city,
          (SELECT pi.url FROM product_images pi
            JOIN products sp ON sp.id = pi.product_id
           WHERE sp.seller_id = s.id AND sp.status = 'active' AND sp.deleted_at IS NULL
           ORDER BY pi.position, pi.id LIMIT 1) AS image_url,
            s.rating_average, s.rating_count,
            COUNT(p.id) AS product_count
       FROM sellers s
       LEFT JOIN products p ON p.seller_id = s.id AND p.status = 'active' AND p.deleted_at IS NULL
      WHERE s.status = 'approved' AND s.deleted_at IS NULL
      GROUP BY s.id
      ORDER BY s.store_name`,
  )
  return rows.map((row) => ({
    slug: row.slug,
    name: row.store_name,
    description: row.description ?? null,
    logoUrl: row.logo_url ?? null,
    imageUrl: row.image_url ?? null,
    city: row.city ?? null,
    rating: { average: Number(row.rating_average), count: row.rating_count },
    productCount: Number(row.product_count),
  }))
}

export async function getSellerBySlug(slug) {
  const row = await queryOne(
    `SELECT slug, store_name, description, logo_url, banner_url, city,
            (SELECT pi.url FROM product_images pi
              JOIN products sp ON sp.id = pi.product_id
             WHERE sp.seller_id = s.id AND sp.status = 'active' AND sp.deleted_at IS NULL
             ORDER BY pi.position, pi.id LIMIT 1) AS image_url,
            rating_average, rating_count, created_at
      FROM sellers s
          WHERE slug = ? AND status = 'approved' AND deleted_at IS NULL`,
    [slug],
  )
  if (!row) throw notFound('Store not found.', 'SELLER_NOT_FOUND')
  return {
    slug: row.slug,
    name: row.store_name,
    description: row.description ?? null,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    imageUrl: row.image_url ?? null,
    city: row.city ?? null,
    rating: { average: Number(row.rating_average), count: row.rating_count },
    memberSince: row.created_at,
  }
}
