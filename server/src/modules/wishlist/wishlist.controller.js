import { ok } from '../../lib/errors.js'
import * as service from './wishlist.service.js'

export async function list(req, res, next) {
  try { return ok(res, await service.listWishlist(req.user.id)) }
  catch (error) { return next(error) }
}

export async function add(req, res, next) {
  try { return ok(res, await service.addToWishlist(req.user.id, req.body.slug)) }
  catch (error) { return next(error) }
}

export async function remove(req, res, next) {
  try { return ok(res, await service.removeFromWishlist(req.user.id, req.params.slug)) }
  catch (error) { return next(error) }
}
