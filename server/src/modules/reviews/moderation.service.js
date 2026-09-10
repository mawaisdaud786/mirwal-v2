import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { createNotification } from '../notifications/notifications.service.js'

/**
 * Review moderation, seller responses and helpfulness.
 *
 * Verified purchase was already enforced where it counts — `product_reviews.order_item_id` is
 * NOT NULL and UNIQUE, so there is no code path to an unverified review and no way to review
 * one purchase twice. That is the hard half and none of it changes here.
 *
 * Everything after it was missing. A review had no status, so a defamatory or fake one could
 * not be taken down; `AUDIT.REVIEW_DELETED` existed as a constant with no endpoint behind it;
 * a seller could read a review but never answer it; and nobody could report one.
 *
 * The rule that shapes this module: **hidden, not deleted.** A removed review keeps its row.
 * Deleting it would free the `order_item_id` and let the same buyer post again, destroy the
 * evidence behind a moderation decision, and make an appeal unanswerable. `status` does the
 * work, and every read path filters on it.
 */

export const MODERATION_CODES = {
  spam: 'Advertising or repeated content',
  offensive: 'Abusive or offensive language',
  personal_information: 'Contains personal information',
  off_topic: 'Not about this product',
  fake: 'Not a genuine customer experience',
  incentivised: 'Written in exchange for a payment, gift or discount',
  manipulation: 'Part of a pattern of review manipulation',
  other: 'Other — see the note',
}

/**
 * Recompute a product's rating from published reviews only.
 *
 * The single place this arithmetic lives. Once a review can be hidden, an aggregate computed
 * anywhere else will eventually include one that is not shown — and a product displaying 4.6
 * from reviews a shopper cannot find is worse than no rating at all.
 */
export async function recomputeProductRating(productId, connection = null) {
  const executor = connection ?? { execute: (sql, params) => query(sql, params) }
  await executor.execute(
    `UPDATE products p
        SET p.rating_average = COALESCE((
              SELECT ROUND(AVG(r.rating), 2) FROM product_reviews r
               WHERE r.product_id = p.id AND r.status = 'published'), 0),
            p.rating_count = (
              SELECT COUNT(*) FROM product_reviews r
               WHERE r.product_id = p.id AND r.status = 'published')
      WHERE p.id = ?`,
    [productId],
  )
}

