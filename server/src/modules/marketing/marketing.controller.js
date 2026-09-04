import { ok, okPage } from '../../lib/errors.js'
import * as service from './marketing.service.js'
import { AUDIT, recordAudit } from '../admin/audit.service.js'

/**
 * Marketing endpoints, shared by the admin and seller applications.
 *
 * `scopeOf(req)` is the single place ownership is decided: a seller request carries
 * `req.seller` (resolved from the access token by requireSeller) and is scoped to that store;
 * an admin request has no seller and sees everything. No handler reads an owner from the body
 * or the URL, so a seller cannot address another store's rows.
 *
 * Admin writes are audited; seller writes are not — the audit trail is a record of platform
 * moderation, and filling it with every seller's own coupon edits would bury that.
 */
const scopeOf = (req) => ({ sellerId: req.seller?.id ?? null })
const isAdmin = (req) => !req.seller

async function auditIfAdmin(req, entry) {
  if (isAdmin(req)) await recordAudit(req, entry)
}

// --- Coupons ----------------------------------------------------------------

export async function listCoupons(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await service.listCoupons(scopeOf(req), { page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function couponStats(req, res, next) {
  try { return ok(res, await service.getCouponStats(scopeOf(req))) }
  catch (error) { return next(error) }
}

export async function getCoupon(req, res, next) {
  try { return ok(res, await service.getCoupon(scopeOf(req), req.params.id)) }
  catch (error) { return next(error) }
}

export async function createCoupon(req, res, next) {
  try {
    const coupon = await service.createCoupon(scopeOf(req), req.body, req.user.id)
    await auditIfAdmin(req, {
      action: AUDIT.COUPON_CREATED, entityType: 'coupon', entityId: coupon.id,
      metadata: { code: coupon.code, type: coupon.discountType },
    })
    return ok(res, coupon, 'Coupon created.', 201)
  } catch (error) { return next(error) }
}

export async function updateCoupon(req, res, next) {
  try {
    const coupon = await service.updateCoupon(scopeOf(req), req.params.id, req.body)
    await auditIfAdmin(req, {
      action: AUDIT.COUPON_UPDATED, entityType: 'coupon', entityId: req.params.id,
      metadata: { code: coupon.code, fields: Object.keys(req.body) },
    })
    return ok(res, coupon, 'Coupon updated.')
  } catch (error) { return next(error) }
}

export async function deleteCoupon(req, res, next) {
  try {
    const result = await service.deleteCoupon(scopeOf(req), req.params.id)
    await auditIfAdmin(req, {
      action: AUDIT.COUPON_DELETED, entityType: 'coupon', entityId: req.params.id,
      metadata: { code: result.code },
    })
    return ok(res, null, 'Coupon deleted.')
  } catch (error) { return next(error) }
}

// --- Promotions -------------------------------------------------------------

export async function listPromotions(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await service.listPromotions(scopeOf(req), { page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function getPromotion(req, res, next) {
  try { return ok(res, await service.getPromotion(scopeOf(req), req.params.id)) }
  catch (error) { return next(error) }
}

export async function createPromotion(req, res, next) {
  try {
    const promotion = await service.createPromotion(scopeOf(req), req.body, req.user.id)
    await auditIfAdmin(req, {
      action: AUDIT.PROMOTION_CREATED, entityType: 'promotion', entityId: promotion.id,
      metadata: { name: promotion.name, kind: promotion.kind },
    })
    return ok(res, promotion, `${promotion.kind === 'flash_sale' ? 'Flash sale' : 'Promotion'} created.`, 201)
  } catch (error) { return next(error) }
}

export async function updatePromotion(req, res, next) {
  try {
    const promotion = await service.updatePromotion(scopeOf(req), req.params.id, req.body)
    await auditIfAdmin(req, {
      action: AUDIT.PROMOTION_UPDATED, entityType: 'promotion', entityId: req.params.id,
      metadata: { name: promotion.name, fields: Object.keys(req.body) },
    })
    return ok(res, promotion, 'Saved.')
  } catch (error) { return next(error) }
}

export async function deletePromotion(req, res, next) {
  try {
    const result = await service.deletePromotion(scopeOf(req), req.params.id)
    await auditIfAdmin(req, {
      action: AUDIT.PROMOTION_DELETED, entityType: 'promotion', entityId: req.params.id,
      metadata: { name: result.name },
    })
    return ok(res, null, 'Deleted.')
  } catch (error) { return next(error) }
}

// --- Banners (admin only) ---------------------------------------------------

export async function listBanners(req, res, next) {
  try { return ok(res, await service.listBanners(req.validatedQuery)) }
  catch (error) { return next(error) }
}

export async function createBanner(req, res, next) {
  try {
    const id = await service.createBanner(req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.BANNER_CREATED, entityType: 'banner', entityId: id,
      metadata: { title: req.body.title, placement: req.body.placement },
    })
    return ok(res, { id }, 'Banner created.', 201)
  } catch (error) { return next(error) }
}

export async function updateBanner(req, res, next) {
  try {
    const id = await service.updateBanner(req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.BANNER_UPDATED, entityType: 'banner', entityId: id,
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, { id }, 'Banner updated.')
  } catch (error) { return next(error) }
}

export async function deleteBanner(req, res, next) {
  try {
    const result = await service.deleteBanner(req.params.id)
    await recordAudit(req, {
      action: AUDIT.BANNER_DELETED, entityType: 'banner', entityId: req.params.id,
      metadata: { title: result.title },
    })
    return ok(res, null, 'Banner deleted.')
  } catch (error) { return next(error) }
}

/**
 * Marketing performance, scoped like everything else here: a seller sees only their own
 * coupons and promotions, an admin sees the marketplace.
 */
export async function performance(req, res, next) {
  try { return ok(res, await service.marketingPerformance(scopeOf(req))) }
  catch (error) { return next(error) }
}
