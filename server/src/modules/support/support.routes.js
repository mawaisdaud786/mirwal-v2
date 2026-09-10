import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './support.controller.js'
import {
  listTicketsSchema, createTicketSchema, addMessageSchema, ticketIdSchema,
} from './support.schemas.js'

/**
 * Customer-facing support.
 *
 * The same threads the seller router exposes under `/seller/me/tickets` and the admin router
 * under `/admin/tickets` — this is the third view of one table, scoped by the controller to
 * `req.user.id`. A customer here has no `req.seller`, so `scopeOf` resolves them as the
 * requester and they see only their own tickets, with staff internal notes stripped.
 *
 * Only `requireAuth`: raising a support request is something any signed-in shopper may do,
 * and there is no permission in the seeded set that would mean "may contact support".
 */
export const supportRouter = Router()

supportRouter.use(requireAuth)

supportRouter.get('/tickets/stats', controller.ticketStats)
supportRouter.get('/tickets', validate(listTicketsSchema, 'query'), controller.listTickets)
supportRouter.get('/tickets/:id', validate(ticketIdSchema, 'params'), controller.getTicket)
supportRouter.post('/tickets', validate(createTicketSchema), controller.createTicket)
supportRouter.post('/tickets/:id/messages', validate(ticketIdSchema, 'params'), validate(addMessageSchema), controller.addMessage)
supportRouter.post('/tickets/:id/close', validate(ticketIdSchema, 'params'), controller.closeTicket)
