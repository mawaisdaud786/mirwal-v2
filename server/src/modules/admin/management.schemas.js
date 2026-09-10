import { z } from 'zod'

/**
 * Validation for the admin management endpoints.
 *
 * `validate()` REPLACES the request property with the parsed result, so anything not declared
 * here cannot reach a handler. That is what stops a caller smuggling `seller_id`, `status` or
 * `rating_average` into an update that was only meant to change a name.
 *
 * Money is accepted as a string and stays a string all the way to the DECIMAL column — see
 * lib/money.js for why it never becomes a float.
 */

const slug = z.string().trim().min(1).max(140)
const publicId = z.string().trim().uuid()

/** A decimal amount as a string: "1499", "1499.00". Rejects scientific notation and signs. */
const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 1499 or 1499.00')

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}

export const PRODUCT_STATUSES = ['draft', 'pending_review', 'active', 'rejected', 'archived']
export const SELLER_STATUSES = ['pending', 'approved', 'suspended', 'rejected', 'closed']

// --- Products ---------------------------------------------------------------

export const listProductsSchema = z.object({
  ...pageQuery,
  status: z.enum(PRODUCT_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  sellerId: z.coerce.number().int().positive().optional(),
  // `risk` exists because a two-hundred-item queue sorted by arrival gives a reviewer no way
  // to tell which listing is worth opening first.
  sort: z.enum(['newest', 'oldest', 'name', 'price-high', 'price-low', 'risk']).default('newest'),
})

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(255),
  subtitle: z.string().trim().max(150).optional(),
  description: z.string().trim().max(20000).optional(),
  slug: slug.optional(),
  categorySlug: slug,
  brandSlug: slug.optional(),
  sellerSlug: slug,
  price: money,
  compareAtPrice: money.optional(),
  costPrice: money.optional(),
  currencyCode: z.string().trim().length(3).default('PKR'),
  condition: z.enum(['new', 'refurbished', 'used']).default('new'),
  status: z.enum(PRODUCT_STATUSES).default('active'),
  sku: z.string().trim().max(80).optional(),
  quantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(5),
  metaTitle: z.string().trim().max(180).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  images: z.array(z.object({
    url: z.string().trim().url().max(500),
    alt: z.string().trim().max(255).optional(),
  })).max(12).optional(),
})

// `.partial()` on the shared fields, so an update may send only what changed. Deliberately
// omits sellerSlug: moving a product between stores would rewrite order history's ownership.
export const updateProductSchema = createProductSchema
  .omit({ sellerSlug: true, sku: true, quantity: true, lowStockThreshold: true, images: true, status: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

export const productApprovalSchema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().min(3).max(255).optional(),
})

export const productStatusSchema = z.object({
  status: z.enum(PRODUCT_STATUSES),
})

export const productIdSchema = z.object({ id: publicId })

// --- Categories & brands ----------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(150),
  slug: slug.optional(),
  parentSlug: slug.nullish(),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().url().max(500).nullish(),
  position: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  metaTitle: z.string().trim().max(180).nullish(),
  metaDescription: z.string().trim().max(320).nullish(),
})

export const updateCategorySchema = createCategorySchema.partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

export const createBrandSchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: slug.optional(),
  description: z.string().trim().max(2000).nullish(),
  logoUrl: z.string().trim().url().max(500).nullish(),
  isActive: z.boolean().default(true),
})

export const updateBrandSchema = createBrandSchema.partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

export const slugParamSchema = z.object({ slug })

// --- Inventory --------------------------------------------------------------

export const listInventorySchema = z.object({
  ...pageQuery,
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  // Query strings carry "true"/"false", never booleans.
  lowOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  search: z.string().trim().max(120).optional(),
  sellerId: z.coerce.number().int().positive().optional(),
})

export const updateInventorySchema = z.object({
  quantity: z.coerce.number().int().min(0).max(1_000_000).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).optional(),
  allowBackorder: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

export const variantIdSchema = z.object({ id: z.coerce.number().int().positive() })

// --- Sellers ----------------------------------------------------------------

export const listSellersSchema = z.object({
  ...pageQuery,
  status: z.enum(SELLER_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'products', 'rating']).default('newest'),
})

export const sellerIdSchema = z.object({ id: publicId })

/** Rejection and suspension both require a reason the applicant/seller will actually read. */
export const sellerReasonSchema = z.object({
  reason: z.string().trim().min(3).max(255),
})

// --- Audit ------------------------------------------------------------------

export const listAuditSchema = z.object({
  ...pageQuery,
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})
