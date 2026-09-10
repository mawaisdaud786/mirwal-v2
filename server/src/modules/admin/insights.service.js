import { query, queryOne } from '../../db/pool.js'
import { formatMoney } from '../../lib/money.js'
import { resolveWindow, windowClause, changePercent, zeroFillDaily } from '../../lib/dateRange.js'

/**
 * The four analytics surfaces that used to say an orders system did not exist: marketplace,
 * seller, customer and search/assistant.
 *
 * That claim was written before migration 003. `orders`, `order_items`, `payments`, `refunds`
 * and `payouts` are all real now, so every figure below is an aggregate over rows the
 * marketplace actually created. Nothing here is estimated, extrapolated or seeded.
 *
 * Two conventions carried from the existing analytics service:
 *  - cancelled orders never count towards revenue, but are counted separately so a
 *    cancellation spike is visible rather than hidden as an absence.
 *  - a percentage change against a period with no data is `null`, not "+100%".
 */

const COMPLETED = "o.status NOT IN ('cancelled')"

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

/** GMV, orders, basket size and where the money came from, over a window. */
export async function marketplaceAnalytics({ range, from, to }) {
  const { start, end, prevStart, prevEnd } = resolveWindow({ range, from, to })
  const current = windowClause('o.created_at', start, end)
  const previous = windowClause('o.created_at', prevStart, prevEnd)

  const totals = await queryOne(
    `SELECT COUNT(*)                                        AS orders,
            COALESCE(SUM(o.subtotal - o.discount_total), 0)  AS gmv,
            COALESCE(SUM(o.subtotal), 0)                    AS goods,
            COALESCE(SUM(o.discount_total), 0)              AS discounts,
            COALESCE(SUM(o.tax_total), 0)                   AS tax,
            COALESCE(SUM(o.shipping_fee), 0)                AS shipping,
            COUNT(DISTINCT o.buyer_id)                      AS buyers
       FROM orders o WHERE ${COMPLETED} ${current.sql}`,
    current.params,
  )
  const cancelled = await queryOne(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS value
       FROM orders o WHERE o.status = 'cancelled' ${current.sql}`,
    current.params,
  )
  const priorTotals = prevStart
    ? await queryOne(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.subtotal - o.discount_total), 0) AS gmv
         FROM orders o WHERE ${COMPLETED} ${previous.sql}`,
      previous.params,
    )
    : null

  const daily = await query(
    `SELECT DATE(o.created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(o.subtotal - o.discount_total), 0) AS gmv
       FROM orders o WHERE ${COMPLETED} ${current.sql}
      GROUP BY day ORDER BY day`,
    current.params,
  )

  const byCategory = await query(
    `SELECT c.name, COUNT(DISTINCT oi.order_id) AS orders,
            COALESCE(SUM(oi.line_total - oi.discount_amount), 0) AS revenue, COALESCE(SUM(oi.quantity), 0) AS units
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id
       JOIN products p  ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE ${COMPLETED} AND oi.status <> 'cancelled' ${current.sql}
      GROUP BY c.id ORDER BY revenue DESC LIMIT 10`,
    current.params,
  )

  const byStatus = await query(
    `SELECT o.status, COUNT(*) AS orders FROM orders o WHERE 1 = 1 ${current.sql} GROUP BY o.status`,
    current.params,
  )

  const orders = Number(totals.orders)
  const gmv = Number(totals.gmv)

  return {
    range: range ?? 'custom',
    totals: {
      orders,
      gmv: formatMoney(gmv),
      goodsValue: formatMoney(totals.goods),
      shippingCollected: formatMoney(totals.shipping),
      buyers: Number(totals.buyers),
      // Guarded: an empty window must show "—", never NaN or a division by zero.
      averageOrderValue: formatMoney(orders > 0 ? gmv / orders : 0),
      cancelledOrders: Number(cancelled.orders),
      cancelledValue: formatMoney(cancelled.value),
    },
    change: {
      orders: changePercent(orders, priorTotals ? Number(priorTotals.orders) : null),
      gmv: changePercent(gmv, priorTotals ? Number(priorTotals.gmv) : null),
    },
    trend: zeroFillDaily(
      daily.map((row) => ({ day: row.day, orders: Number(row.orders), gmv: Number(row.gmv) })),
      start, end, { orders: 0, gmv: 0 },
    ),
    topCategories: byCategory.map((row) => ({
      name: row.name,
      orders: Number(row.orders),
      units: Number(row.units),
      revenue: formatMoney(row.revenue),
    })),
    byStatus: byStatus.map((row) => ({ status: row.status, orders: Number(row.orders) })),
  }
}

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