/** And the store's, which is the average across its products' published reviews. */
export async function recomputeSellerRating(sellerId, connection = null) {
  const executor = connection ?? { execute: (sql, params) => query(sql, params) }
  await executor.execute(
    `UPDATE sellers s
        SET s.rating_average = COALESCE((
              SELECT ROUND(AVG(r.rating), 2)
                FROM product_reviews r JOIN products p ON p.id = r.product_id
               WHERE p.seller_id = s.id AND r.status = 'published'), 0),
            s.rating_count = (
              SELECT COUNT(*)
                FROM product_reviews r JOIN products p ON p.id = r.product_id
               WHERE p.seller_id = s.id AND r.status = 'published')
      WHERE s.id = ?`,
    [sellerId],
  )
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * Hide, remove or reinstate a review.
 *
 * `hidden` is reversible and is the right default for anything uncertain; `removed` is for a
 * clear breach. Both are invisible to shoppers, and the distinction exists so a moderator can
 * act quickly on a borderline case without pretending to more certainty than they have.
 */
export async function moderateReview(publicId, { status, code, note }, moderatorId) {
  if (!['published', 'hidden', 'removed'].includes(status)) {
    throw badRequest('Choose whether to publish, hide or remove this review.', 'INVALID_STATUS')
  }
  if (status !== 'published' && !code) {
    throw badRequest('Choose a reason.', 'MODERATION_CODE_REQUIRED', [
      { field: 'code', message: `One of: ${Object.keys(MODERATION_CODES).join(', ')}` },
    ])
  }
  if (code && !MODERATION_CODES[code]) {
    throw badRequest(`"${code}" is not a moderation reason.`, 'INVALID_MODERATION_CODE')
  }

  const review = await queryOne(
    `SELECT r.id, r.status, r.user_id, r.product_id, p.name AS product_name, p.seller_id
       FROM product_reviews r JOIN products p ON p.id = r.product_id
      WHERE r.public_id = ?`,
    [publicId],
  )
  if (!review) throw notFound('Review not found.')
  if (review.status === status) throw conflict(`This review is already ${status}.`, 'NO_STATUS_CHANGE')

  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE product_reviews
          SET status = ?, moderation_code = ?, moderation_reason = ?,
              moderated_by = ?, moderated_at = NOW(3), updated_at = NOW(3)
        WHERE id = ?`,
      [status, status === 'published' ? null : code, status === 'published' ? null : (note ?? null), moderatorId, review.id],
    )
    // The aggregate has to move with the review, in the same transaction. A hidden review that
    // still counts toward a 4.8 rating is exactly the manipulation this is meant to stop.
    await recomputeProductRating(review.product_id, connection)
    await recomputeSellerRating(review.seller_id, connection)

    // Any open report against it is settled by the decision itself.
    await connection.execute(
      `UPDATE review_reports
          SET status = ?, resolution = ?, reviewed_by = ?, reviewed_at = NOW(3)
        WHERE review_id = ? AND status IN ('open','reviewing')`,
      [status === 'published' ? 'dismissed' : 'upheld', note ?? MODERATION_CODES[code] ?? null, moderatorId, review.id],
    )
  })

  // Tell the author. A review that silently disappears reads as a bug, and the author cannot
  // appeal a decision they were never told about.
  if (status !== 'published') {
    await createNotification(review.user_id, {
      type: 'review_removed',
      title: 'Your review was removed',
      body: `Your review of ${review.product_name} was removed: ${note || MODERATION_CODES[code]}`,
      link: '/orders',
    })
  }

  return { status, productName: review.product_name }
}

/** The moderation queue: reported reviews first, most-reported first. */
export async function listForModeration({ page = 1, pageSize = 25, status, reportedOnly = false } = {}) {
  const where = []
  const params = []
  if (status) { where.push('r.status = ?'); params.push(status) }
  if (reportedOnly) where.push('r.report_count > 0')
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT r.public_id, r.rating, r.title, r.body, r.status, r.report_count, r.helpful_count,
            r.moderation_code, r.moderation_reason, r.created_at,
            p.public_id AS product_public_id, p.name AS product_name, p.slug AS product_slug,
            s.store_name, s.public_id AS seller_public_id,
            u.full_name AS author_name, u.public_id AS author_id
       FROM product_reviews r
       JOIN products p ON p.id = r.product_id
       JOIN sellers s ON s.id = p.seller_id
       JOIN users u ON u.id = r.user_id
       ${clause}
      ORDER BY r.report_count DESC, r.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM product_reviews r ${clause}`, params)

  return {
    items: rows.map((row) => ({
      id: row.public_id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      status: row.status,
      reportCount: Number(row.report_count),
      helpfulCount: Number(row.helpful_count),
      moderation: row.moderation_code
        ? { code: row.moderation_code, reason: row.moderation_reason }
        : null,
      // The id is what makes the product name a link to the listing being complained about.
      product: { id: row.product_public_id, name: row.product_name, slug: row.product_slug },
      seller: { id: row.seller_public_id, storeName: row.store_name },
      author: { id: row.author_id, name: row.author_name },
      at: row.created_at,
    })),
    total: Number(total),
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Report a review.
 *
 * Open to buyers and sellers alike. A seller reporting a competitor's fake one-star is as
 * legitimate a signal as a buyer reporting abuse — and because reporter identity is recorded,
 * a seller who reports every bad review they receive becomes visible rather than effective.
 */
export async function reportReview(publicId, { reason, details }, { userId, side = 'buyer' }) {
  const review = await queryOne('SELECT id, status FROM product_reviews WHERE public_id = ?', [publicId])
  if (!review) throw notFound('Review not found.')
  if (review.status !== 'published') {
    throw conflict('This review is no longer visible.', 'REVIEW_NOT_PUBLISHED')
  }

  try {
    await withTransaction(async (connection) => {
      await connection.execute(
        `INSERT INTO review_reports (public_id, review_id, reporter_id, reporter_side, reason, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), review.id, userId ?? null, side, reason, details ?? null],
      )
      // Counted from the reports themselves rather than incremented, so a retry cannot inflate
      // it and the number always matches what a moderator can actually read.
      await connection.execute(
        `UPDATE product_reviews
            SET report_count = (SELECT COUNT(*) FROM review_reports WHERE review_id = ?)
          WHERE id = ?`,
        [review.id, review.id],
      )
    })
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      throw conflict('You have already reported this review.', 'ALREADY_REPORTED')
    }
    throw error
  }

  return { reported: true }
}

// ---------------------------------------------------------------------------
// Seller responses
// ---------------------------------------------------------------------------

/**
 * A seller's public answer to a review.
 *
 * One per review, enforced by `uq_review_responses_review`. A seller arguing at length under a
 * bad review helps nobody, and the limit is what keeps a response a reply rather than a thread.
 *
 * The response is only accepted on the seller's own product — checked here rather than assumed
 * from the caller's seller context, because the review id comes from the client.
 */
export async function respondToReview(sellerId, publicId, { body }) {
  const review = await queryOne(
    `SELECT r.id, r.status, p.seller_id
       FROM product_reviews r JOIN products p ON p.id = r.product_id
      WHERE r.public_id = ?`,
    [publicId],
  )
  if (!review) throw notFound('Review not found.')
  if (String(review.seller_id) !== String(sellerId)) throw notFound('Review not found.')
  if (review.status !== 'published') {
    throw conflict('This review is not visible, so there is nothing to answer.', 'REVIEW_NOT_PUBLISHED')
  }

  const existing = await queryOne('SELECT id FROM review_responses WHERE review_id = ?', [review.id])
  if (existing) {
    await query(
      'UPDATE review_responses SET body = ?, updated_at = NOW(3) WHERE id = ?',
      [body, existing.id],
    )
    return { updated: true }
  }

  await query(
    `INSERT INTO review_responses (public_id, review_id, seller_id, body)
     VALUES (?, ?, ?, ?)`,
    [randomUUID(), review.id, sellerId, body],
  )
  return { created: true }
}

// ---------------------------------------------------------------------------
// Helpfulness
// ---------------------------------------------------------------------------

/** One vote per person, enforced by the primary key rather than by trusting the client. */
export async function voteHelpful(publicId, userId) {
  const review = await queryOne("SELECT id FROM product_reviews WHERE public_id = ? AND status = 'published'", [publicId])
  if (!review) throw notFound('Review not found.')

  await withTransaction(async (connection) => {
    await connection.execute(
      'INSERT IGNORE INTO review_votes (review_id, user_id) VALUES (?, ?)',
      [review.id, userId],
    )
    await connection.execute(
      'UPDATE product_reviews SET helpful_count = (SELECT COUNT(*) FROM review_votes WHERE review_id = ?) WHERE id = ?',
      [review.id, review.id],
    )
  })
  return { voted: true }
}

/**
 * Suspicious review patterns.
 *
 * Not a verdict — a queue. Every signal here has an innocent explanation (a family sharing a
 * connection, a genuinely excellent seller, a product that really is bad), which is exactly why
 * this surfaces cases for a human rather than acting on them.
 */
export async function suspiciousPatterns({ days = 30 } = {}) {
  // Reviewers who only ever rate one seller, and always at the extremes.
  const [singleSeller, velocity, sharedIp] = await Promise.all([
    query(
      `SELECT u.public_id, u.full_name, s.store_name, COUNT(*) AS reviews,
              ROUND(AVG(r.rating), 2) AS avg_rating
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN sellers s ON s.id = p.seller_id
         JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY) AND r.status = 'published'
        GROUP BY u.id, s.id
       HAVING reviews >= 3 AND (avg_rating >= 4.8 OR avg_rating <= 1.5)
          AND (SELECT COUNT(DISTINCT p2.seller_id)
                 FROM product_reviews r2 JOIN products p2 ON p2.id = r2.product_id
                WHERE r2.user_id = u.id) = 1
        ORDER BY reviews DESC LIMIT 50`,
      [days],
    ),
    // A store receiving an implausible burst of reviews.
    query(
      `SELECT s.public_id, s.store_name, COUNT(*) AS reviews, DATE(r.created_at) AS day,
              ROUND(AVG(r.rating), 2) AS avg_rating
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN sellers s ON s.id = p.seller_id
        WHERE r.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY) AND r.status = 'published'
        GROUP BY s.id, DATE(r.created_at)
       HAVING reviews >= 10
        ORDER BY reviews DESC LIMIT 50`,
      [days],
    ),
    // Reviews for one seller written from one address — the clearest self-review signal there
    // is, and only detectable because `submitted_ip` is captured at write time.
    query(
      `SELECT s.public_id, s.store_name, INET6_NTOA(r.submitted_ip) AS ip,
              COUNT(*) AS reviews, COUNT(DISTINCT r.user_id) AS accounts
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         JOIN sellers s ON s.id = p.seller_id
        WHERE r.submitted_ip IS NOT NULL
          AND r.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
        GROUP BY s.id, r.submitted_ip
       HAVING accounts >= 3
        ORDER BY reviews DESC LIMIT 50`,
      [days],
    ),
  ])

  return {
    singleSellerReviewers: singleSeller.map((row) => ({
      reviewer: { id: row.public_id, name: row.full_name },
      storeName: row.store_name,
      reviews: Number(row.reviews),
      averageRating: Number(row.avg_rating),
      signal: 'Only ever reviews this one store, at an extreme rating.',
    })),
    reviewBursts: velocity.map((row) => ({
      seller: { id: row.public_id, storeName: row.store_name },
      day: row.day,
      reviews: Number(row.reviews),
      averageRating: Number(row.avg_rating),
      signal: 'An unusual number of reviews in a single day.',
    })),
    sharedAddresses: sharedIp.map((row) => ({
      seller: { id: row.public_id, storeName: row.store_name },
      accounts: Number(row.accounts),
      reviews: Number(row.reviews),
      signal: 'Several accounts reviewed this store from one address.',
    })),
  }
}
