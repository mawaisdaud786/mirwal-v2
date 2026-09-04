import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'

/**
 * Marketing: coupons, promotions/campaigns/flash sales, and banners.
 *
 * Ownership runs through every function as a `scope` argument:
 *
 *   { sellerId: null }   admin — may see and manage everything
 *   { sellerId: 123 }    a seller — may only see and manage rows they own
 *
 * The seller case is enforced in the WHERE clause of each query rather than by checking after
 * the fetch, so there is no path where a seller's request touches another store's coupon.
 * Admin-owned rows (seller_id IS NULL) are visible to sellers nowhere — a Mirwal-wide coupon
 * is not theirs to edit or even list.
 *
 * Discounts are stored as basis points (500 = 5%) so the arithmetic is exact integers. Money
 * crosses the API as a formatted object, never a float — see lib/money.js.
 */

/** Percentages arrive from the client as a number like 12.5 and are stored as 1250 bps. */
const toBps = (percent) => Math.round(Number(percent) * 100)
const fromBps = (bps) => (bps == null ? null : Number(bps) / 100)

/**
 * What a row's status *actually* is right now, as opposed to what the column says.
 *
 * The stored status records intent ("this should run"); the window decides whether it is
 * live at this instant. Deriving this here means the admin list, the seller list and the
 * storefront all agree, instead of each re-implementing the date comparison.
 */
function effectiveStatus(row, now = Date.now()) {
  if (row.status === 'draft' || row.status === 'paused') return row.status
  const starts = row.starts_at ? new Date(String(row.starts_at).replace(' ', 'T')).getTime() : null
  const ends = row.ends_at ? new Date(String(row.ends_at).replace(' ', 'T')).getTime() : null
  if (ends != null && ends <= now) return 'expired'
  if (starts != null && starts > now) return 'scheduled'
  return 'active'
}

