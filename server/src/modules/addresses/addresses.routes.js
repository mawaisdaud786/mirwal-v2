import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { addressBodySchema, addressIdSchema } from './addresses.schemas.js'
import * as controller from './addresses.controller.js'

// A buyer's own saved addresses. Every handler reads req.user.id from the verified access
// token; no route accepts a user id as a parameter.
export const addressesRouter = Router()

addressesRouter.use(requireAuth)

addressesRouter.get('/', controller.list)
addressesRouter.post('/', validate(addressBodySchema), controller.create)
addressesRouter.put('/:id', validate(addressIdSchema, 'params'), validate(addressBodySchema), controller.update)
addressesRouter.delete('/:id', validate(addressIdSchema, 'params'), controller.remove)
