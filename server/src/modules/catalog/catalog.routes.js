import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { optionalAuth } from '../../middleware/auth.js'
import { listProductsSchema, slugSchema } from './catalog.schemas.js'
import * as controller from './catalog.controller.js'
import * as operations from '../admin/operations.controller.js'
import { createReportSchema, productSlugParamSchema } from '../admin/operations.schemas.js'
import * as shipping from '../shipping/shipping.controller.js'
import { quoteSchema } from '../shipping/shipping.schemas.js'

// Public reads, plus the one public write: reporting a listing.
export const catalogRouter = Router()

catalogRouter.get('/products', validate(listProductsSchema, 'query'), controller.listProducts)
// Declared before /products/:slug so "facets" is not matched as a product slug.
catalogRouter.get('/products/facets', controller.getFacets)
catalogRouter.get('/products/:slug', validate(slugSchema, 'params'), controller.getProduct)

/**
 * Report a listing.
 *
 * `optionalAuth` rather than `requireAuth`: a visitor who has not signed in can still be
 * looking at a counterfeit, and refusing their report would lose the signal. A signed-in
 * reporter is recorded so the one-open-report-per-person rule can apply; an anonymous one is
 * accepted without it.
 */
catalogRouter.post(
  '/products/:slug/report',
  optionalAuth,
  validate(productSlugParamSchema, 'params'),
  validate(createReportSchema),
  operations.createProductReport,
)

/**
 * What delivery costs to one address.
 *
 * Public, like the rest of the catalogue: a shopper has to see a delivery price before
 * signing in, and this returns nothing but the marketplace's own published rates.
 */
catalogRouter.get('/shipping/quote', validate(quoteSchema, 'query'), shipping.quote)

/**
 * The published delivery zones and rates.
 *
 * Public because they already are: a shopper sees these prices at checkout, and a seller has
 * to be able to see what buyers are charged to deliver their goods. Only active zones and
 * active methods are returned — a draft rate is not a published one.
 */
catalogRouter.get('/shipping/zones', shipping.publicZones)

catalogRouter.get('/categories', controller.listCategories)
catalogRouter.get('/categories/:slug', validate(slugSchema, 'params'), controller.getCategory)

catalogRouter.get('/brands', controller.listBrands)

catalogRouter.get('/sellers', controller.listSellers)
catalogRouter.get('/sellers/:slug', validate(slugSchema, 'params'), controller.getSeller)
