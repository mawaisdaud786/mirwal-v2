import { z } from 'zod'

/** Slug only — the API never accepts an internal product id from a client. */
export const wishlistSlugSchema = z.object({
  slug: z.string().trim().min(1).max(200),
})
