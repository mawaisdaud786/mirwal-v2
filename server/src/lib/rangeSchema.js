import { z } from 'zod'

/**
 * Shared by every real reporting endpoint (admin analytics, seller finance, ...). `from`/`to`
 * (custom range) win over `range` when both are present, so a fixed-range button and a future
 * custom date picker can drive the same endpoints without the schema caring which was used.
 */
export const dateRangeSchema = z.object({
  range: z.enum(['7d', '30d', '90d', '1y', 'all']).default('7d'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine(
  (value) => !value.from || !value.to || value.from <= value.to,
  { message: 'from must not be after to.', path: ['from'] },
)
