import { Router } from 'express'
import { requireAuth, requireSeller, requirePermission, denyRestrictedSeller } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { dateRangeSchema } from '../../lib/rangeSchema.js'
import { orderItemIdSchema, updateOrderItemStatusSchema, returnRequestIdSchema, listSellerOrdersSchema } from '../orders/orders.schemas.js'
import * as ordersController from '../orders/orders.controller.js'
import * as paymentsController from '../payments/payments.controller.js'
import * as financeController from './finance.controller.js'
import * as customersController from './customers.controller.js'
import * as reviewsController from '../reviews/reviews.controller.js'
import * as productsController from './products.controller.js'
import * as marketingController from '../marketing/marketing.controller.js'
import * as supportController from '../support/support.controller.js'
import * as settingsController from '../settings/settings.controller.js'
import * as messagingController from '../messaging/messaging.controller.js'
import { uploadDocumentSchema, idParamSchema as docIdSchema } from '../messaging/messaging.schemas.js'
import {
  listCouponsSchema, createCouponSchema, updateCouponSchema,
  listPromotionsSchema, createPromotionSchema, updatePromotionSchema,
  idParamSchema as marketingIdSchema,
} from '../marketing/marketing.schemas.js'
import {
  listTicketsSchema, createTicketSchema, addMessageSchema, ticketIdSchema,
} from '../support/support.schemas.js'
import {
  listPayoutsSchema, requestPayoutSchema, idParamSchema as settingsIdSchema,
} from '../settings/settings.schemas.js'
import {
  productIdSchema, createProductSchema, updateProductSchema, productStatusSchema,
  variantIdSchema as sellerVariantIdSchema, updateInventorySchema as sellerInventorySchema,
} from './products.schemas.js'
import * as storeController from './store.controller.js'
import * as mediaController from '../media/media.controller.js'
import * as shipments from '../orders/shipments.controller.js'
import * as safety from '../safety/safety.controller.js'
import * as brandAuthController from '../catalog/brandAuth.controller.js'
import { writeLimiter } from '../../middleware/rateLimit.js'
import * as returns from '../orders/returns.controller.js'
import * as fulfilment from '../orders/fulfilment.controller.js'

/**
 * Seller-scoped routes.
 *
 * Every handler below filters on `req.seller.id`, which requireSeller resolved from the
 * authenticated user — never from anything the client sent. There is deliberately no route
 * that accepts a seller id as a parameter, so "read another seller's products" is not an
 * endpoint that exists to be abused.
 */
export const sellerRouter = Router()

sellerRouter.use(requireAuth, requireSeller)

/**
 * The seller's own store.
 *
 * This used to return three fields and had no PATCH beside it, so the seller panel's eight
 * store-profile screens could display nothing and save nothing.
 */
sellerRouter.get('/me/store', storeController.getStore)

sellerRouter.patch(
  '/me/store',
  requirePermission('store.write'),
  denyRestrictedSeller,
  validate(storeController.updateStoreSchema),
  storeController.updateStore,
)

/**
 * Vacation mode.
 *
 * Deliberately reachable by a restricted store: pausing new orders is a seller acting
 * responsibly, and blocking it would force them to keep taking orders they cannot fulfil.
 */
sellerRouter.patch(
  '/me/store/vacation',
  requirePermission('store.write'),
  validate(storeController.vacationSchema),
  storeController.setVacation,
)

/**
 * Identity details.
 *
 * Separate from the store profile because the rules differ: presentation is the seller's to
 * change freely, identity is not. A blank field may be filled in; changing one that was
 * already verified costs the verification it carried.
 */
/**
 * The seller's own standing. Trust only — the risk score is never returned here, because a
 * seller who can watch it move can find the thresholds and sit just under them.
 */
/**
 * Protected brands and where this seller stands with each.
 *
 * Reachable by a restricted store: asking for permission to sell a brand legitimately is not
 * a new obligation, and refusing it would leave a restricted seller unable to fix the reason
 * they were restricted.
 */
sellerRouter.get('/me/brand-authorizations', requirePermission('store.read'), brandAuthController.mine)
sellerRouter.post('/me/brand-authorizations', requirePermission('store.write'), validate(brandAuthController.requestSchema), brandAuthController.request)

sellerRouter.get('/me/trust', requirePermission('store.read'), safety.myTrust)

sellerRouter.get('/me/kyc', requirePermission('store.read'), storeController.getKyc)
sellerRouter.patch(
  '/me/kyc',
  requirePermission('store.write'),
  validate(storeController.kycSchema),
  storeController.updateKyc,
)

/**
 * Store policies — the return window, dispatch promise and the text explaining them.
 *
 * Reachable by a restricted store: tightening or clarifying your own policies is not a new
 * obligation, and blocking it would trap a seller with terms they cannot correct.
 */
