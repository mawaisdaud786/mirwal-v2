import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { createOrderSchema, orderIdSchema, orderItemIdSchema } from './orders.schemas.js'
import * as controller from './orders.controller.js'
import * as shipments from './shipments.controller.js'
import { couponLimiter } from '../../middleware/rateLimit.js'
import * as couponsController from './coupons.controller.js'
import * as returns from './returns.controller.js'
import { previewCouponSchema } from './coupons.controller.js'
import * as fulfilment from './fulfilment.controller.js'

// A customer's own orders. Every handler reads req.user.id from the verified access token,
// never from the URL — there is no route that accepts a buyer id as a parameter.
export const ordersRouter = Router()

ordersRouter.use(requireAuth)

/**
 * Checking a coupon before checkout.
 *
 * Carries its own limiter because a coupon code is a shared secret in a small alphabet, and an
 * endpoint that answers "no such coupon" quickly is an oracle to enumerate against. Only
 * rejections count, so a shopper trying the two codes they were sent is never affected.
 */
ordersRouter.post('/coupons/preview', couponLimiter, validate(previewCouponSchema), couponsController.preview)

ordersRouter.post('/', validate(createOrderSchema), controller.createOrder)
ordersRouter.get('/', controller.listOrders)
// Declared before /:id so "items" is never matched as an order's public id.
/**
 * Cancelling all or part of a line.
 *
 * `quantity` is optional and means the whole line when absent, so this is a superset of the
 * route it replaces rather than a breaking change.
 */
ordersRouter.patch(
  '/items/:id/cancel',
  validate(fulfilment.orderItemIdSchema, 'params'),
  validate(fulfilment.buyerCancelSchema),
  fulfilment.cancelAsBuyer,
)
ordersRouter.post('/items/:id/return-request', validate(orderItemIdSchema, 'params'), validate(returns.createSchema), returns.create)

/**
 * A buyer's returns.
 *
 * Registered before `/:id` so "returns" is never matched as an order's public id — the same
 * ordering hazard the cancel and tracking routes above are arranged around.
 *
 * `escalate` is the one that changes the balance of the marketplace: until now the seller
 * decided a return filed against themselves and that was the end of it. A buyer may now bring
 * Mirwal in on a rejection, or on a seller who has simply not answered.
 */
ordersRouter.get('/returns/mine', returns.mine)
ordersRouter.get('/returns/:id', validate(returns.idSchema, 'params'), returns.get)
ordersRouter.post('/returns/:id/cancel', validate(returns.idSchema, 'params'), returns.cancel)
ordersRouter.post('/returns/:id/posted', validate(returns.idSchema, 'params'), validate(returns.postedSchema), returns.markPosted)
ordersRouter.post('/returns/:id/escalate', validate(returns.idSchema, 'params'), validate(returns.escalateSchema), returns.escalate)
ordersRouter.post('/returns/:id/messages', validate(returns.idSchema, 'params'), validate(returns.messageSchema), returns.reply)
ordersRouter.get('/:id', validate(orderIdSchema, 'params'), controller.getOrder)

/**
 * Tracking and the order timeline.
 *
 * Declared after `/:id` would shadow them, so both are registered with their own explicit
 * paths. The buyer sees their parcels and what happened to their order; neither route reveals
 * the seller's internal notes or the proof-of-delivery photograph.
 */
/**
 * The tax invoice, and the conversation with each store on the order.
 *
 * Declared before the bare `/:id` reads below for the same reason the tracking routes are:
 * Express matches in order, and `/:id` would otherwise swallow `/:id/invoice`.
 */
ordersRouter.get('/:id/invoice', validate(fulfilment.orderIdSchema, 'params'), fulfilment.invoiceForBuyer)
ordersRouter.get('/:id/messages', validate(fulfilment.orderIdSchema, 'params'), fulfilment.buyerThreads)
ordersRouter.get('/:id/messages/:sellerId', validate(fulfilment.threadParamsSchema, 'params'), fulfilment.buyerRead)
ordersRouter.post(
  '/:id/messages/:sellerId',
  validate(fulfilment.threadParamsSchema, 'params'),
  validate(fulfilment.messageSchema),
  fulfilment.buyerWrite,
)

ordersRouter.get('/:id/tracking', validate(orderIdSchema, 'params'), shipments.trackingForBuyer)
ordersRouter.get('/:id/timeline', validate(orderIdSchema, 'params'), shipments.timelineForBuyer)
