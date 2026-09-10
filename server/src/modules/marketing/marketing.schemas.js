import { z } from 'zod'

/**
 * Validation for marketing, support, payouts and settings.
 *
 * As elsewhere, `validate()` REPLACES the request body with the parsed result, so a field
 * absent from these schemas cannot reach a service. That is what stops a seller sending
 * `sellerId` to claim someone else's coupon, or a requester sending `isInternal: true` to
 * read staff notes.
 */

const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 1499 or 1499.00')
const publicId = z.string().trim().uuid()
// Accepts an ISO string or a date; coerced so the DB gets a real DATETIME.
const dateish = z.coerce.date()

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}

export const idParamSchema = z.object({ id: publicId })

// --- Coupons ----------------------------------------------------------------

export const listCouponsSchema = z.object({
  ...pageQuery,
  status: z.enum(['draft', 'active', 'paused', 'expired']).optional(),
  search: z.string().trim().max(120).optional(),
})

const couponBase = {
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).nullish(),
  discountType: z.enum(['percentage', 'fixed', 'free_shipping']),
  discountPercent: z.coerce.number().min(0.01).max(100).nullish(),
  discountAmount: money.nullish(),
  currencyCode: z.string().trim().length(3).default('PKR'),
  maxDiscountAmount: money.nullish(),
  minOrderAmount: money.default('0.00'),
  usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullish(),
  usageLimitPerUser: z.coerce.number().int().min(1).max(1000).nullish(),
  startsAt: dateish.nullish(),
  endsAt: dateish.nullish(),
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
}

export const createCouponSchema = z.object({
  // Codes are typed by shoppers, so the character set is deliberately narrow: no spaces, no
  // punctuation that is easy to mistype or that changes meaning when URL-encoded.
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores only.'),
  ...couponBase,
}).refine(
  (value) => !value.endsAt || !value.startsAt || value.endsAt > value.startsAt,
  { message: 'The end date must be after the start date.', path: ['endsAt'] },
)

export const updateCouponSchema = z.object({
  ...couponBase,
  discountType: couponBase.discountType.optional(),
  name: couponBase.name.optional(),
  minOrderAmount: money.optional(),
  status: z.enum(['draft', 'active', 'paused', 'expired']).optional(),
}).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Send at least one field to update.' },
)

// --- Promotions -------------------------------------------------------------

export const listPromotionsSchema = z.object({
  ...pageQuery,
  kind: z.enum(['promotion', 'campaign', 'flash_sale']).optional(),
  status: z.enum(['draft', 'scheduled', 'active', 'paused', 'ended']).optional(),
  search: z.string().trim().max(120).optional(),
})

const promotionBase = {
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(5000).nullish(),
  kind: z.enum(['promotion', 'campaign', 'flash_sale']).default('promotion'),
  discountType: z.enum(['percentage', 'fixed', 'none']).default('percentage'),
  discountPercent: z.coerce.number().min(0.01).max(100).nullish(),
  discountAmount: money.nullish(),
  currencyCode: z.string().trim().length(3).default('PKR'),
  startsAt: dateish.nullish(),
  endsAt: dateish.nullish(),
  status: z.enum(['draft', 'scheduled', 'active', 'paused', 'ended']).default('draft'),
  bannerImageUrl: z.string().trim().url().max(500).nullish(),
  priority: z.coerce.number().int().min(-999).max(999).default(0),
  productIds: z.array(publicId).max(500).optional(),
}

export const createPromotionSchema = z.object(promotionBase).refine(
  (value) => !value.endsAt || !value.startsAt || value.endsAt > value.startsAt,
  { message: 'The end date must be after the start date.', path: ['endsAt'] },
)

export const updatePromotionSchema = z.object(promotionBase).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Send at least one field to update.' },
)

// --- Banners ----------------------------------------------------------------

export const listBannersSchema = z.object({
  placement: z.string().trim().max(60).optional(),
  status: z.enum(['draft', 'active', 'paused', 'expired']).optional(),
})

const bannerBase = {
  title: z.string().trim().min(2).max(150),
  subtitle: z.string().trim().max(255).nullish(),
  imageUrl: z.string().trim().url().max(500),
  // Validated again in the service, which rejects anything not starting with a single "/".
  linkUrl: z.string().trim().max(500).nullish(),
  placement: z.string().trim().max(60).default('home_hero'),
  position: z.coerce.number().int().min(0).max(999).default(0),
  startsAt: dateish.nullish(),
  endsAt: dateish.nullish(),
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
}

export const createBannerSchema = z.object(bannerBase)
export const updateBannerSchema = z.object({
  ...bannerBase,
  status: z.enum(['draft', 'active', 'paused', 'expired']).optional(),
}).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Send at least one field to update.' },
)
