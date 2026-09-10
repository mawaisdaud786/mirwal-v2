import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import * as brandAuth from './brandAuth.service.js'

/** Brand authorisation, from both sides. */

export const requestSchema = z.object({
  brandSlug: z.string().trim().min(1).max(140),
  // The authorisation letter or distributor agreement, already uploaded as a seller document.
  documentId: z.string().trim().max(36).optional().nullable(),
})

export const listSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'revoked', 'expired']).optional().default('pending'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})

export const decideSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().max(1000).optional().nullable(),
  // Distribution agreements end; an authorisation that outlives its paperwork is not one.
  validUntil: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional().nullable(),
}).refine(
  (value) => value.approved || (value.note && value.note.length >= 3),
  { message: 'Say why it was refused — the seller sees this.', path: ['note'] },
)

export const gateSchema = z.object({
  gated: z.boolean(),
  note: z.string().trim().max(500).optional().nullable(),
})

// --- seller ------------------------------------------------------------------

export async function mine(req, res, next) {
  try { return ok(res, await brandAuth.listForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function request(req, res, next) {
  try {
    const result = await brandAuth.request(req.seller.id, req.body.brandSlug, { documentId: req.body.documentId })
    return ok(res, result, `Mirwal will review your authorisation for ${result.brand}.`, 201)
  } catch (error) { return next(error) }
}

// --- reviewer ----------------------------------------------------------------

export async function list(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total } = await brandAuth.listForAdmin({ page, pageSize, status })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function decide(req, res, next) {
  try {
    const result = await brandAuth.decide(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: req.body.approved ? AUDIT.BRAND_AUTHORIZED : AUDIT.BRAND_AUTHORIZATION_REVOKED,
      entityType: 'brand_authorization',
      entityId: req.params.id,
      metadata: { brand: result.brand, validUntil: req.body.validUntil ?? null },
    })
    return ok(res, result, `${result.brand} authorisation ${result.status}.`)
  } catch (error) { return next(error) }
}

export async function setGate(req, res, next) {
  try {
    const result = await brandAuth.setGated(req.params.slug, req.body)
    await recordAudit(req, {
      action: AUDIT.BRAND_UPDATED,
      entityType: 'brand',
      entityId: req.params.slug,
      metadata: { gated: result.gated },
    })
    return ok(res, result, result.gated
      ? `${result.brand} now requires authorisation to list against.`
      : `${result.brand} is open to any seller again.`)
  } catch (error) { return next(error) }
}
