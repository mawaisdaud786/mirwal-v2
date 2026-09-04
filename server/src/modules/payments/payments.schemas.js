import { z } from 'zod'

export const startPaymentSchema = z.object({
  // 'cod' is deliberately excluded: it is settled on delivery, not through a payment step,
  // and the service rejects it explicitly rather than silently no-op'ing.
  method: z.enum(['card', 'easypaisa', 'jazzcash']),
})

export const orderIdParamSchema = z.object({
  id: z.string().trim().min(1).max(36),
})
