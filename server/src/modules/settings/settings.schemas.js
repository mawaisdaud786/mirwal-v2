import { z } from 'zod'
import { WEBHOOK_EVENTS } from './settings.service.js'

const publicId = z.string().trim().uuid()

export const idParamSchema = z.object({ id: publicId })

export const listSettingsSchema = z.object({
  category: z.string().trim().max(40).optional(),
})

/**
 * A settings save is a map of key → value.
 *
 * The values are heterogeneous (booleans, numbers, strings) so the schema only guarantees the
 * shape; the service checks each value against the `value_type` recorded for that key, which
 * is the authoritative definition and cannot be bypassed from the client.
 */
export const updateSettingsSchema = z.object({
  updates: z.record(
    z.string().trim().max(120),
    z.union([z.boolean(), z.number(), z.string().max(2000)]),
  ).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one setting.' }),
})

export const providerParamSchema = z.object({
  provider: z.string().trim().max(60).regex(/^[a-z0-9_-]+$/i),
})

export const updateIntegrationSchema = z.object({
  status: z.enum(['disconnected', 'connected', 'error']).optional(),
  // Non-secret configuration only. Credentials belong in the environment; see the module note.
  config: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

// --- Webhooks ---------------------------------------------------------------

export const createWebhookSchema = z.object({
  name: z.string().trim().min(2).max(120),
  // https is re-checked in the service; stated here so the client gets a field-level message.
  url: z.string().trim().url().max(500).startsWith('https://', 'Webhook URLs must use https.'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event.').max(WEBHOOK_EVENTS.length),
})

export const updateWebhookSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  url: z.string().trim().url().max(500).startsWith('https://', 'Webhook URLs must use https.').optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

// --- Payouts ----------------------------------------------------------------

export const listPayoutsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['requested', 'approved', 'processing', 'paid', 'rejected', 'failed']).optional(),
})

export const requestPayoutSchema = z.object({
  method: z.enum(['bank_transfer', 'jazzcash', 'easypaisa']).default('bank_transfer'),
  // A human-readable hint only — Mirwal never stores full bank details.
  destinationHint: z.string().trim().max(120).nullish(),
})

export const updatePayoutSchema = z.object({
  status: z.enum(['approved', 'processing', 'paid', 'rejected', 'failed']),
  externalReference: z.string().trim().max(120).optional(),
  failureReason: z.string().trim().min(3).max(255).optional(),
  notes: z.string().trim().max(500).optional(),
})

// --- Roles ------------------------------------------------------------------

export const roleSlugSchema = z.object({
  slug: z.string().trim().max(50).regex(/^[a-z_]+$/),
})

export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().max(80)).max(200),
})
