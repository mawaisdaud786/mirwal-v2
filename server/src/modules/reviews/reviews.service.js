import { randomUUID } from 'node:crypto'
import { query, queryOne, pool } from '../../db/pool.js'
import { notFound, badRequest, conflict } from '../../lib/errors.js'

/**
 * Product reviews — verified purchase only.
 *
 * This is what makes `products.rating_average` / `rating_count` honest. Those columns have
 * been rendered as real buyer ratings across the whole app since the catalog was built, but
 * nothing except the seeder ever wrote them. Now every rating shown anywhere is recomputed
 * from rows in `product_reviews`, and a row can only exist if the reviewer's own delivered
 * `order_items` record says they actually bought and received that product.
 *
 * The three rules, all enforced server-side:
 *   1. You reviewed something you bought — the order item is looked up scoped to req.user.id.
 *   2. You received it — only `delivered` items qualify.
 *   3. Once per item — a unique key on order_item_id, so ratings can't be inflated by
 *      resubmitting.
 */

/**
 * Recomputes a product's cached rating from its real reviews.
 *
 * The aggregate is cached on `products` (rather than computed per query) because every
 * product card, sort and filter reads it — but it is only ever written from here, so the
 * cache can never drift away from the reviews that justify it. A product whose last review
 * is deleted correctly falls back to 0/0 rather than keeping a stale average.
 */
async function recomputeProductRating(productId) {
  await pool.execute(
    `UPDATE products p
        SET p.rating_average = COALESCE((SELECT ROUND(AVG(r.rating), 2) FROM product_reviews r WHERE r.product_id = p.id), 0),
            p.rating_count   = (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id)
      WHERE p.id = ?`,
    [productId],
  )
}

function shapeReview(row) {
  return {
    id: row.public_id,
    rating: Number(row.rating),
    title: row.title,
    body: row.body,
    // First name only. A review is public, and the full name on the account is not something
    // the buyer chose to publish alongside it.
    author: String(row.full_name || '').split(' ')[0] || 'Mirwal buyer',
    // Every review in this table is purchase-backed, so this is a statement of fact rather
    // than a badge some reviews earn and others don't.
    verifiedPurchase: true,
    createdAt: row.created_at,
  }
}

/** Public: the review list for a product, newest first, plus its real rating breakdown. */
export async function listForProduct(slug) {
  const product = await queryOne(
    "SELECT id, rating_average, rating_count FROM products WHERE slug = ? AND status = 'active' AND deleted_at IS NULL",
    [slug],
  )
  if (!product) throw notFound('Product not found.', 'PRODUCT_NOT_FOUND')

  const [rows, breakdown] = await Promise.all([
    query(
      `SELECT r.public_id, r.rating, r.title, r.body, r.created_at, u.full_name
         FROM product_reviews r JOIN users u ON u.id = r.user_id
        WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 50`,
      [product.id],
    ),
    query('SELECT rating, COUNT(*) AS count FROM product_reviews WHERE product_id = ? GROUP BY rating', [product.id]),
  ])

  // Always all five buckets, so a histogram renders without the client inventing the zeroes.
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const row of breakdown) counts[row.rating] = Number(row.count)

  return {
    reviews: rows.map(shapeReview),
    summary: {
      average: Number(product.rating_average),
      count: Number(product.rating_count),
      breakdown: counts,
    },
  }
}

/** The signed-in buyer's delivered items that they have not reviewed yet. */
export async function listReviewable(userId) {
  const rows = await query(
    `SELECT oi.id AS order_item_id, oi.product_name, o.order_number, oi.updated_at,
            p.slug, p.id AS product_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_reviews r ON r.order_item_id = oi.id
      WHERE o.buyer_id = ? AND oi.status = 'delivered' AND r.id IS NULL
      ORDER BY oi.updated_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    orderItemId: row.order_item_id,
    orderNumber: row.order_number,
    productName: row.product_name,
    productSlug: row.slug,
    deliveredAt: row.updated_at,
  }))
}

export async function createReview(userId, { orderItemId, rating, title, body }) {
  // Scoped to this buyer's own order: an order_item id belonging to anyone else simply is
  // not found, so there is no way to review a product someone else bought.
  const item = await queryOne(
    `SELECT oi.id, oi.product_id, oi.status
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = ? AND o.buyer_id = ?`,
    [orderItemId, userId],
  )
  if (!item) throw notFound('That order item was not found.', 'ORDER_ITEM_NOT_FOUND')
  if (item.status !== 'delivered') {
    throw badRequest('You can review a product once it has been delivered.', 'NOT_DELIVERED')
  }

  const existing = await queryOne('SELECT id FROM product_reviews WHERE order_item_id = ?', [item.id])
  if (existing) throw conflict('You have already reviewed this item.', 'ALREADY_REVIEWED')

  await pool.execute(
    'INSERT INTO product_reviews (public_id, product_id, user_id, order_item_id, rating, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), item.product_id, userId, item.id, rating, title ?? '', body],
  )
  await recomputeProductRating(item.product_id)

  const product = await queryOne('SELECT slug FROM products WHERE id = ?', [item.product_id])
  return listForProduct(product.slug)
}

/**
 * Every review platform-wide — the admin panel's Reviews page.
 *
 * The list is capped (most recent 200) so this stays a moderation feed rather than an
 * unbounded dump, but the summary is computed from ALL reviews via a separate aggregate
 * query — an admin's "average rating" / "needs attention" count must reflect the whole
 * platform, not just whichever page of rows happened to render.
 */
export async function listForAdmin() {
  const [rows, [aggregate]] = await Promise.all([
    query(
      `SELECT r.public_id, r.rating, r.title, r.body, r.created_at, u.full_name,
              p.name AS product_name, p.slug AS product_slug, s.store_name AS seller_name
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN sellers s ON s.id = p.seller_id
         JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC
        LIMIT 200`,
    ),
    query(
      `SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average,
              SUM(rating <= 2) AS needs_attention
         FROM product_reviews`,
    ),
  ])
  return {
    reviews: rows.map((row) => ({ ...shapeReview(row), productName: row.product_name, productSlug: row.product_slug, sellerName: row.seller_name })),
    summary: {
      count: Number(aggregate.count),
      average: Number(Number(aggregate.average).toFixed(2)),
      needsAttention: Number(aggregate.needs_attention),
    },
  }
}

/** A seller's reviews across their own products — the seller panel's Reviews page. */
export async function listForSeller(sellerId) {
  const rows = await query(
    `SELECT r.public_id, r.rating, r.title, r.body, r.created_at, u.full_name,
            p.name AS product_name, p.slug AS product_slug
       FROM product_reviews r
       JOIN products p ON p.id = r.product_id
       JOIN users u ON u.id = r.user_id
      WHERE p.seller_id = ?
      ORDER BY r.created_at DESC`,
    [sellerId],
  )

  const reviews = rows.map((row) => ({
    ...shapeReview(row),
    productName: row.product_name,
    productSlug: row.product_slug,
  }))

  const total = reviews.length
  return {
    reviews,
    summary: {
      count: total,
      // Averaged across this seller's real reviews only — never a platform-wide figure
      // presented as if it were the seller's own.
      average: total === 0 ? 0 : Number((reviews.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(2)),
      needsAttention: reviews.filter((r) => r.rating <= 2).length,
    },
  }
}
