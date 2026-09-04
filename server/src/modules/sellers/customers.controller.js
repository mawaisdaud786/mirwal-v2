import { ok } from '../../lib/errors.js'
import * as service from './customers.service.js'

export async function getCustomers(req, res, next) {
  try { return ok(res, await service.getCustomers(req.seller.id)) }
  catch (error) { return next(error) }
}
