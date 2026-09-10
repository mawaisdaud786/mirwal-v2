import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { askSchema } from './ai.schemas.js'
import * as controller from './ai.controller.js'

/**
 * AI shopping assistant. Public and unauthenticated, like the rest of product discovery —
 * it only ever reads the same active catalogue `/products` already exposes, and returns
 * nothing a shopper could not see by browsing.
 *
 * POST rather than GET because the request body is a free-text sentence: putting a shopper's
 * own words in a query string would land them in access logs and browser history.
 */
export const aiRouter = Router()

aiRouter.post('/ask', validate(askSchema), controller.ask)
