import { z } from 'zod'

/**
 * Shipping validation.
 *
 * Money arrives as a string or number and is kept as a string end to end; `moneyInput`
 * refuses more than two decimal places rather than silently rounding a rate an admin typed.
 */

const publicId = z.string().trim().uuid()

const moneyInput = z.union([
  z.number().finite().nonnegative(),
  z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Use a plain amount such as 249 or 249.50.'),
])

export const idParamSchema = z.object({ id: publicId })

// --- Zones ------------------------------------------------------------------

const countryCodes = z.array(z.string().trim().length(2).regex(/^[A-Za-z]{2}$/)).max(50)
const cities = z.array(z.string().trim().min(1).max(100)).max(300)

export const createZoneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  countryCodes: countryCodes.default(['PK']),
  cities: cities.default([]),
  // Lower wins. Bounded so a stray keystroke cannot bury a zone behind every other.
  priority: z.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
})

export const updateZoneSchema = createZoneSchema.partial()

// --- Methods ----------------------------------------------------------------

export const createMethodSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional(),
  carrier: z.string().trim().max(80).optional(),
  rateType: z.enum(['flat', 'free_over', 'percentage']).default('flat'),
  baseAmount: moneyInput.default('0'),
  freeOverAmount: moneyInput.nullish(),
  // Basis points: 250 = 2.5%. Capped at 100% — a shipping fee above the basket is a typo.
  rateBps: z.number().int().min(0).max(10_000).nullish(),
  minAmount: moneyInput.nullish(),
  maxAmount: moneyInput.nullish(),
  minDays: z.number().int().min(0).max(365).nullish(),
  maxDays: z.number().int().min(0).max(365).nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
})

export const updateMethodSchema = createMethodSchema.partial()

// --- Warehouses -------------------------------------------------------------

export const createWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  // Uppercased on the way in; the unique index is case-insensitive so KHI and khi collide.
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  addressLine: z.string().trim().max(255).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.string().trim().length(2).default('PK'),
  contactPhone: z.string().trim().max(20).optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

export const updateWarehouseSchema = createWarehouseSchema.partial().omit({ code: true })

// --- Quoting ----------------------------------------------------------------

export const quoteSchema = z.object({
  countryCode: z.string().trim().length(2).default('PK'),
  city: z.string().trim().max(100).optional(),
  subtotal: z.coerce.number().finite().nonnegative().default(0),
})
