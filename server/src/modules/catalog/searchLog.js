import { randomUUID } from 'node:crypto'
import { query } from '../../db/pool.js'

/**
 * Records what shoppers search for.
 *
 * Written on the way out of `/products?search=` and the assistant, so the numbers on the
 * admin search pages are actual searches rather than an estimate. Before this existed there
 * was nothing to report on, which is why those pages could only say so.
 *
 * Three deliberate limits on what is kept:
 *
 *  - No IP address, user agent or session id. A signed-in shopper's id is recorded because
 *    it is already known; an anonymous search stays anonymous, and no visitor is stitched
 *    together across searches.
 *  - Recording never blocks or fails a search. A logging error must not turn a working
 *    product listing into a 500, so failures are swallowed after being surfaced to stderr.
 *  - Terms are capped and normalised, never stored twice in different shapes.
 */

const MAX_TERM = 200

/** Lower-case, whitespace-collapsed, so "Blue  LAMP" and "blue lamp" group together. */
export const normaliseTerm = (term) => String(term).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_TERM)

/**
 * Log one search. Returns the row's public id so a later product open can be attributed to
 * it, or null when nothing was recorded.
 *
 * Deliberately not awaited by its callers: the shopper is waiting for products, not for an
 * insert into a reporting table.
 */
export async function recordSearch({ term, source = 'search', userId = null, resultCount = 0, durationMs = 0 }) {
  const trimmed = String(term ?? '').trim().slice(0, MAX_TERM)
  if (!trimmed) return null

  const publicId = randomUUID()
  try {
    await query(
      `INSERT INTO search_queries (public_id, term, normalised, source, user_id, result_count, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [publicId, trimmed, normaliseTerm(trimmed), source, userId, resultCount, Math.round(durationMs)],
    )
    return publicId
  } catch (error) {
    console.error('[search-log] could not record search:', error.message)
    return null
  }
}

/**
 * Attribute a product open to the search that led to it.
 *
 * `clicked_product_id IS NULL` in the WHERE clause keeps the first click as the one that
 * counts — a shopper reopening the same result should not inflate the click-through rate.
 */
export async function recordSearchClick(searchPublicId, productPublicId) {
  if (!searchPublicId || !productPublicId) return
  try {
    await query(
      `UPDATE search_queries
          SET clicked_product_id = (SELECT id FROM products WHERE public_id = ?),
              clicked_at = NOW(3)
        WHERE public_id = ? AND clicked_product_id IS NULL`,
      [productPublicId, searchPublicId],
    )
  } catch (error) {
    console.error('[search-log] could not record click:', error.message)
  }
}
