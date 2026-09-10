import { ok } from '../../lib/errors.js'
import * as service from './customers.service.js'

export async function getCustomers(req, res, next) {
  try { return ok(res, await service.getCustomers()) }
  catch (error) { return next(error) }
}

/** One customer: what they bought, what went wrong, and what they are owed. */
export async function getCustomer(req, res, next) {
  try { return ok(res, await service.getCustomer(req.params.id)) }
  catch (error) { return next(error) }
}
