import { z } from 'zod'

const publicId = z.string().trim().uuid()
const slugParam = z.string().trim().max(80).regex(/^[a-z0-9-]+$/)

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}

export const idParamSchema = z.object({ id: publicId })
export const numericIdParamSchema = z.object({ id: z.coerce.number().int().positive() })
export const slugParamSchema = z.object({ slug: slugParam })

// --- Sessions ---------------------------------------------------------------

export const listSessionsSchema = z.object({
  ...pageQuery,
  // Query strings carry "true"/"false", never booleans.
  staffOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
})

// --- Accounts ---------------------------------------------------------------

export const listAccountsSchema = z.object({
  ...pageQuery,
  status: z.enum(['active', 'pending', 'suspended', 'deleted']).optional(),
  search: z.string().trim().max(120).optional(),
})

/**
 * Only these two transitions are offered.
 *
 * `deleted` is deliberately absent: erasing an account is not something to expose behind a
 * dropdown, and `pending` is a signup state the admin panel has no business assigning.
 */
export const setAccountStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
})

// --- Notifications, reports, logs -------------------------------------------

export const listNotificationsSchema = z.object({ ...pageQuery })

export const listReportsSchema = z.object({
  ...pageQuery,
  status: z.enum(['open', 'reviewing', 'upheld', 'dismissed']).optional(),
})

export const createReportSchema = z.object({
  reason: z.enum(['counterfeit', 'prohibited', 'misleading', 'offensive', 'wrong_category', 'price', 'other']),
  details: z.string().trim().max(2000).optional(),
})

export const resolveReportSchema = z.object({
  status: z.enum(['reviewing', 'upheld', 'dismissed']),
  resolution: z.string().trim().min(3).max(500).optional(),
})

export const productSlugParamSchema = z.object({
  slug: z.string().trim().min(1).max(180),
})

export const listLogsSchema = z.object({
  ...pageQuery,
  level: z.enum(['error', 'warn', 'info']).optional(),
  code: z.string().trim().max(60).optional(),
  search: z.string().trim().max(120).optional(),
})

// --- Teams ------------------------------------------------------------------

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
})

export const teamMembershipSchema = z.object({
  userId: publicId,
  isMember: z.boolean(),
})

// --- Attributes -------------------------------------------------------------

export const createAttributeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  inputType: z.enum(['text', 'number', 'boolean', 'select']).default('text'),
  unit: z.string().trim().max(20).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  categorySlug: z.string().trim().max(140).optional(),
  isRequired: z.boolean().default(false),
  position: z.coerce.number().int().min(0).max(999).default(0),
}).refine(
  (value) => value.inputType !== 'select' || (value.options?.length ?? 0) > 0,
  { message: 'A select attribute needs at least one option.', path: ['options'] },
)