/** Add the seller-ownership predicate to a WHERE list. */
function applyScope(where, params, scope, column = 'seller_id') {
  if (scope.sellerId == null) return
  where.push(`${column} = ?`)
  params.push(scope.sellerId)
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

function shapeCoupon(row) {
  return {
    id: row.public_id,
    code: row.code,
    name: row.name,
    description: row.description,
    discountType: row.discount_type,
    discountPercent: fromBps(row.discount_bps),
    discountAmount: formatMoney(row.discount_amount, row.currency_code),
    maxDiscountAmount: formatMoney(row.max_discount_amount, row.currency_code),
    minOrderAmount: formatMoney(row.min_order_amount, row.currency_code),
    usageLimit: row.usage_limit == null ? null : Number(row.usage_limit),
    usageLimitPerUser: row.usage_limit_per_user == null ? null : Number(row.usage_limit_per_user),
    usageCount: Number(row.usage_count),
    // The real figure from the redemption ledger, not the denormalised counter — this is what
    // makes "used 240 times" checkable rather than a number someone typed.
    redemptionCount: row.redemption_count == null ? undefined : Number(row.redemption_count),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    effectiveStatus: effectiveStatus(row),
    owner: row.seller_slug ? { slug: row.seller_slug, name: row.seller_store_name } : null,
    createdAt: row.created_at,
  }
}

const COUPON_SELECT = `
  SELECT c.id, c.public_id, c.code, c.name, c.description, c.seller_id,
         c.discount_type, c.discount_bps, c.discount_amount, c.currency_code,
         c.max_discount_amount, c.min_order_amount,
         c.usage_limit, c.usage_limit_per_user, c.usage_count,
         c.starts_at, c.ends_at, c.status, c.created_at,
         s.slug AS seller_slug, s.store_name AS seller_store_name,
         (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS redemption_count
    FROM coupons c
    LEFT JOIN sellers s ON s.id = c.seller_id`

export async function listCoupons(scope, { page = 1, pageSize = 25, status, search } = {}) {
  const where = ['c.deleted_at IS NULL']
  const params = []
  applyScope(where, params, scope, 'c.seller_id')
  if (status) { where.push('c.status = ?'); params.push(status) }
  if (search) { where.push('(c.code LIKE ? OR c.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }

  const clause = `WHERE ${where.join(' AND ')}`
  const rows = await query(
    `${COUPON_SELECT} ${clause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM coupons c ${clause}`, params)
  return { items: rows.map(shapeCoupon), total: Number(total) }
}

export async function getCouponStats(scope) {
  const where = ['deleted_at IS NULL']
  const params = []
  applyScope(where, params, scope)
  const [row] = await query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(status = 'draft') AS draft,
            COALESCE(SUM(usage_count), 0) AS redemptions
       FROM coupons WHERE ${where.join(' AND ')}`,
    params,
  )
  return {
    total: Number(row.total),
    active: Number(row.active ?? 0),
    draft: Number(row.draft ?? 0),
    redemptions: Number(row.redemptions),
  }
}

async function ownedCoupon(scope, publicId) {
  const row = await queryOne(
    'SELECT id, seller_id, code, status FROM coupons WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  // Not-found and not-yours are reported identically, so the endpoint cannot be used to
  // discover which coupon ids exist on other stores.
  if (!row) throw notFound('Coupon not found.')
  if (scope.sellerId != null && row.seller_id !== scope.sellerId) throw notFound('Coupon not found.')
  return row
}

export async function getCoupon(scope, publicId) {
  await ownedCoupon(scope, publicId)
  const row = await queryOne(`${COUPON_SELECT} WHERE c.public_id = ?`, [publicId])
  const redemptions = await query(
    `SELECT r.discount_amount, r.created_at, u.full_name, u.email
       FROM coupon_redemptions r JOIN users u ON u.id = r.user_id
      WHERE r.coupon_id = ? ORDER BY r.created_at DESC LIMIT 25`,
    [row.id],
  )
  return {
    ...shapeCoupon(row),
    redemptions: redemptions.map((entry) => ({
      customer: entry.full_name,
      email: entry.email,
      discount: formatMoney(entry.discount_amount, row.currency_code),
      at: entry.created_at,
    })),
  }
}

/** Normalise and validate the discount shape the DB CHECK also enforces. */
function discountColumns(input) {
  if (input.discountType === 'percentage') {
    if (input.discountPercent == null) throw badRequest('Enter a discount percentage.', 'DISCOUNT_REQUIRED')
    const bps = toBps(input.discountPercent)
    if (bps < 1 || bps > 10000) throw badRequest('The percentage must be between 0.01 and 100.', 'DISCOUNT_RANGE')
    return { discount_bps: bps, discount_amount: null }
  }
  if (input.discountType === 'fixed') {
    if (input.discountAmount == null) throw badRequest('Enter a discount amount.', 'DISCOUNT_REQUIRED')
    return { discount_bps: null, discount_amount: input.discountAmount }
  }
  return { discount_bps: null, discount_amount: null }
}

export async function createCoupon(scope, input, userId) {
  const code = input.code.trim().toUpperCase()
  const clash = await queryOne('SELECT id FROM coupons WHERE code = ?', [code])
  if (clash) throw conflict('That coupon code is already in use.', 'COUPON_CODE_TAKEN')

  const discount = discountColumns(input)
  // MariaDB's INSERT ... RETURNING hands back the generated UUID without a second round trip.
  const [created] = await query(
    `INSERT INTO coupons
       (public_id, code, name, description, seller_id, discount_type, discount_bps, discount_amount,
        currency_code, max_discount_amount, min_order_amount, usage_limit, usage_limit_per_user,
        starts_at, ends_at, status, created_by, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     RETURNING public_id`,
    [
      code, input.name, input.description ?? null, scope.sellerId,
      input.discountType, discount.discount_bps, discount.discount_amount,
      input.currencyCode ?? 'PKR', input.maxDiscountAmount ?? null, input.minOrderAmount ?? '0.00',
      input.usageLimit ?? null, input.usageLimitPerUser ?? null,
      input.startsAt ?? null, input.endsAt ?? null, input.status ?? 'draft', userId ?? null,
    ],
  )

  return getCoupon(scope, created.public_id)
}

const COUPON_UPDATABLE = {
  name: 'name',
  description: 'description',
  maxDiscountAmount: 'max_discount_amount',
  minOrderAmount: 'min_order_amount',
  usageLimit: 'usage_limit',
  usageLimitPerUser: 'usage_limit_per_user',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  status: 'status',
}

export async function updateCoupon(scope, publicId, input) {
  const coupon = await ownedCoupon(scope, publicId)

  const sets = []
  const params = []
  for (const [field, column] of Object.entries(COUPON_UPDATABLE)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  // The code is deliberately immutable: it may already be printed, emailed or shared, and
  // changing it silently breaks every place it was published.
  if (input.discountType !== undefined) {
    const discount = discountColumns(input)
    sets.push('discount_type = ?', 'discount_bps = ?', 'discount_amount = ?')
    params.push(input.discountType, discount.discount_bps, discount.discount_amount)
  }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`, [...params, coupon.id])
  return getCoupon(scope, publicId)
}

export async function deleteCoupon(scope, publicId) {
  const coupon = await ownedCoupon(scope, publicId)
  // Soft delete: coupon_redemptions reference this row, and a past order's discount must stay
  // explainable after the coupon is withdrawn.
  await query('UPDATE coupons SET deleted_at = NOW(3), updated_at = NOW(3) WHERE id = ?', [coupon.id])
  return { code: coupon.code }
}

// ---------------------------------------------------------------------------
// Promotions / campaigns / flash sales
// ---------------------------------------------------------------------------

function shapePromotion(row) {
  return {
    id: row.public_id,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    description: row.description,
    discountType: row.discount_type,
    discountPercent: fromBps(row.discount_bps),
    discountAmount: formatMoney(row.discount_amount, row.currency_code),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    effectiveStatus: effectiveStatus(row),
    bannerImageUrl: row.banner_image_url,
    priority: Number(row.priority),
    productCount: row.product_count == null ? 0 : Number(row.product_count),
    owner: row.seller_slug ? { slug: row.seller_slug, name: row.seller_store_name } : null,
    createdAt: row.created_at,
  }
}

const PROMOTION_SELECT = `
  SELECT p.id, p.public_id, p.kind, p.slug, p.name, p.description, p.seller_id,
         p.discount_type, p.discount_bps, p.discount_amount, p.currency_code,
         p.starts_at, p.ends_at, p.status, p.banner_image_url, p.priority, p.created_at,
         s.slug AS seller_slug, s.store_name AS seller_store_name,
         (SELECT COUNT(*) FROM promotion_products pp WHERE pp.promotion_id = p.id) AS product_count
    FROM promotions p
    LEFT JOIN sellers s ON s.id = p.seller_id`

export async function listPromotions(scope, { kind, page = 1, pageSize = 25, status, search } = {}) {
  const where = ['p.deleted_at IS NULL']
  const params = []
  applyScope(where, params, scope, 'p.seller_id')
  if (kind) { where.push('p.kind = ?'); params.push(kind) }
  if (status) { where.push('p.status = ?'); params.push(status) }
  if (search) { where.push('p.name LIKE ?'); params.push(`%${search}%`) }

  const clause = `WHERE ${where.join(' AND ')}`
  const rows = await query(
    `${PROMOTION_SELECT} ${clause} ORDER BY p.priority DESC, p.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM promotions p ${clause}`, params)
  return { items: rows.map(shapePromotion), total: Number(total) }
}

async function ownedPromotion(scope, publicId) {
  const row = await queryOne(
    'SELECT id, seller_id, name, kind FROM promotions WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!row) throw notFound('Promotion not found.')
  if (scope.sellerId != null && row.seller_id !== scope.sellerId) throw notFound('Promotion not found.')
  return row
}

export async function getPromotion(scope, publicId) {
  await ownedPromotion(scope, publicId)
  const row = await queryOne(`${PROMOTION_SELECT} WHERE p.public_id = ?`, [publicId])
  const products = await query(
    `SELECT pr.public_id, pr.name, pr.slug, pr.price, pr.currency_code
       FROM promotion_products pp JOIN products pr ON pr.id = pp.product_id
      WHERE pp.promotion_id = ? AND pr.deleted_at IS NULL
      ORDER BY pr.name LIMIT 100`,
    [row.id],
  )
  return {
    ...shapePromotion(row),
    products: products.map((product) => ({
      id: product.public_id,
      name: product.name,
      slug: product.slug,
      price: formatMoney(product.price, product.currency_code),
    })),
  }
}

async function uniquePromotionSlug(name) {
  const base = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'promotion'
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    if (!await queryOne('SELECT id FROM promotions WHERE slug = ?', [candidate])) return candidate
  }
  throw conflict('Could not generate a unique link for that name.')
}

export async function createPromotion(scope, input, userId) {
  // A flash sale is defined by its window — one without an end time is just a promotion, and
  // the countdown the storefront renders would have nothing to count down to.
  if (input.kind === 'flash_sale' && !input.endsAt) {
    throw badRequest('A flash sale needs an end time.', 'FLASH_SALE_WINDOW_REQUIRED')
  }
  const discount = discountColumns(input)
  const slug = await uniquePromotionSlug(input.name)

  const publicId = await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO promotions
         (public_id, kind, slug, name, description, seller_id, discount_type, discount_bps,
          discount_amount, currency_code, starts_at, ends_at, status, banner_image_url,
          priority, created_by, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [
        input.kind ?? 'promotion', slug, input.name, input.description ?? null, scope.sellerId,
        input.discountType ?? 'percentage', discount.discount_bps, discount.discount_amount,
        input.currencyCode ?? 'PKR', input.startsAt ?? null, input.endsAt ?? null,
        input.status ?? 'draft', input.bannerImageUrl ?? null, input.priority ?? 0, userId ?? null,
      ],
    )
    if (input.productIds?.length) {
      await attachProducts(connection, result.insertId, input.productIds, scope)
    }
    const [[row]] = await connection.execute('SELECT public_id FROM promotions WHERE id = ?', [result.insertId])
    return row.public_id
  })

  return getPromotion(scope, publicId)
}

/**
 * Link products to a promotion.
 *
 * A seller may only attach their own products — otherwise a seller could discount a rival's
 * listing. Resolved inside the same transaction as the promotion write.
 */
async function attachProducts(connection, promotionId, productPublicIds, scope) {
  const unique = [...new Set(productPublicIds)]
  const [rows] = await connection.execute(
    `SELECT id, public_id, seller_id FROM products
      WHERE public_id IN (${unique.map(() => '?').join(',')}) AND deleted_at IS NULL`,
    unique,
  )
  if (rows.length !== unique.length) throw badRequest('One or more products were not found.', 'INVALID_PRODUCT')
  if (scope.sellerId != null && rows.some((row) => row.seller_id !== scope.sellerId)) {
    throw badRequest('You can only promote your own products.', 'PRODUCT_NOT_OWNED')
  }
  for (const row of rows) {
    await connection.execute(
      'INSERT IGNORE INTO promotion_products (promotion_id, product_id, created_at) VALUES (?, ?, NOW(3))',
      [promotionId, row.id],
    )
  }
}

export async function updatePromotion(scope, publicId, input) {
  const promotion = await ownedPromotion(scope, publicId)

  const map = {
    name: 'name', description: 'description', startsAt: 'starts_at', endsAt: 'ends_at',
    status: 'status', bannerImageUrl: 'banner_image_url', priority: 'priority',
  }
  const sets = []
  const params = []
  for (const [field, column] of Object.entries(map)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  if (input.discountType !== undefined) {
    const discount = discountColumns(input)
    sets.push('discount_type = ?', 'discount_bps = ?', 'discount_amount = ?')
    params.push(input.discountType, discount.discount_bps, discount.discount_amount)
  }
  if (!sets.length && input.productIds === undefined) {
    throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')
  }

  await withTransaction(async (connection) => {
    if (sets.length) {
      sets.push('updated_at = NOW(3)')
      await connection.execute(
        `UPDATE promotions SET ${sets.join(', ')} WHERE id = ?`,
        [...params, promotion.id],
      )
    }
    if (input.productIds !== undefined) {
      // Replaced wholesale: the client sends the set it wants, same as product images.
      await connection.execute('DELETE FROM promotion_products WHERE promotion_id = ?', [promotion.id])
      if (input.productIds.length) await attachProducts(connection, promotion.id, input.productIds, scope)
    }
  })

  return getPromotion(scope, publicId)
}

export async function deletePromotion(scope, publicId) {
  const promotion = await ownedPromotion(scope, publicId)
  await query('UPDATE promotions SET deleted_at = NOW(3), updated_at = NOW(3) WHERE id = ?', [promotion.id])
  return { name: promotion.name }
}

// ---------------------------------------------------------------------------
// Banners (admin only — there is no seller_id on this table)
// ---------------------------------------------------------------------------

function shapeBanner(row) {
  return {
    id: row.public_id,
    title: row.title,
    subtitle: row.subtitle,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    placement: row.placement,
    position: Number(row.position),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    effectiveStatus: effectiveStatus(row),
    createdAt: row.created_at,
  }
}

export async function listBanners({ placement, status } = {}) {
  const where = ['deleted_at IS NULL']
  const params = []
  if (placement) { where.push('placement = ?'); params.push(placement) }
  if (status) { where.push('status = ?'); params.push(status) }
  const rows = await query(
    `SELECT * FROM banners WHERE ${where.join(' AND ')} ORDER BY placement, position, created_at DESC`,
    params,
  )
  return rows.map(shapeBanner)
}

/**
 * Reject an off-site banner target.
 *
 * A banner is placed by an admin but rendered to every shopper on the homepage; allowing an
 * absolute URL turns the most prominent slot on mirwal.pk into an open redirect.
 */
function assertInternalLink(linkUrl) {
  if (linkUrl == null || linkUrl === '') return null
  if (!linkUrl.startsWith('/') || linkUrl.startsWith('//')) {
    throw badRequest('Banner links must be internal paths beginning with "/".', 'EXTERNAL_LINK_REJECTED')
  }
  return linkUrl
}

export async function createBanner(input, userId) {
  const [row] = await query(
    `INSERT INTO banners
       (public_id, title, subtitle, image_url, link_url, placement, position,
        starts_at, ends_at, status, created_by, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     RETURNING public_id`,
    [
      input.title, input.subtitle ?? null, input.imageUrl, assertInternalLink(input.linkUrl),
      input.placement ?? 'home_hero', input.position ?? 0,
      input.startsAt ?? null, input.endsAt ?? null, input.status ?? 'draft', userId ?? null,
    ],
  )
  return row.public_id
}

export async function updateBanner(publicId, input) {
  const banner = await queryOne('SELECT id FROM banners WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!banner) throw notFound('Banner not found.')

  const map = {
    title: 'title', subtitle: 'subtitle', imageUrl: 'image_url', placement: 'placement',
    position: 'position', startsAt: 'starts_at', endsAt: 'ends_at', status: 'status',
  }
  const sets = []
  const params = []
  for (const [field, column] of Object.entries(map)) {
    if (input[field] !== undefined) { sets.push(`${column} = ?`); params.push(input[field]) }
  }
  if (input.linkUrl !== undefined) { sets.push('link_url = ?'); params.push(assertInternalLink(input.linkUrl)) }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE banners SET ${sets.join(', ')} WHERE id = ?`, [...params, banner.id])
  return publicId
}

export async function deleteBanner(publicId) {
  const banner = await queryOne('SELECT id, title FROM banners WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!banner) throw notFound('Banner not found.')
  await query('UPDATE banners SET deleted_at = NOW(3), updated_at = NOW(3) WHERE id = ?', [banner.id])
  return { title: banner.title }
}

// ---------------------------------------------------------------------------
// Marketing performance
// ---------------------------------------------------------------------------

/**
 * Whether a seller's marketing actually sold anything.
 *
 * The seller Marketing pages said measuring a campaign "needs attribution — which order came
 * from which promotion — which Mirwal does not track yet." Half of that was wrong:
 * `coupon_redemptions.order_id` has recorded exactly that link since migration 012. A coupon
 * redemption names the order it discounted, so coupon performance is measurable, precisely.
 *
 * Promotions are the honest other half. A promotion changes a price; nothing records that a
 * shopper bought because of it. So promotion rows below report what was sold while the
 * promotion was running — stated as that, not dressed up as attribution. The distinction is
 * the point: one of these numbers is caused, the other is merely concurrent.
 */
export async function marketingPerformance(scope) {
  const sellerId = scope?.sellerId ?? null

  const coupons = await query(
    `SELECT c.public_id, c.code, c.name, c.status, c.usage_count,
            COUNT(r.id)                                  AS redemptions,
            COUNT(DISTINCT r.user_id)                    AS shoppers,
            COALESCE(SUM(r.discount_amount), 0)          AS discount_given,
            COALESCE(SUM(o.total), 0)                    AS order_value,
            MAX(r.created_at)                            AS last_used
       FROM coupons c
       LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id
       LEFT JOIN orders o             ON o.id = r.order_id AND o.status <> 'cancelled'
      WHERE c.deleted_at IS NULL AND (? IS NULL OR c.seller_id = ?)
      GROUP BY c.id
      ORDER BY redemptions DESC, c.created_at DESC`,
    [sellerId, sellerId],
  )

  const promotions = await query(
    `SELECT p.public_id, p.name, p.kind, p.status, p.starts_at, p.ends_at,
            COUNT(DISTINCT pp.product_id)                AS products,
            COALESCE(SUM(oi.quantity), 0)                AS units,
            COALESCE(SUM(oi.line_total), 0)              AS revenue,
            COUNT(DISTINCT oi.order_id)                  AS orders
       FROM promotions p
       LEFT JOIN promotion_products pp ON pp.promotion_id = p.id
       LEFT JOIN order_items oi        ON oi.product_id = pp.product_id
       LEFT JOIN orders o              ON o.id = oi.order_id
                                      AND o.status <> 'cancelled'
                                      -- Only what sold while the promotion was live. A sale
                                      -- before it started was not influenced by it.
                                      AND o.created_at >= p.starts_at
                                      AND (p.ends_at IS NULL OR o.created_at <= p.ends_at)
      WHERE p.deleted_at IS NULL AND (? IS NULL OR p.seller_id = ?)
      GROUP BY p.id
      ORDER BY revenue DESC, p.created_at DESC`,
    [sellerId, sellerId],
  )

  const totals = coupons.reduce((sum, row) => ({
    redemptions: sum.redemptions + Number(row.redemptions),
    discount: sum.discount + Number(row.discount_given),
    orderValue: sum.orderValue + Number(row.order_value),
  }), { redemptions: 0, discount: 0, orderValue: 0 })

  return {
    totals: {
      coupons: coupons.length,
      activeCoupons: coupons.filter((row) => row.status === 'active').length,
      redemptions: totals.redemptions,
      discountGiven: formatMoney(totals.discount.toFixed(2)),
      // What the discounted orders were worth in total — the figure that says whether the
      // discount bought anything, rather than only what it cost.
      attributedOrderValue: formatMoney(totals.orderValue.toFixed(2)),
      promotions: promotions.length,
    },
    coupons: coupons.map((row) => ({
      id: row.public_id,
      code: row.code,
      name: row.name,
      status: row.status,
      redemptions: Number(row.redemptions),
      shoppers: Number(row.shoppers),
      discountGiven: formatMoney(row.discount_given),
      orderValue: formatMoney(row.order_value),
      lastUsedAt: row.last_used,
    })),
    promotions: promotions.map((row) => ({
      id: row.public_id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      products: Number(row.products),
      orders: Number(row.orders),
      units: Number(row.units),
      revenue: formatMoney(row.revenue),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    })),
  }
}
