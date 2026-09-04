import { z } from 'zod'

/** Comma-separated query values ("electronics,fashion") arrive as one string. */
const csv = z.string().optional().transform((value) =>
  value ? value.split(',').map((part) => part.trim()).filter(Boolean) : undefined)

const money = z.coerce.number().nonnegative().max(99_999_999).optional()

export const listProductsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: csv,
  brand: csv,
  type: csv,
  saleType: z.enum(['promotion', 'campaign', 'flash_sale']).optional(),
  seller: z.string().trim().max(140).optional(),
  minDiscount: z.coerce.number().min(0).max(100).optional(),
  minPrice: money,
  maxPrice: money,
  rating: z.coerce.number().min(0).max(5).optional(),
  availability: z.enum(['in-stock', 'all']).optional(),
  sort: z.enum(['recommended', 'newest', 'price-low', 'price-high', 'rating']).default('recommended'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  // Capped so a caller cannot ask for the whole catalogue in one request.
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
}).refine(
  (value) => value.minPrice == null || value.maxPrice == null || value.minPrice <= value.maxPrice,
  { message: 'Minimum price cannot be greater than maximum price.', path: ['minPrice'] },
)

export const slugSchema = z.object({
  slug: z.string().trim().min(1).max(180).regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid slug.'),
})
