import { ok } from '../../lib/errors.js'
import * as service from './disputes.service.js'

export async function listDisputes(req, res, next) {
  try { return ok(res, await service.listDisputes()) }
  catch (error) { return next(error) }
}
