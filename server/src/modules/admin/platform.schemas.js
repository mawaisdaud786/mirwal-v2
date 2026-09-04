import { z } from 'zod'

/** Validation for the security, platform and fulfilment admin endpoints. */

const publicId = z.string().trim().uuid()

export const platformIdParamSchema = z.object({ id: publicId })

// --- Maintenance ------------------------------------------------------------

export const updateMaintenanceSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().trim().max(500).optional(),
  // Plain IPv4/IPv6 literals only. No CIDR: a range is easy to widen by accident, and
  // "0.0.0.0/0" in an allowlist silently turns maintenance mode off for everyone.
  allowIps: z.array(z.string().trim().min(3).max(45)).max(50).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nothing to change.' },
)

export const listBackupsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// --- Two-factor -------------------------------------------------------------

// Spaces stripped first: authenticator apps display "123 456" and people copy it that way.
export const twoFactorCodeSchema = z.object({
  code: z.string().trim().transform((value) => value.replace(/\s/g, ''))
    .refine((value) => /^\d{6}$/.test(value), 'Enter the six-digit code from your authenticator app.'),
})

/**
 * Disabling two-factor and reissuing recovery codes both require the password.
 *
 * No maximum length and no character rules — this is a comparison against a stored hash, not
 * a new password, so constraining it here could only reject a valid one.
 */
export const passwordConfirmSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.'),
})

export const updateSecurityPolicySchema = z.object({
  requireTwoFactorForStaff: z.boolean(),
})

// --- Returns and refunds ----------------------------------------------------

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}

export const listReturnsSchema = z.object({
  ...pageQuery,
  status: z.enum(['requested', 'approved', 'rejected']).optional(),
})

export const listRefundsSchema = z.object({
  ...pageQuery,
  status: z.enum(['pending', 'manual_required', 'succeeded', 'failed']).optional(),
})

/**
 * Settling a refund by hand.
 *
 * Only `succeeded` and `failed` are offered: an admin cannot move a refund back to pending,
 * which would erase the fact that it was already acted on.
 */
export const settleRefundSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  // Whatever proves the money moved — a bank reference, a wallet transaction id.
  reference: z.string().trim().max(191).optional(),
  note: z.string().trim().max(255).optional(),
})
