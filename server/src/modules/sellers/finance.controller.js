import { ok } from '../../lib/errors.js'
import * as service from './finance.service.js'

export async function getOverview(req, res, next) {
  try { return ok(res, await service.getOverview(req.seller.id, req.validatedQuery)) }
  catch (error) { return next(error) }
}