sellerRouter.get('/me/policies', requirePermission('store.read'), storeController.getPolicies)
sellerRouter.patch(
  '/me/policies',
  requirePermission('store.write'),
  validate(storeController.policiesSchema),
  storeController.updatePolicies,
)

// --- Payout account ----------------------------------------------------------
//
// `payouts.destination_hint` was free text typed by staff. A seller had no way to say where
// their money should go, and a changed destination triggered nothing.

sellerRouter.get('/me/bank-accounts', requirePermission('store.read'), storeController.listBankAccounts)
sellerRouter.post(
  '/me/bank-accounts',
  requirePermission('store.write'),
  validate(storeController.bankAccountSchema),
  storeController.addBankAccount,
)
sellerRouter.get('/me/payout-eligibility', requirePermission('order.read'), storeController.payoutEligibility)

// --- Images ------------------------------------------------------------------
//
// `product_images` had no write path outside admin JSON, so a seller could not list a product
// with a photograph — which on a marketplace means they could not list a product at all.

sellerRouter.get(
  '/me/media',
  requirePermission('store.read'),
  validate(mediaController.listMediaSchema, 'query'),
  storeController.listMedia,
)
sellerRouter.post(
  '/me/media',
  requirePermission('store.write'),
  denyRestrictedSeller,
  validate(mediaController.uploadQuerySchema, 'query'),
  mediaController.uploadMiddleware,
  mediaController.uploadErrorHandler,
  mediaController.upload,
)
sellerRouter.delete(
  '/me/media/:id',
  requirePermission('store.write'),
  mediaController.remove,
)
sellerRouter.put(
  '/me/products/:id/images',
  requirePermission('catalog.product.write'),
  denyRestrictedSeller,
  validate(productIdSchema, 'params'),
  validate(mediaController.setProductImagesSchema),
  mediaController.setProductImages,
)

/**
 * A store's own listings.
 *
 * Was an inline handler with raw SQL that returned every listing the store had ever created;
 * it now pages, filters and searches in the database like every other list.
 *
 * `/me/products/status-counts` is declared before `/me/products/:id` so the literal segment is
 * not captured as a product id by the parameter route.
 */
sellerRouter.get(
  '/me/products',
  requirePermission('catalog.product.read'),
  validate(productsController.listProductsSchema, 'query'),
  productsController.listProducts,
)
sellerRouter.get('/me/products/status-counts', requirePermission('catalog.product.read'), productsController.productStatusCounts)

// Product management. `/me/products/options` is declared before `/me/products/:id` so the
// literal segment is not captured as a product id by the parameter route.
sellerRouter.get('/me/products/options', requirePermission('catalog.product.read'), productsController.getFormOptions)
sellerRouter.get('/me/products/:id', requirePermission('catalog.product.read'), validate(productIdSchema, 'params'), productsController.getProduct)
// A floodgate, not a security boundary: far above what any real seller does in a minute, far
// below what a script does. Bulk listing belongs behind an import tool, not this endpoint.
sellerRouter.post('/me/products', requirePermission('catalog.product.write'), writeLimiter, validate(createProductSchema), productsController.createProduct)
sellerRouter.patch('/me/products/:id', requirePermission('catalog.product.write'), validate(productIdSchema, 'params'), validate(updateProductSchema), productsController.updateProduct)
sellerRouter.patch('/me/products/:id/status', requirePermission('catalog.product.write'), validate(productIdSchema, 'params'), validate(productStatusSchema), productsController.setProductStatus)
sellerRouter.delete('/me/products/:id', requirePermission('catalog.product.delete'), validate(productIdSchema, 'params'), productsController.deleteProduct)
sellerRouter.patch('/me/inventory/:id', requirePermission('inventory.write'), validate(sellerVariantIdSchema, 'params'), validate(sellerInventorySchema), productsController.updateInventory)

// `/me/orders/counts` before the list so the tabs can describe the whole store.
sellerRouter.get('/me/orders/counts', requirePermission('order.read'), ordersController.sellerOrderItemCounts)
sellerRouter.get('/me/orders', requirePermission('order.read'), validate(listSellerOrdersSchema, 'query'), ordersController.listSellerOrderItems)

sellerRouter.patch(
  '/me/orders/:id/status',
  requirePermission('order.write'),
  validate(orderItemIdSchema, 'params'),
  validate(updateOrderItemStatusSchema),
  ordersController.updateSellerOrderItemStatus,
)

/**
 * Returns.
 *
 * `status` replaced the old two-outcome PATCH: a seller can now ask for more information,
 * acknowledge that the parcel arrived, refund part of a line, or send a replacement — each of
 * which previously had to be misrepresented as "approved" or "rejected". The legal moves from
 * each state live in the service, not here, so one route cannot skip a check another applies.
 */
