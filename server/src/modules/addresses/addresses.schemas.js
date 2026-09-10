import { z } from 'zod'

export const addressBodySchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(7).max(20),
  line1: z.string().trim().min(1).max(255),
  line2: z.string().trim().max(255).optional().default(''),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional().default(''),
  postalCode: z.string().trim().max(20).optional().default(''),
  isDefault: z.coerce.boolean().optional().default(false),
})

export const addressIdSchema = z.object({
  id: z.string().trim().min(1).max(36),
})
