import { Router } from 'express'
import express from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { startPaymentSchema, orderIdParamSchema } from './payments.schemas.js'
import * as controller from './payments.controller.js'

/**
 * Buyer-facing payment routes. Webhooks are mounted separately (see webhookRouter below)
 * because they are called by the provider, not the shopper — they carry no session and must
 * not sit behind requireAuth.
 */
export const paymentsRouter = Router()

// Public: the checkout UI needs to know which methods are actually configured before the
// shopper picks one. Reveals only names and availability, never any credential.
paymentsRouter.get('/methods', controller.listMethods)

paymentsRouter.use(requireAuth)
paymentsRouter.post('/orders/:id/start', validate(orderIdParamSchema, 'params'), validate(startPaymentSchema), controller.start)
paymentsRouter.get('/orders/:id/status', validate(orderIdParamSchema, 'params'), controller.status)
paymentsRouter.get('/refunds', controller.listMyRefunds)

/**
 * Provider callbacks. Mounted at the API root rather than under /payments so the URLs given
 * to each provider's dashboard stay short and stable.
 *
 * Stripe needs the RAW body — it signs the exact bytes, so express.json() must not touch it.
 * The wallets post ordinary form-encoded fields.
 */
export const webhookRouter = Router()

webhookRouter.post('/stripe', express.raw({ type: 'application/json' }), controller.stripeWebhook)
webhookRouter.post('/easypaisa', express.urlencoded({ extended: false }), controller.easypaisaCallback)
webhookRouter.post('/jazzcash', express.urlencoded({ extended: false }), controller.jazzcashCallback)