/**
 * Cancelling what the store cannot supply, and answering the buyer.
 *
 * Neither existed. An item a seller had no stock for sat in `processing` until a human noticed,
 * and a buyer's question could only reach Mirwal — which is why so much of the support queue is
 * requests to relay a message.
 *
 * Both are `order.write`: they change what the buyer receives. A restricted store is refused,
 * because a store under enforcement should not be quietly cancelling its way out of orders.
 */
sellerRouter.patch(
  '/me/orders/:id/cancel',
  requirePermission('order.write'),
  denyRestrictedSeller,
  validate(fulfilment.orderItemIdSchema, 'params'),
  validate(fulfilment.sellerCancelSchema),
  fulfilment.cancelAsSeller,
)
sellerRouter.get('/me/order-messages', requirePermission('order.read'), validate(fulfilment.threadListSchema, 'query'), fulfilment.sellerThreads)
sellerRouter.get('/me/order-messages/unread', requirePermission('order.read'), fulfilment.sellerUnread)
sellerRouter.get('/me/orders/:id/messages', requirePermission('order.read'), validate(fulfilment.orderIdSchema, 'params'), fulfilment.sellerRead)
sellerRouter.post(
  '/me/orders/:id/messages',
  requirePermission('order.write'),
  validate(fulfilment.orderIdSchema, 'params'),
  validate(fulfilment.messageSchema),
  fulfilment.sellerWrite,
)

sellerRouter.get('/me/returns', requirePermission('order.read'), validate(returns.listSchema, 'query'), returns.sellerList)
sellerRouter.get('/me/returns/:id', requirePermission('order.read'), validate(returns.idSchema, 'params'), returns.sellerGet)
sellerRouter.post(
  '/me/returns/:id/messages',
  requirePermission('order.write'),
  validate(returns.idSchema, 'params'),
  validate(returns.messageSchema),
  returns.reply,
)

// Refunds this seller must action by hand — wallet and cash-on-delivery orders, which have
// no gateway Mirwal can reverse automatically. See payments/refunds.service.js.
sellerRouter.get('/me/refunds', requirePermission('order.read'), paymentsController.listSellerManualRefunds)
sellerRouter.patch(
  '/me/refunds/:id/settle',
  requirePermission('order.write'),
  validate(returnRequestIdSchema, 'params'),
  paymentsController.settleSellerRefund,
)

sellerRouter.patch(
  '/me/returns/:id/status',
  requirePermission('order.write'),
  validate(returns.idSchema, 'params'),
  validate(returns.advanceSchema),
  returns.advance,
)

sellerRouter.get('/me/finance', requirePermission('order.read'), validate(dateRangeSchema, 'query'), financeController.getOverview)
sellerRouter.get('/me/customers', requirePermission('order.read'), validate(customersController.listCustomersSchema, 'query'), customersController.getCustomers)
sellerRouter.get('/me/reviews', requirePermission('catalog.product.read'), validate(reviewsController.listReviewsSchema, 'query'), reviewsController.listForSeller)

/**
 * Marketing, support and payouts.
 *
 * These share their controllers with the admin panel. The difference is entirely in scope:
 * `requireSeller` has already put this store on `req.seller`, and each controller derives its
 * ownership from that — so the same handler that lets an admin see every coupon shows a seller
 * only their own, with no seller-supplied identifier anywhere in the request.
 *
 * Banners are deliberately absent: placing merchandising on Mirwal's own storefront is not a
 * seller capability.
 */
sellerRouter.get('/me/coupons/stats', requirePermission('store.read'), marketingController.couponStats)
sellerRouter.get('/me/coupons', requirePermission('store.read'), validate(listCouponsSchema, 'query'), marketingController.listCoupons)
sellerRouter.get('/me/coupons/:id', requirePermission('store.read'), validate(marketingIdSchema, 'params'), marketingController.getCoupon)
sellerRouter.post('/me/coupons', requirePermission('store.write'), validate(createCouponSchema), marketingController.createCoupon)
sellerRouter.patch('/me/coupons/:id', requirePermission('store.write'), validate(marketingIdSchema, 'params'), validate(updateCouponSchema), marketingController.updateCoupon)
sellerRouter.delete('/me/coupons/:id', requirePermission('store.write'), validate(marketingIdSchema, 'params'), marketingController.deleteCoupon)

// Coupon redemptions name the order they discounted, so coupon performance is real
// attribution. Promotion rows report what sold while the promotion ran, and say so.
sellerRouter.get('/me/marketing/performance', requirePermission('store.read'), marketingController.performance)

