import { z } from 'zod'

export const notificationIdSchema = z.object({
  id: z.string().trim().min(1).max(36),
})
