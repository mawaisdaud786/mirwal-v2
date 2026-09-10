import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { wishlistSlugSchema } from './wishlist.schemas.js'
import * as controller from './wishlist.controller.js'

// A shopper's own wishlist. Every handler reads req.user.id from the verified access token;
// no route accepts a user id as a parameter, so one account can never read or edit another's.
export const wishlistRouter = Router()

wishlistRouter.use(requireAuth)

wishlistRouter.get('/', controller.list)
wishlistRouter.post('/', validate(wishlistSlugSchema), controller.add)
wishlistRouter.delete('/:slug', validate(wishlistSlugSchema, 'params'), controller.remove)