sellerRouter.get('/me/promotions', requirePermission('store.read'), validate(listPromotionsSchema, 'query'), marketingController.listPromotions)
sellerRouter.get('/me/promotions/:id', requirePermission('store.read'), validate(marketingIdSchema, 'params'), marketingController.getPromotion)
sellerRouter.post('/me/promotions', requirePermission('store.write'), validate(createPromotionSchema), marketingController.createPromotion)
sellerRouter.patch('/me/promotions/:id', requirePermission('store.write'), validate(marketingIdSchema, 'params'), validate(updatePromotionSchema), marketingController.updatePromotion)
sellerRouter.delete('/me/promotions/:id', requirePermission('store.write'), validate(marketingIdSchema, 'params'), marketingController.deletePromotion)

sellerRouter.get('/me/tickets/stats', requirePermission('store.read'), supportController.ticketStats)
sellerRouter.get('/me/tickets', requirePermission('store.read'), validate(listTicketsSchema, 'query'), supportController.listTickets)
sellerRouter.get('/me/tickets/:id', requirePermission('store.read'), validate(ticketIdSchema, 'params'), supportController.getTicket)
sellerRouter.post('/me/tickets', requirePermission('store.write'), writeLimiter, validate(createTicketSchema), supportController.createTicket)
sellerRouter.post('/me/tickets/:id/messages', requirePermission('store.write'), validate(ticketIdSchema, 'params'), validate(addMessageSchema), supportController.addMessage)
sellerRouter.post('/me/tickets/:id/close', requirePermission('store.write'), validate(ticketIdSchema, 'params'), supportController.closeTicket)

// What is owed right now, the withdrawal history, and the request itself. Approving and
// paying are admin actions and live only on the admin router.
sellerRouter.get('/me/balance', requirePermission('order.read'), settingsController.availableBalance)
sellerRouter.get('/me/payouts', requirePermission('order.read'), validate(listPayoutsSchema, 'query'), settingsController.listPayoutsSeller)
sellerRouter.get('/me/payouts/:id', requirePermission('order.read'), validate(settingsIdSchema, 'params'), settingsController.getPayoutSeller)
sellerRouter.post('/me/payouts', requirePermission('store.write'), validate(requestPayoutSchema), settingsController.requestPayout)

/**
 * Verification documents.
 *
 * The upload middleware runs before validation because the `docType` field arrives in the
 * same multipart body as the file — multer is what parses it into `req.body` at all.
 * Downloads are scoped to this seller: `documents.download` re-checks ownership and reports
 * someone else's document as not found rather than forbidden.
 */
sellerRouter.get('/me/documents', requirePermission('store.read'), messagingController.listDocumentsSeller)
sellerRouter.post('/me/documents', requirePermission('store.write'), messagingController.uploadMiddleware, validate(uploadDocumentSchema), messagingController.uploadDocument)
sellerRouter.get('/me/documents/:id/file', requirePermission('store.read'), validate(docIdSchema, 'params'), messagingController.downloadDocumentSeller)
sellerRouter.delete('/me/documents/:id', requirePermission('store.write'), validate(docIdSchema, 'params'), messagingController.deleteDocument)

// --- Shipments -----------------------------------------------------------------
//
// "Shipped" used to be a status with nothing behind it: no carrier, no tracking number, no
// dispatch time. Creating a shipment is what moves items to shipped, so the two can never
// disagree.
//
// Deliberately reachable by a restricted store: shipping is discharging an obligation the
// buyer is already owed, and blocking it would punish the buyer for the seller's restriction.

sellerRouter.get('/me/carriers', requirePermission('order.read'), shipments.carriers)
sellerRouter.get(
  '/me/shipments',
  requirePermission('order.read'),
  validate(shipments.listShipmentsSchema, 'query'),
  shipments.listForSeller,
)
sellerRouter.post(
  '/me/shipments',
  requirePermission('order.write'),
  validate(shipments.createShipmentSchema),
  shipments.create,
)
sellerRouter.patch(
  '/me/shipments/:id',
  requirePermission('order.write'),
  validate(shipments.shipmentIdSchema, 'params'),
  validate(shipments.updateShipmentSchema),
  shipments.updateBySeller,
)

// --- Compliance ------------------------------------------------------------------
//
// A seller could not previously see what had been decided about them, or contest it. An
// enforcement action nobody can appeal is not a policy, it is a punishment.
//
// Reachable by a restricted store on purpose: appealing a restriction is the one thing a
// restricted seller most needs to do.

sellerRouter.get('/me/compliance', requirePermission('store.read'), safety.myCompliance)
sellerRouter.post(
  '/me/compliance/:id/appeal',
  requirePermission('store.write'),
  validate(safety.caseIdSchema, 'params'),
  safety.appeal,
)

/** A seller's public answer to a review of their own product. One per review. */
sellerRouter.post(
  '/me/reviews/:id/respond',
  requirePermission('store.write'),
  denyRestrictedSeller,
  validate(safety.caseIdSchema, 'params'),
  validate(safety.caseMessageSchema),
  safety.respondToReview,
)
