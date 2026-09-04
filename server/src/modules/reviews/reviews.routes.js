import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { productSlugSchema, createReviewSchema } from './reviews.schemas.js'
import * as controller from './reviews.controller.js'

/**
 * Reading a product's reviews is public — they are part of the storefront listing.
 * Writing one requires a session, and the service additionally requires that the review
 * reference the buyer's own delivered order item, so authentication alone is not enough.
 */
export const reviewsRouter = Router()

reviewsRouter.get('/product/:slug', validate(productSlugSchema, 'params'), controller.listForProduct)
reviewsRouter.get('/mine/pending', requireAuth, controller.listReviewable)
reviewsRouter.post('/', requireAuth, validate(createReviewSchema), controller.create)
