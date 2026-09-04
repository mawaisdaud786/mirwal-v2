import { ok } from '../../lib/errors.js'
import * as service from './addresses.service.js'

export async function list(req, res, next) {
  try { return ok(res, await service.listAddresses(req.user.id)) }
  catch (error) { return next(error) }
}

export async function create(req, res, next) {
  try { return ok(res, await service.createAddress(req.user.id, req.body), 'Address saved.', 201) }
  catch (error) { return next(error) }
}

export async function update(req, res, next) {
  try { return ok(res, await service.updateAddress(req.user.id, req.params.id, req.body), 'Address updated.') }
  catch (error) { return next(error) }
}

export async function remove(req, res, next) {
  try { await service.deleteAddress(req.user.id, req.params.id); return ok(res, null, 'Address removed.') }
  catch (error) { return next(error) }
}
