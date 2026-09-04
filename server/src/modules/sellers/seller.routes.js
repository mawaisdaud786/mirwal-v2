import { Router } from 'express'
import { query } from '../../db/pool.js'
import { ok } from '../../lib/errors.js'
import { requireAuth, requireSeller, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { dateRangeSchema } from '../../lib/rangeSchema.js'
import { orderItemIdSchema, updateOrderItemStatusSchema, returnRequestIdSchema, resolveReturnRequestSchema } from '../orders/orders.schemas.js'
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

sellerRouter.get('/me/store', (req, res) => ok(res, {
  slug: req.seller.slug,
  name: req.seller.store_name,
  status: req.seller.status,
}))

sellerRouter.get('/me/products', requirePermission('catalog.product.read'), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT p.public_id, p.slug, p.name, p.status, p.price, p.currency_code,
              p.rating_average, p.rating_count, p.created_at,
              c.slug AS category_slug, c.name AS category_name,
              COALESCE(SUM(GREATEST(i.quantity - i.reserved, 0)), 0) AS sellable
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
         LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE p.seller_id = ? AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
      [req.seller.id],
    )
    return ok(res, rows.map((row) => ({
      id: row.public_id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      price: { amount: String(row.price), currency: row.currency_code },
      rating: { average: Number(row.rating_average), count: row.rating_count },
      stock: Number(row.sellable),
      category: row.category_slug ? { slug: row.category_slug, name: row.category_name } : null,
      createdAt: row.created_at,
    })))
  } catch (error) { return next(error) }
})

// Product management. `/me/products/options` is declared before `/me/products/:id` so the
// literal segment is not captured as a product id by the parameter route.
sellerRouter.get('/me/products/options', requirePermission('catalog.product.read'), productsController.getFormOptions)
sellerRouter.get('/me/products/:id', requirePermission('catalog.product.read'), validate(productIdSchema, 'params'), productsController.getProduct)
sellerRouter.post('/me/products', requirePermission('catalog.product.write'), validate(createProductSchema), productsController.createProduct)
sellerRouter.patch('/me/products/:id', requirePermission('catalog.product.write'), validate(productIdSchema, 'params'), validate(updateProductSchema), productsController.updateProduct)
sellerRouter.patch('/me/products/:id/status', requirePermission('catalog.product.write'), validate(productIdSchema, 'params'), validate(productStatusSchema), productsController.setProductStatus)
sellerRouter.delete('/me/products/:id', requirePermission('catalog.product.delete'), validate(productIdSchema, 'params'), productsController.deleteProduct)
sellerRouter.patch('/me/inventory/:id', requirePermission('inventory.write'), validate(sellerVariantIdSchema, 'params'), validate(sellerInventorySchema), productsController.updateInventory)

sellerRouter.get('/me/orders', requirePermission('order.read'), ordersController.listSellerOrderItems)

sellerRouter.patch(
  '/me/orders/:id/status',
  requirePermission('order.write'),
  validate(orderItemIdSchema, 'params'),
  validate(updateOrderItemStatusSchema),
  ordersController.updateSellerOrderItemStatus,
)

sellerRouter.get('/me/returns', requirePermission('order.read'), ordersController.listSellerReturnRequests)

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
  validate(returnRequestIdSchema, 'params'),
  validate(resolveReturnRequestSchema),
  ordersController.resolveSellerReturnRequest,
)

sellerRouter.get('/me/finance', requirePermission('order.read'), validate(dateRangeSchema, 'query'), financeController.getOverview)
sellerRouter.get('/me/customers', requirePermission('order.read'), customersController.getCustomers)
sellerRouter.get('/me/reviews', requirePermission('catalog.product.read'), reviewsController.listForSeller)

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
sellerRouter.post('/me/tickets', requirePermission('store.write'), validate(createTicketSchema), supportController.createTicket)
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
