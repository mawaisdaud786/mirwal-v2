import { query, queryOne, pool } from '../../db/pool.js'
import { notFound } from '../../lib/errors.js'
import { listProductsByIds } from '../catalog/catalog.service.js'

/**
 * Wishlist — real, per-account, server-owned.
 *
 * Every function here scopes on the `userId` the caller's verified token resolved to. There
 * is no endpoint that accepts a user id, so "read or edit someone else's wishlist" is not a
 * request that can be made — the same rule the seller and address modules follow.
 *
 * Products are resolved through catalog.service.listProductsByIds, so a wishlist row renders
 * with the same real price, stock and rating as anywhere else in the app, and a product that
 * has since been delisted simply stops appearing.
 */

/** Internal id for a public product slug. Kept private: the API only ever speaks slugs. */
async function resolveProductId(slug) {
  const row = await queryOne(
    "SELECT id FROM products WHERE slug = ? AND status = 'active' AND deleted_at IS NULL",
    [slug],
  )
  if (!row) throw notFound('Product not found.', 'PRODUCT_NOT_FOUND')
  return row.id
}

export async function listWishlist(userId) {
  const rows = await query(
    'SELECT product_id FROM wishlist_items WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  const products = await listProductsByIds(rows.map((row) => row.product_id))
  return { items: products, count: products.length }
}

/**
 * Idempotent by design: the unique key on (user_id, product_id) means saving something
 * already saved is a no-op rather than a duplicate row or an error, so a double-click or a
 * retried request behaves the way the shopper expects.
 */
export async function addToWishlist(userId, slug) {
  const productId = await resolveProductId(slug)
  await pool.execute(
    'INSERT INTO wishlist_items (user_id, product_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
    [userId, productId],
  )
  return listWishlist(userId)
}

export async function removeFromWishlist(userId, slug) {
  const productId = await resolveProductId(slug)
  // The user_id predicate is the ownership check: a product id belonging to someone else's
  // row simply matches nothing, so there is no way to delete another account's entry.
  await pool.execute('DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?', [userId, productId])
  return listWishlist(userId)
}
