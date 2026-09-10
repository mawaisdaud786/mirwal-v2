import { z } from 'zod'
import { ok } from '../../lib/errors.js'
import * as service from './reviews.service.js'

export async function listForProduct(req, res, next) {
  try { return ok(res, await service.listForProduct(req.params.slug)) }
  catch (error) { return next(error) }
}

export async function listReviewable(req, res, next) {
  try { return ok(res, { items: await service.listReviewable(req.user.id) }) }
  catch (error) { return next(error) }
}

export async function create(req, res, next) {
  try { return ok(res, await service.createReview(req.user.id, req.body), 'Thanks for your review.', 201) }
  catch (error) { return next(error) }
}

export async function listForSeller(req, res, next) {
  try {
    const params = req.validatedQuery ?? {}
    const result = await service.listForSeller(req.seller.id, params)
    return ok(res, { reviews: result.reviews, summary: result.summary, pagination: {
      page: params.page ?? 1, pageSize: params.pageSize ?? 25, total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / (params.pageSize ?? 25))),
    } })
  } catch (error) { return next(error) }
}

export const listReviewsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().trim().max(120).optional().default(''),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  needsAttention: z.coerce.boolean().optional().default(false),
})

export async function listForAdmin(req, res, next) {
  try {
    const params = req.validatedQuery ?? {}
    const result = await service.listForAdmin(params)
    // The summary rides alongside the page rather than inside it: it describes every review,
    // and burying it in `pagination` would imply it described the page.
    return ok(res, { reviews: result.reviews, summary: result.summary, pagination: {
      page: params.page, pageSize: params.pageSize, total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / params.pageSize)),
    } })
  } catch (error) { return next(error) }
}
