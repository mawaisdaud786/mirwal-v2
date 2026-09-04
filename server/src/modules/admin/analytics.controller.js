import { ok } from '../../lib/errors.js'
import * as service from './analytics.service.js'

export async function getOverview(req, res, next) {
  try { return ok(res, await service.getOverview(req.validatedQuery)) }
  catch (error) { return next(error) }
}
