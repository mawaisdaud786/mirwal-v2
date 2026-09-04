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
  try { return ok(res, await service.listForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function listForAdmin(req, res, next) {
  try { return ok(res, await service.listForAdmin()) }
  catch (error) { return next(error) }
}
