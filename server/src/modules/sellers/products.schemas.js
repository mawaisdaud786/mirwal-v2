import { z } from 'zod'

/**
 * Validation for seller product management.
 *
 * Note what is NOT here: `sellerId`, `status: 'active'`, `ratingAverage`, `ratingCount`.
 * `validate()` replaces the body with the parsed result, so a field absent from these schemas
 * cannot reach the service even if a client sends it — which is what stops a seller
 * self-publishing or writing their own ratings by adding a key to the JSON.
 */

const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 1499 or 1499.00')
const slug = z.string().trim().min(1).max(140)

export const productIdSchema = z.object({ id: z.string().trim().uuid() })
export const variantIdSchema = z.object({ id: z.coerce.number().int().positive() })

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Give the product a name of at least 2 characters.').max(255),
  subtitle: z.string().trim().max(150).optional(),
  description: z.string().trim().max(20000).optional(),
  categorySlug: slug,
  brandSlug: slug.nullish(),
  price: money,
  compareAtPrice: money.nullish(),
  costPrice: money.nullish(),
  currencyCode: z.string().trim().length(3).default('PKR'),
  condition: z.enum(['new', 'refurbished', 'used']).default('new'),
  // A seller may save a draft or submit for review. Anything else is rejected here rather
  // than silently downgraded, so the UI cannot quietly believe it published something.
  status: z.enum(['draft', 'pending_review']).default('pending_review'),
  sku: z.string().trim().max(80).optional(),
  quantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(5),
  allowBackorder: z.boolean().default(false),
  metaTitle: z.string().trim().max(180).nullish(),
  metaDescription: z.string().trim().max(320).nullish(),
  images: z.array(z.object({
    url: z.string().trim().url().max(500),
    alt: z.string().trim().max(255).optional(),
  })).max(12).optional(),
}).refine(
  // A strike-through price below the real price renders as a negative discount on the
  // storefront, which reads as a bug rather than a deal.
  (value) => !value.compareAtPrice || Number(value.compareAtPrice) > Number(value.price),
  { message: 'The compare-at price must be higher than the selling price.', path: ['compareAtPrice'] },
)

export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  subtitle: z.string().trim().max(150).optional(),
  description: z.string().trim().max(20000).optional(),
  categorySlug: slug.optional(),
  brandSlug: slug.nullish(),
  price: money.optional(),
  compareAtPrice: money.nullish(),
  costPrice: money.nullish(),
  condition: z.enum(['new', 'refurbished', 'used']).optional(),
  metaTitle: z.string().trim().max(180).nullish(),
  metaDescription: z.string().trim().max(320).nullish(),
  images: z.array(z.object({
    url: z.string().trim().url().max(500),
    alt: z.string().trim().max(255).optional(),
  })).max(12).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

export const productStatusSchema = z.object({
  status: z.enum(['draft', 'pending_review', 'archived']),
})

export const updateInventorySchema = z.object({
  quantity: z.coerce.number().int().min(0).max(1_000_000).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).optional(),
  allowBackorder: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })
