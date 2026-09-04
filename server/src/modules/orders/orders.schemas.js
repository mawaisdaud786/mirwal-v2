import { z } from 'zod'

/**
 * The client sends what a cart naturally has (product/variant + quantity) and a shipping
 * address. It never sends a price or a line total — the server re-prices every item from
 * the database at creation time so a tampered `unitPrice` in the request body can't ever
 * become a real order total.
 */
export const createOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(36),
    // Absent when the shopper never saw a variant picker — the product's default variant
    // is used server-side, the same variant `GET /products/:slug` already marks is_default.
    sku: z.string().trim().min(1).max(80).optional(),
    quantity: z.coerce.number().int().min(1).max(20),
  })).min(1).max(50),
  shippingAddress: z.object({
    fullName: z.string().trim().min(1).max(150),
    phone: z.string().trim().min(7).max(20),
    line1: z.string().trim().min(1).max(255),
    line2: z.string().trim().max(255).optional().default(''),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().max(100).optional().default(''),
    postalCode: z.string().trim().max(20).optional().default(''),
    countryCode: z.string().trim().length(2).toUpperCase().optional().default('PK'),
  }),
  notes: z.string().trim().max(500).optional().default(''),
  // A code, never an amount. What it is worth is decided server-side against the locked
  // coupon row, so a client cannot claim a discount it was not granted.
  couponCode: z.string().trim().min(1).max(40).optional().nullable().default(null),
  // Which delivery option the shopper picked from the quote. Re-priced server-side; an
  // option that is not actually available for the address is refused rather than substituted.
  shippingMethodId: z.string().trim().min(1).max(36).optional().nullable().default(null),
  // Which method the shopper chose. Availability is re-checked server-side against what is
  // actually configured (see payments.service.js) — a client cannot select a gateway whose
  // credentials aren't present.
  paymentMethod: z.enum(['cod', 'card', 'easypaisa', 'jazzcash']).optional().default('cod'),
})

export const orderIdSchema = z.object({
  id: z.string().trim().min(1).max(36),
})

export const updateOrderItemStatusSchema = z.object({
  status: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']),
})

export const orderItemIdSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const createReturnRequestSchema = z.object({
  reason: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional().default(''),
})

export const resolveReturnRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  resolutionNote: z.string().trim().max(500).optional().default(''),
})

export const returnRequestIdSchema = z.object({
  id: z.string().trim().min(1).max(36),
})
