import { randomUUID } from 'node:crypto'
import { query, queryOne, pool } from '../../db/pool.js'
import { notFound, badRequest, conflict } from '../../lib/errors.js'
import { recomputeProductRating, recomputeSellerRating } from './moderation.service.js'

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
 * The cached rating is recomputed by `moderation.service.js`, not here.
 *
 * There used to be a copy of that arithmetic in this file, counting every review row. Once a
 * review could be hidden or removed (migration 023) the two definitions disagreed: this one
 * would have kept a hidden review inside the average, so a product could display 4.8 from
 * reviews a shopper cannot find — which is precisely the manipulation moderation exists to
 * undo. One definition, imported.
 */

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

  /**
   * Published reviews only.
   *
   * Since migration 023 a review can be hidden or removed by a moderator. Every read path has
   * to filter on that, including the histogram — a breakdown that counts a review a shopper
   * cannot find makes the rating unexplainable, and is exactly the manipulation moderation
   * exists to undo.
   */
  const [rows, breakdown] = await Promise.all([
    query(
      `SELECT r.public_id, r.rating, r.title, r.body, r.created_at, r.helpful_count,
              u.full_name,
              resp.body AS response_body, resp.created_at AS response_at,
              s.store_name AS response_store
         FROM product_reviews r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN review_responses resp
                ON resp.review_id = r.id AND resp.status = 'published'
         LEFT JOIN sellers s ON s.id = resp.seller_id
        WHERE r.product_id = ? AND r.status = 'published'
        ORDER BY r.helpful_count DESC, r.created_at DESC LIMIT 50`,
      [product.id],
    ),
    query(
      "SELECT rating, COUNT(*) AS count FROM product_reviews WHERE product_id = ? AND status = 'published' GROUP BY rating",
      [product.id],
    ),
  ])

  // Always all five buckets, so a histogram renders without the client inventing the zeroes.
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const row of breakdown) counts[row.rating] = Number(row.count)

  return {
    reviews: rows.map((row) => ({
      ...shapeReview(row),
      helpfulCount: Number(row.helpful_count ?? 0),
      // The seller's public answer, shown under the review it replies to.
      sellerResponse: row.response_body
        ? { body: row.response_body, storeName: row.response_store, at: row.response_at }
        : null,
    })),
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

export async function createReview(userId, { orderItemId, rating, title, body }, { ip = null } = {}) {
  // Scoped to this buyer's own order: an order_item id belonging to anyone else simply is
  // not found, so there is no way to review a product someone else bought.
  const item = await queryOne(
    `SELECT oi.id, oi.product_id, oi.status, oi.seller_id
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

  /**
   * `submitted_ip` is captured here and nowhere else.
   *
   * Several accounts reviewing one store from a single address is the clearest self-review
   * signal a marketplace has, and it cannot be reconstructed after the fact — which is why it
   * is recorded at write time even though nothing reads it until a moderator asks.
   */
  await pool.execute(
    `INSERT INTO product_reviews
       (public_id, product_id, user_id, order_item_id, rating, title, body, submitted_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, INET6_ATON(?))`,
    [randomUUID(), item.product_id, userId, item.id, rating, title ?? '', body, ip],
  )
  await recomputeProductRating(item.product_id)
  await recomputeSellerRating(item.seller_id)

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
/**
 * Every review on the marketplace, for staff.
 *
 * Took no arguments and returned a hard `LIMIT 200` — so on a marketplace with more reviews
 * than that, the ones past the cap were unreachable from the panel entirely, and the summary
 * counts underneath described the whole table while the list described the first two hundred.
 *
 * `rating` filters to a single star value and `needsAttention` to the one- and two-star reviews
 * that are actually worth a moderator's time.
 */
export async function listForAdmin({ page = 1, pageSize = 25, search = '', rating, needsAttention = false } = {}) {
  const where = []
  const params = []

  if (search) {
    where.push('(p.name LIKE ? OR u.full_name LIKE ? OR r.title LIKE ? OR r.body LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  if (rating) { where.push('r.rating = ?'); params.push(rating) }
  // Deliberately separate from `rating`: "needs attention" is a judgement about which reviews
  // are worth opening, not a filter on a number.
  if (needsAttention) where.push('r.rating <= 2')

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [rows, [{ total }], [aggregate]] = await Promise.all([
    query(
      `SELECT r.public_id, r.rating, r.title, r.body, r.created_at, u.full_name,
              u.public_id AS author_public_id,
              p.public_id AS product_public_id, p.name AS product_name, p.slug AS product_slug,
              s.public_id AS seller_public_id, s.store_name AS seller_name
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN sellers s ON s.id = p.seller_id
         JOIN users u ON u.id = r.user_id
         ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    query(
      `SELECT COUNT(*) AS total
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN users u ON u.id = r.user_id
         ${whereSql}`,
      params,
    ),
    // The summary describes every review, not the filtered page: it is the context a moderator
    // reads the page against.
    query(
      `SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average,
              SUM(rating <= 2) AS needs_attention
         FROM product_reviews`,
    ),
  ])

  return {
    reviews: rows.map((row) => ({
      ...shapeReview(row),
      // Ids, so the product, the store and the author are all reachable from a row.
      productId: row.product_public_id,
      productName: row.product_name,
      productSlug: row.product_slug,
      sellerId: row.seller_public_id,
      sellerName: row.seller_name,
      authorId: row.author_public_id,
    })),
    total: Number(total),
    summary: {
      count: Number(aggregate.count),
      average: Number(Number(aggregate.average).toFixed(2)),
      needsAttention: Number(aggregate.needs_attention),
    },
  }
}

/** A seller's reviews across their own products — the seller panel's Reviews page. */
/**
 * A store's reviews across its own products.
 *
 * Returned every review the store had ever received and computed the summary in JavaScript by
 * counting the array — which meant the figures only ever described what had been fetched.
 * Both the page and the summary come from the database now.
 */
export async function listForSeller(sellerId, { page = 1, pageSize = 25, rating, needsAttention = false } = {}) {
  const where = ['p.seller_id = ?']
  const params = [sellerId]
  if (rating) { where.push('r.rating = ?'); params.push(rating) }
  if (needsAttention) where.push('r.rating <= 2')
  const whereSql = where.join(' AND ')

  const [rows, [{ total }], [aggregate]] = await Promise.all([
    query(
      `SELECT r.public_id, r.rating, r.title, r.body, r.created_at, u.full_name,
              p.public_id AS product_public_id, p.name AS product_name, p.slug AS product_slug
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN users u ON u.id = r.user_id
        WHERE ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    query(
      `SELECT COUNT(*) AS total FROM product_reviews r
         JOIN products p ON p.id = r.product_id
        WHERE ${whereSql}`,
      params,
    ),
    query(
      `SELECT COUNT(*) AS count, COALESCE(AVG(r.rating), 0) AS average,
              SUM(r.rating <= 2) AS needs_attention
         FROM product_reviews r JOIN products p ON p.id = r.product_id
        WHERE p.seller_id = ?`,
      [sellerId],
    ),
  ])

  return {
    reviews: rows.map((row) => ({
      ...shapeReview(row),
      productId: row.product_public_id,
      productName: row.product_name,
      productSlug: row.product_slug,
    })),
    total: Number(total),
    summary: {
      count: Number(aggregate.count),
      // Averaged across this seller's real reviews only — never a platform-wide figure
      // presented as if it were the seller's own.
      average: Number(Number(aggregate.average).toFixed(2)),
      needsAttention: Number(aggregate.needs_attention),
    },
  }
}