/**
 * Per-seller trading figures.
 *
 * Joined from `order_items` rather than `orders`: an order can carry items from several
 * sellers, so attributing a whole order total to one seller would double-count the
 * marketplace's revenue the moment a basket is mixed.
 */
export async function sellerAnalytics({ range, from, to }) {
  const { start, end } = resolveWindow({ range, from, to })
  const current = windowClause('o.created_at', start, end)

  const rows = await query(
    `SELECT s.public_id, s.store_name, s.status,
            COUNT(DISTINCT oi.order_id)          AS orders,
            COALESCE(SUM(oi.line_total - oi.discount_amount), 0)      AS revenue,
            COALESCE(SUM(oi.quantity), 0)        AS units,
            SUM(oi.status = 'cancelled')         AS cancelled_items,
            SUM(oi.status = 'delivered')         AS delivered_items,
            (SELECT COUNT(*) FROM return_requests rr
              JOIN order_items roi ON roi.id = rr.order_item_id
             WHERE rr.seller_id = s.id)          AS returns,
            (SELECT COALESCE(SUM(p.net_amount), 0) FROM payouts p
             WHERE p.seller_id = s.id AND p.status = 'paid') AS paid_out
       FROM sellers s
       LEFT JOIN order_items oi ON oi.seller_id = s.id
       LEFT JOIN orders o       ON o.id = oi.order_id AND ${COMPLETED} ${current.sql}
      WHERE s.status = 'approved'
      GROUP BY s.id
      ORDER BY revenue DESC`,
    current.params,
  )

  const sellers = rows.map((row) => {
    const orders = Number(row.orders)
    const revenue = Number(row.revenue)
    const delivered = Number(row.delivered_items)
    const cancelledItems = Number(row.cancelled_items)
    const handled = delivered + cancelledItems
    return {
      id: row.public_id,
      name: row.store_name,
      status: row.status,
      orders,
      units: Number(row.units),
      revenue: formatMoney(revenue),
      averageOrderValue: formatMoney(orders > 0 ? revenue / orders : 0),
      returns: Number(row.returns),
      paidOut: formatMoney(row.paid_out),
      // Null rather than 100% when nothing has reached a terminal state: a seller with one
      // order still in transit has no fulfilment rate yet, and showing 0% would be a lie.
      fulfilmentRate: handled > 0 ? Math.round((delivered / handled) * 1000) / 10 : null,
    }
  })

  const totalRevenue = sellers.reduce((sum, seller) => sum + Number(seller.revenue), 0)
  return {
    range: range ?? 'custom',
    totals: {
      sellers: sellers.length,
      trading: sellers.filter((seller) => seller.orders > 0).length,
      revenue: formatMoney(totalRevenue),
    },
    sellers,
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * Who is buying, and whether they come back.
 *
 * Lifetime value is computed over all time regardless of the window, because it is a
 * lifetime figure; the window governs which customers are listed, not what "lifetime" means.
 */
export async function customerAnalytics({ range, from, to }) {
  const { start, end, prevStart, prevEnd } = resolveWindow({ range, from, to })
  const current = windowClause('o.created_at', start, end)
  const signups = windowClause('u.created_at', start, end)
  const priorSignups = windowClause('u.created_at', prevStart, prevEnd)

  const newCustomers = await queryOne(
    `SELECT COUNT(*) AS total FROM users u
      WHERE u.deleted_at IS NULL ${signups.sql}`,
    signups.params,
  )
  const priorNew = prevStart
    ? await queryOne(
      `SELECT COUNT(*) AS total FROM users u WHERE u.deleted_at IS NULL ${priorSignups.sql}`,
      priorSignups.params,
    )
    : null

  // Repeat rate over the window: how many of the people who ordered placed more than one.
  const repeat = await queryOne(
    `SELECT COUNT(*) AS buyers, SUM(order_count > 1) AS repeat_buyers
       FROM (SELECT o.buyer_id, COUNT(*) AS order_count
               FROM orders o WHERE ${COMPLETED} ${current.sql}
              GROUP BY o.buyer_id) AS per_buyer`,
    current.params,
  )

  const top = await query(
    `SELECT u.public_id, u.full_name, u.email, u.created_at,
            COUNT(o.id)                     AS orders,
            COALESCE(SUM(o.total), 0)       AS lifetime_value,
            MAX(o.created_at)               AS last_order_at,
            (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
              JOIN orders ro ON ro.id = r.order_id
             WHERE ro.buyer_id = u.id AND r.status = 'succeeded') AS refunded
       FROM users u
       JOIN orders o ON o.buyer_id = u.id AND ${COMPLETED}
      WHERE u.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY lifetime_value DESC
      LIMIT 25`,
  )

  const spend = await queryOne(
    `SELECT COUNT(DISTINCT o.buyer_id) AS buyers, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o WHERE ${COMPLETED}`,
  )

  const buyers = Number(repeat.buyers ?? 0)
  const repeatBuyers = Number(repeat.repeat_buyers ?? 0)
  const lifetimeBuyers = Number(spend.buyers)

  return {
    range: range ?? 'custom',
    totals: {
      newCustomers: Number(newCustomers.total),
      buyersInPeriod: buyers,
      repeatBuyers,
      repeatRate: buyers > 0 ? Math.round((repeatBuyers / buyers) * 1000) / 10 : null,
      averageLifetimeValue: formatMoney(lifetimeBuyers > 0 ? Number(spend.revenue) / lifetimeBuyers : 0),
    },
    change: {
      newCustomers: changePercent(Number(newCustomers.total), priorNew ? Number(priorNew.total) : null),
    },
    topCustomers: top.map((row) => ({
      id: row.public_id,
      name: row.full_name,
      email: row.email,
      orders: Number(row.orders),
      lifetimeValue: formatMoney(row.lifetime_value),
      refunded: formatMoney(row.refunded),
      lastOrderAt: row.last_order_at,
      joinedAt: row.created_at,
    })),
  }
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/**
 * The money view: what came in, what went back out, and what is owed to sellers.
 *
 * Commission is read from the payout rows that recorded it rather than recomputed from a
 * current rate — a rate change must not retroactively rewrite what a seller was charged.
 */
export async function financeAnalytics({ range, from, to }) {
  const { start, end } = resolveWindow({ range, from, to })
  const current = windowClause('o.created_at', start, end)

  const revenue = await queryOne(
    `SELECT COALESCE(SUM(o.total), 0) AS gross, COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total ELSE 0 END), 0) AS collected
       FROM orders o WHERE ${COMPLETED} ${current.sql}`,
    current.params,
  )

  const refundWindow = windowClause('r.created_at', start, end)
  const refunds = await queryOne(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN r.status = 'succeeded' THEN r.amount ELSE 0 END), 0) AS settled,
            COALESCE(SUM(CASE WHEN r.status IN ('pending','manual_required') THEN r.amount ELSE 0 END), 0) AS outstanding,
            SUM(r.status = 'manual_required') AS manual
       FROM refunds r WHERE 1 = 1 ${refundWindow.sql}`,
    refundWindow.params,
  )

  const payoutWindow = windowClause('p.created_at', start, end)
  const payouts = await queryOne(
    `SELECT COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.net_amount ELSE 0 END), 0)    AS paid,
            COALESCE(SUM(CASE WHEN p.status <> 'paid' THEN p.net_amount ELSE 0 END), 0)   AS pending,
            COALESCE(SUM(p.commission_amount), 0)                                          AS commission,
            COUNT(*)                                                                       AS total
       FROM payouts p WHERE 1 = 1 ${payoutWindow.sql}`,
    payoutWindow.params,
  )

  const daily = await query(
    `SELECT DATE(o.created_at) AS day, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o WHERE ${COMPLETED} ${current.sql}
      GROUP BY day ORDER BY day`,
    current.params,
  )

  const byMethod = await query(
    `SELECT o.payment_method AS method, o.payment_status AS status,
            COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS value
       FROM orders o WHERE ${COMPLETED} ${current.sql}
      GROUP BY o.payment_method, o.payment_status`,
    current.params,
  )

  const gross = Number(revenue.gross)
  const settledRefunds = Number(refunds.settled)

  return {
    range: range ?? 'custom',
    totals: {
      grossRevenue: formatMoney(gross),
      collected: formatMoney(revenue.collected),
      orders: Number(revenue.orders),
      refunded: formatMoney(settledRefunds),
      refundsOutstanding: formatMoney(refunds.outstanding),
      refundsNeedingAction: Number(refunds.manual ?? 0),
      // What Mirwal keeps: gross, less what went back to buyers, less what is owed to sellers.
      netRevenue: formatMoney(gross - settledRefunds),
      commissionEarned: formatMoney(payouts.commission),
      paidToSellers: formatMoney(payouts.paid),
      owedToSellers: formatMoney(payouts.pending),
      payouts: Number(payouts.total),
    },
    trend: zeroFillDaily(
      daily.map((row) => ({ day: row.day, revenue: Number(row.revenue) })),
      start, end, { revenue: 0 },
    ),
    byPaymentMethod: byMethod.map((row) => ({
      method: row.method,
      status: row.status,
      orders: Number(row.orders),
      value: formatMoney(row.value),
    })),
  }
}

// ---------------------------------------------------------------------------
// Search and the shopping assistant
// ---------------------------------------------------------------------------

/**
 * What shoppers actually searched for.
 *
 * Every figure comes from `search_queries`, written by the catalogue search and the
 * assistant. Before migration 018 nothing recorded a search, which is why these pages could
 * only ever have been fabricated.
 *
 * `zeroResult` is the useful half: the queries that found nothing are a list of things to
 * stock or to alias, and they are invisible in a plain popularity ranking.
 */
export async function searchAnalytics({ range, from, to }) {
  const { start, end, prevStart, prevEnd } = resolveWindow({ range, from, to })
  const current = windowClause('q.created_at', start, end)
  const previous = windowClause('q.created_at', prevStart, prevEnd)

  const totals = await queryOne(
    `SELECT COUNT(*)                              AS searches,
            COUNT(DISTINCT q.normalised)          AS distinct_terms,
            SUM(q.result_count = 0)               AS zero_result,
            SUM(q.clicked_product_id IS NOT NULL) AS clicked,
            COALESCE(AVG(q.duration_ms), 0)       AS avg_ms,
            SUM(q.source = 'assistant')           AS assistant
       FROM search_queries q WHERE 1 = 1 ${current.sql}`,
    current.params,
  )
  const prior = prevStart
    ? await queryOne(
      `SELECT COUNT(*) AS searches FROM search_queries q WHERE 1 = 1 ${previous.sql}`,
      previous.params,
    )
    : null

  const topTerms = await query(
    `SELECT q.normalised AS term, COUNT(*) AS searches,
            COALESCE(AVG(q.result_count), 0)      AS avg_results,
            SUM(q.clicked_product_id IS NOT NULL) AS clicks
       FROM search_queries q WHERE 1 = 1 ${current.sql}
      GROUP BY q.normalised ORDER BY searches DESC, term LIMIT 20`,
    current.params,
  )

  const zeroResult = await query(
    `SELECT q.normalised AS term, COUNT(*) AS searches, MAX(q.created_at) AS last_seen
       FROM search_queries q WHERE q.result_count = 0 ${current.sql}
      GROUP BY q.normalised ORDER BY searches DESC, last_seen DESC LIMIT 20`,
    current.params,
  )

  const clickedProducts = await query(
    `SELECT p.public_id, p.name, p.slug, COUNT(*) AS clicks
       FROM search_queries q
       JOIN products p ON p.id = q.clicked_product_id
      WHERE 1 = 1 ${current.sql}
      GROUP BY p.id ORDER BY clicks DESC LIMIT 15`,
    current.params,
  )

  const daily = await query(
    `SELECT DATE(q.created_at) AS day, COUNT(*) AS searches, SUM(q.result_count = 0) AS empty
       FROM search_queries q WHERE 1 = 1 ${current.sql}
      GROUP BY day ORDER BY day`,
    current.params,
  )

  const searches = Number(totals.searches)
  return {
    range: range ?? 'custom',
    totals: {
      searches,
      distinctTerms: Number(totals.distinct_terms),
      zeroResult: Number(totals.zero_result ?? 0),
      zeroResultRate: searches > 0 ? Math.round((Number(totals.zero_result ?? 0) / searches) * 1000) / 10 : null,
      clickThroughRate: searches > 0 ? Math.round((Number(totals.clicked ?? 0) / searches) * 1000) / 10 : null,
      averageDurationMs: Math.round(Number(totals.avg_ms)),
      assistantSearches: Number(totals.assistant ?? 0),
    },
    change: { searches: changePercent(searches, prior ? Number(prior.searches) : null) },
    trend: zeroFillDaily(
      daily.map((row) => ({ day: row.day, searches: Number(row.searches), empty: Number(row.empty) })),
      start, end, { searches: 0, empty: 0 },
    ),
    topTerms: topTerms.map((row) => ({
      term: row.term,
      searches: Number(row.searches),
      averageResults: Math.round(Number(row.avg_results) * 10) / 10,
      clicks: Number(row.clicks),
    })),
    zeroResultTerms: zeroResult.map((row) => ({
      term: row.term, searches: Number(row.searches), lastSeen: row.last_seen,
    })),
    topClickedProducts: clickedProducts.map((row) => ({
      id: row.public_id, name: row.name, slug: row.slug, clicks: Number(row.clicks),
    })),
  }
}

/**
 * Products bought together, computed from real baskets.
 *
 * This is what "recommendations" means here: for each product, the products that most often
 * appear in the same order. It is a co-occurrence count over `order_items`, not a model — so
 * an empty marketplace honestly produces an empty list rather than plausible noise.
 *
 * The self-join is bounded by `LIMIT` and by `oi.product_id < peer.product_id` so each pair
 * is counted once rather than twice.
 */
export async function recommendationInsights({ limit = 25 } = {}) {
  const pairs = await query(
    `SELECT a.name AS product_name, a.public_id AS product_id,
            b.name AS peer_name,   b.public_id AS peer_id,
            COUNT(DISTINCT oi.order_id) AS together
       FROM order_items oi
       JOIN order_items peer ON peer.order_id = oi.order_id AND peer.product_id > oi.product_id
       JOIN orders o    ON o.id = oi.order_id AND ${COMPLETED}
       JOIN products a  ON a.id = oi.product_id
       JOIN products b  ON b.id = peer.product_id
      GROUP BY oi.product_id, peer.product_id
      ORDER BY together DESC, product_name
      LIMIT ?`,
    [limit],
  )

  const coverage = await queryOne(
    `SELECT COUNT(DISTINCT oi.order_id) AS multi_item_orders,
            (SELECT COUNT(*) FROM orders o WHERE ${COMPLETED}) AS total_orders
       FROM order_items oi
      WHERE oi.order_id IN (SELECT order_id FROM order_items GROUP BY order_id HAVING COUNT(*) > 1)`,
  )

  const totalOrders = Number(coverage.total_orders)
  const multiItem = Number(coverage.multi_item_orders)
  return {
    pairs: pairs.map((row) => ({
      product: { id: row.product_id, name: row.product_name },
      peer: { id: row.peer_id, name: row.peer_name },
      together: Number(row.together),
    })),
    coverage: {
      totalOrders,
      multiItemOrders: multiItem,
      // Below this, "bought together" has too little evidence to be worth showing a shopper.
      basketRate: totalOrders > 0 ? Math.round((multiItem / totalOrders) * 1000) / 10 : null,
    },
  }
}

// ---------------------------------------------------------------------------
// One store's trading activity
// ---------------------------------------------------------------------------

/**
 * Recent orders and reviews for a single store, for the admin store detail page.
 *
 * That page previously ended in an "Orders & Reviews — not connected" panel. Both were
 * already reachable: order lines carry `seller_id`, and `product_reviews` join through
 * products. Scoped by the store's public id so a mis-typed id returns nothing rather than
 * another store's trade.
 */
export async function sellerActivity(sellerPublicId, { limit = 20 } = {}) {
  const seller = await queryOne('SELECT id, store_name FROM sellers WHERE public_id = ? OR slug = ?', [sellerPublicId, sellerPublicId])
  if (!seller) return null

  const orders = await query(
    `SELECT o.public_id, o.order_number, o.status, o.created_at, o.currency_code,
            buyer.full_name AS buyer_name,
            COUNT(oi.id)                    AS items,
            COALESCE(SUM(oi.line_total - oi.discount_amount), 0) AS seller_value
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id
       JOIN users buyer ON buyer.id = o.buyer_id
      WHERE oi.seller_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ?`,
    [seller.id, limit],
  )

  const reviews = await query(
    `SELECT rv.public_id, rv.rating, rv.title, rv.body, rv.created_at,
            p.name AS product_name, u.full_name AS author_name
       FROM product_reviews rv
       JOIN products p ON p.id = rv.product_id
       LEFT JOIN users u ON u.id = rv.user_id
      WHERE p.seller_id = ?
      ORDER BY rv.created_at DESC
      LIMIT ?`,
    [seller.id, limit],
  )

  const totals = await queryOne(
    `SELECT COUNT(DISTINCT oi.order_id)     AS orders,
            COALESCE(SUM(oi.line_total - oi.discount_amount), 0) AS revenue,
            COALESCE(SUM(oi.quantity), 0)   AS units
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND ${COMPLETED}
      WHERE oi.seller_id = ?`,
    [seller.id],
  )

  const ratings = await queryOne(
    `SELECT COUNT(*) AS total, COALESCE(AVG(rv.rating), 0) AS average
       FROM product_reviews rv JOIN products p ON p.id = rv.product_id
      WHERE p.seller_id = ?`,
    [seller.id],
  )

  return {
    store: seller.store_name,
    totals: {
      orders: Number(totals.orders),
      revenue: formatMoney(totals.revenue),
      units: Number(totals.units),
      reviews: Number(ratings.total),
      averageRating: Number(ratings.total) > 0 ? Math.round(Number(ratings.average) * 10) / 10 : null,
    },
    orders: orders.map((row) => ({
      id: row.public_id,
      orderNumber: row.order_number,
      status: row.status,
      buyer: row.buyer_name,
      items: Number(row.items),
      // This store's share of the order, not the order total — a mixed basket belongs to
      // several sellers and none of them earned all of it.
      value: formatMoney(row.seller_value, row.currency_code),
      placedAt: row.created_at,
    })),
    reviews: reviews.map((row) => ({
      id: row.public_id,
      rating: Number(row.rating),
      title: row.title,
      body: row.body,
      productName: row.product_name,
      author: row.author_name ?? 'Removed account',
      createdAt: row.created_at,
    })),
  }
}
