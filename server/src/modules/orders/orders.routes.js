import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { createOrderSchema, orderIdSchema, orderItemIdSchema, createReturnRequestSchema } from './orders.schemas.js'
import * as controller from './orders.controller.js'

// A customer's own orders. Every handler reads req.user.id from the verified access token,
// never from the URL — there is no route that accepts a buyer id as a parameter.
export const ordersRouter = Router()

ordersRouter.use(requireAuth)

ordersRouter.post('/', validate(createOrderSchema), controller.createOrder)
ordersRouter.get('/', controller.listOrders)
// Declared before /:id so "items" is never matched as an order's public id.
ordersRouter.patch('/items/:id/cancel', validate(orderItemIdSchema, 'params'), controller.cancelOrderItem)
ordersRouter.post('/items/:id/return-request', validate(orderItemIdSchema, 'params'), validate(createReturnRequestSchema), controller.createReturnRequest)
ordersRouter.get('/:id', validate(orderIdSchema, 'params'), controller.getOrder)
