import { z } from 'zod'

export const productSlugSchema = z.object({
  slug: z.string().trim().min(1).max(200),
})

export const createReviewSchema = z.object({
  // The buyer's own delivered order item — proof of purchase. Numeric, matching the id
  // every other order-item route already uses (orders.schemas.orderItemIdSchema).
  orderItemId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(150).optional().default(''),
  body: z.string().trim().min(10, 'Please write at least a sentence.').max(4000),
})
