import { Router } from 'express'
import { requireAuth, requireRole, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { orderIdSchema } from '../orders/orders.schemas.js'
import * as ordersController from '../orders/orders.controller.js'
import { analyticsRangeSchema } from './analytics.schemas.js'
import * as analyticsController from './analytics.controller.js'
import * as customersController from './customers.controller.js'
import * as reviewsController from '../reviews/reviews.controller.js'
import * as disputesController from './disputes.controller.js'
import * as management from './management.controller.js'
import * as marketing from '../marketing/marketing.controller.js'
import * as support from '../support/support.controller.js'
import * as settings from '../settings/settings.controller.js'
import * as operations from './operations.controller.js'
import * as messaging from '../messaging/messaging.controller.js'
import {
  listTemplatesSchema, templateParamSchema, updateTemplateSchema, listDeliveriesSchema,
  sendTestSchema, listDocumentsSchema, reviewDocumentSchema, idParamSchema as msgIdParamSchema,
} from '../messaging/messaging.schemas.js'
import {
  listSessionsSchema, listAccountsSchema, setAccountStatusSchema, listNotificationsSchema,
  listReportsSchema, resolveReportSchema, listLogsSchema, createTeamSchema, teamMembershipSchema,
  createAttributeSchema, idParamSchema as opsIdParamSchema,
  numericIdParamSchema, slugParamSchema as opsSlugParamSchema,
} from './operations.schemas.js'
import {
  listCouponsSchema, createCouponSchema, updateCouponSchema,
  listPromotionsSchema, createPromotionSchema, updatePromotionSchema,
  listBannersSchema, createBannerSchema, updateBannerSchema,
  idParamSchema,
} from '../marketing/marketing.schemas.js'
import {
  listTicketsSchema, updateTicketSchema, addMessageSchema, ticketIdSchema,
} from '../support/support.schemas.js'
import {
  listSettingsSchema, updateSettingsSchema, providerParamSchema, updateIntegrationSchema,
  createWebhookSchema, updateWebhookSchema, idParamSchema as settingsIdParamSchema,
  listPayoutsSchema, updatePayoutSchema, roleSlugSchema, setRolePermissionsSchema,
} from '../settings/settings.schemas.js'
import * as platform from './platform.controller.js'
import * as shipping from '../shipping/shipping.controller.js'
import {
  updateMaintenanceSchema, listBackupsSchema, twoFactorCodeSchema, passwordConfirmSchema,
  updateSecurityPolicySchema, listReturnsSchema, listRefundsSchema, settleRefundSchema,
  platformIdParamSchema,
} from './platform.schemas.js'
import {
  createZoneSchema, updateZoneSchema, createMethodSchema, updateMethodSchema,
  createWarehouseSchema, updateWarehouseSchema, idParamSchema as shippingIdParamSchema,
} from '../shipping/shipping.schemas.js'
import { dateRangeSchema } from '../../lib/rangeSchema.js'
import {
  listProductsSchema, createProductSchema, updateProductSchema, productApprovalSchema,
  productStatusSchema, productIdSchema,
  createCategorySchema, updateCategorySchema, createBrandSchema, updateBrandSchema, slugParamSchema,
  listInventorySchema, updateInventorySchema, variantIdSchema,
  listSellersSchema, sellerIdSchema, sellerReasonSchema,
  listAuditSchema,
} from './management.schemas.js'

/**
 * Admin-scoped routes.
 *
 * Everything below sits behind requireAuth + requireRole('admin','super_admin'), and each
 * route additionally names the granular permission it needs. Role is the coarse gate that
 * keeps customers and sellers out entirely; the permission is what lets a future "catalogue
 * manager" role exist without editing route definitions — which is why reads and writes are
 * separated even where both are currently granted to the same role
 * (`catalog.product.read` vs `.write` vs `.approve`).
 *
 * The permission slugs used here were all seeded by migration 001; none is invented.
 */
export const adminRouter = Router()

adminRouter.use(requireAuth, requireRole('admin', 'super_admin'))

// --- Orders -----------------------------------------------------------------
adminRouter.get('/orders', requirePermission('order.read'), ordersController.listOrdersAdmin)
adminRouter.get('/orders/:id', requirePermission('order.read'), validate(orderIdSchema, 'params'), ordersController.getOrderAdmin)

// --- Reporting --------------------------------------------------------------
adminRouter.get('/analytics', requirePermission('analytics.read'), validate(analyticsRangeSchema, 'query'), analyticsController.getOverview)
adminRouter.get('/customers', requirePermission('order.read'), customersController.getCustomers)
adminRouter.get('/reviews', requirePermission('order.read'), reviewsController.listForAdmin)
adminRouter.get('/disputes', requirePermission('order.read'), disputesController.listDisputes)

// --- Products ---------------------------------------------------------------
// `/products/status-counts` is declared before `/products/:id` so the literal segment is not
// swallowed by the parameter route and parsed as a product id.
adminRouter.get('/products/status-counts', requirePermission('catalog.product.read'), management.getProductStatusCounts)
adminRouter.get('/products', requirePermission('catalog.product.read'), validate(listProductsSchema, 'query'), management.listProducts)
adminRouter.get('/products/:id', requirePermission('catalog.product.read'), validate(productIdSchema, 'params'), management.getProduct)
adminRouter.post('/products', requirePermission('catalog.product.write'), validate(createProductSchema), management.createProduct)
adminRouter.patch('/products/:id', requirePermission('catalog.product.write'), validate(productIdSchema, 'params'), validate(updateProductSchema), management.updateProduct)
adminRouter.patch('/products/:id/status', requirePermission('catalog.product.write'), validate(productIdSchema, 'params'), validate(productStatusSchema), management.setProductStatus)
// Approval is its own permission: deciding what goes live on the marketplace is a different
// authority from editing a listing's copy.
adminRouter.patch('/products/:id/approval', requirePermission('catalog.product.approve'), validate(productIdSchema, 'params'), validate(productApprovalSchema), management.setProductApproval)
adminRouter.delete('/products/:id', requirePermission('catalog.product.delete'), validate(productIdSchema, 'params'), management.deleteProduct)

// --- Categories -------------------------------------------------------------
adminRouter.get('/categories', requirePermission('catalog.category.read'), management.listCategories)
adminRouter.post('/categories', requirePermission('catalog.category.write'), validate(createCategorySchema), management.createCategory)
adminRouter.patch('/categories/:slug', requirePermission('catalog.category.write'), validate(slugParamSchema, 'params'), validate(updateCategorySchema), management.updateCategory)
adminRouter.delete('/categories/:slug', requirePermission('catalog.category.write'), validate(slugParamSchema, 'params'), management.deleteCategory)

// --- Brands -----------------------------------------------------------------
adminRouter.get('/brands', requirePermission('catalog.brand.read'), management.listBrands)
adminRouter.post('/brands', requirePermission('catalog.brand.write'), validate(createBrandSchema), management.createBrand)
adminRouter.patch('/brands/:slug', requirePermission('catalog.brand.write'), validate(slugParamSchema, 'params'), validate(updateBrandSchema), management.updateBrand)
adminRouter.delete('/brands/:slug', requirePermission('catalog.brand.write'), validate(slugParamSchema, 'params'), management.deleteBrand)

// --- Inventory --------------------------------------------------------------
adminRouter.get('/inventory', requirePermission('inventory.read'), validate(listInventorySchema, 'query'), management.listInventory)
adminRouter.patch('/inventory/:id', requirePermission('inventory.write'), validate(variantIdSchema, 'params'), validate(updateInventorySchema), management.updateInventory)

// --- Sellers ----------------------------------------------------------------
// The seller-applications queue is `GET /sellers?status=pending` — an application is a store
// awaiting a decision, not a separate entity, so it is not a separate endpoint.
adminRouter.get('/sellers/status-counts', requirePermission('seller.read'), management.getSellerStatusCounts)
adminRouter.get('/sellers', requirePermission('seller.read'), validate(listSellersSchema, 'query'), management.listSellers)
adminRouter.get('/sellers/:id', requirePermission('seller.read'), validate(sellerIdSchema, 'params'), management.getSeller)
adminRouter.post('/sellers/:id/approve', requirePermission('seller.approve'), validate(sellerIdSchema, 'params'), management.approveSeller)
adminRouter.post('/sellers/:id/reject', requirePermission('seller.approve'), validate(sellerIdSchema, 'params'), validate(sellerReasonSchema), management.rejectSeller)
adminRouter.post('/sellers/:id/suspend', requirePermission('seller.suspend'), validate(sellerIdSchema, 'params'), validate(sellerReasonSchema), management.suspendSeller)
adminRouter.post('/sellers/:id/reinstate', requirePermission('seller.suspend'), validate(sellerIdSchema, 'params'), management.reinstateSeller)

// --- Audit ------------------------------------------------------------------
adminRouter.get('/audit-logs/filters', requirePermission('audit.read'), management.auditFilters)
adminRouter.get('/audit-logs', requirePermission('audit.read'), validate(listAuditSchema, 'query'), management.listAudit)

// --- Marketing: coupons -----------------------------------------------------
// Marketing has no dedicated permission in the seeded set, so these sit behind
// `settings.manage` — the closest existing grant for "may change what the marketplace
// promotes". Inventing a permission slug here would name something no role actually holds.
adminRouter.get('/coupons/stats', requirePermission('settings.manage'), marketing.couponStats)
adminRouter.get('/coupons', requirePermission('settings.manage'), validate(listCouponsSchema, 'query'), marketing.listCoupons)
adminRouter.get('/coupons/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), marketing.getCoupon)
adminRouter.post('/coupons', requirePermission('settings.manage'), validate(createCouponSchema), marketing.createCoupon)
adminRouter.patch('/coupons/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), validate(updateCouponSchema), marketing.updateCoupon)
adminRouter.delete('/coupons/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), marketing.deleteCoupon)

// --- Marketing: promotions, campaigns, flash sales ---------------------------
// One endpoint serves all three surfaces; `?kind=` selects which the page is showing.
adminRouter.get('/promotions', requirePermission('settings.manage'), validate(listPromotionsSchema, 'query'), marketing.listPromotions)
adminRouter.get('/promotions/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), marketing.getPromotion)
adminRouter.post('/promotions', requirePermission('settings.manage'), validate(createPromotionSchema), marketing.createPromotion)
adminRouter.patch('/promotions/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), validate(updatePromotionSchema), marketing.updatePromotion)
adminRouter.delete('/promotions/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), marketing.deletePromotion)

// --- Marketing: banners ------------------------------------------------------
adminRouter.get('/marketing/performance', requirePermission('analytics.read'), marketing.performance)
adminRouter.get('/banners', requirePermission('settings.manage'), validate(listBannersSchema, 'query'), marketing.listBanners)
adminRouter.post('/banners', requirePermission('settings.manage'), validate(createBannerSchema), marketing.createBanner)
adminRouter.patch('/banners/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), validate(updateBannerSchema), marketing.updateBanner)
adminRouter.delete('/banners/:id', requirePermission('settings.manage'), validate(idParamSchema, 'params'), marketing.deleteBanner)

// --- Support queue (the admin side of the threads sellers and customers open) -
adminRouter.get('/tickets/stats', requirePermission('order.read'), support.ticketStats)
adminRouter.get('/tickets', requirePermission('order.read'), validate(listTicketsSchema, 'query'), support.listTickets)
adminRouter.get('/tickets/:id', requirePermission('order.read'), validate(ticketIdSchema, 'params'), support.getTicket)
adminRouter.post('/tickets/:id/messages', requirePermission('order.write'), validate(ticketIdSchema, 'params'), validate(addMessageSchema), support.addMessage)
adminRouter.patch('/tickets/:id', requirePermission('order.write'), validate(ticketIdSchema, 'params'), validate(updateTicketSchema), support.updateTicket)

// --- Payouts -----------------------------------------------------------------
adminRouter.get('/payouts/stats', requirePermission('settings.manage'), settings.payoutStats)
adminRouter.get('/payouts', requirePermission('settings.manage'), validate(listPayoutsSchema, 'query'), settings.listPayoutsAdmin)
adminRouter.get('/payouts/:id', requirePermission('settings.manage'), validate(settingsIdParamSchema, 'params'), settings.getPayoutAdmin)
adminRouter.patch('/payouts/:id', requirePermission('settings.manage'), validate(settingsIdParamSchema, 'params'), validate(updatePayoutSchema), settings.updatePayout)

// --- Platform settings, integrations, webhooks -------------------------------
adminRouter.get('/settings', requirePermission('settings.manage'), validate(listSettingsSchema, 'query'), settings.listSettings)
adminRouter.patch('/settings', requirePermission('settings.manage'), validate(updateSettingsSchema), settings.updateSettings)

adminRouter.get('/integrations', requirePermission('settings.manage'), settings.listIntegrations)
adminRouter.patch('/integrations/:provider', requirePermission('settings.manage'), validate(providerParamSchema, 'params'), validate(updateIntegrationSchema), settings.updateIntegration)

adminRouter.get('/webhooks', requirePermission('settings.manage'), settings.listWebhooks)
adminRouter.post('/webhooks', requirePermission('settings.manage'), validate(createWebhookSchema), settings.createWebhook)
adminRouter.patch('/webhooks/:id', requirePermission('settings.manage'), validate(settingsIdParamSchema, 'params'), validate(updateWebhookSchema), settings.updateWebhook)
adminRouter.post('/webhooks/:id/rotate-secret', requirePermission('settings.manage'), validate(settingsIdParamSchema, 'params'), settings.rotateWebhookSecret)
adminRouter.delete('/webhooks/:id', requirePermission('settings.manage'), validate(settingsIdParamSchema, 'params'), settings.deleteWebhook)

// --- Roles & access control --------------------------------------------------
// Reads use `role.manage` too: seeing exactly who can do what is itself sensitive, and this
// is the same permission that gates changing it.
adminRouter.get('/roles', requirePermission('role.manage'), settings.listRoles)
adminRouter.get('/permissions', requirePermission('role.manage'), settings.listPermissions)
adminRouter.get('/access-matrix', requirePermission('role.manage'), settings.accessMatrix)
adminRouter.get('/roles/:slug', requirePermission('role.manage'), validate(roleSlugSchema, 'params'), settings.getRole)
adminRouter.put('/roles/:slug/permissions', requirePermission('role.manage'), validate(roleSlugSchema, 'params'), validate(setRolePermissionsSchema), settings.setRolePermissions)

// --- Staff, sessions and accounts --------------------------------------------
adminRouter.get('/staff', requirePermission('user.read'), operations.listStaff)
adminRouter.get('/sessions', requirePermission('user.read'), validate(listSessionsSchema, 'query'), operations.listSessions)
// Ending a session is a security action, not a user edit, so it needs `user.suspend`.
adminRouter.delete('/sessions/:id', requirePermission('user.suspend'), validate(numericIdParamSchema, 'params'), operations.revokeSession)
adminRouter.post('/accounts/:id/revoke-sessions', requirePermission('user.suspend'), validate(opsIdParamSchema, 'params'), operations.revokeAllSessions)

adminRouter.get('/accounts', requirePermission('user.read'), validate(listAccountsSchema, 'query'), operations.listAccounts)
adminRouter.patch('/accounts/:id/status', requirePermission('user.suspend'), validate(opsIdParamSchema, 'params'), validate(setAccountStatusSchema), operations.setAccountStatus)

// --- Notifications and seller performance ------------------------------------
adminRouter.get('/notifications', requirePermission('user.read'), validate(listNotificationsSchema, 'query'), operations.listNotifications)
adminRouter.get('/seller-performance', requirePermission('seller.read'), operations.sellerPerformance)

// --- Product reports ----------------------------------------------------------
adminRouter.get('/product-reports', requirePermission('catalog.product.read'), validate(listReportsSchema, 'query'), operations.listProductReports)
adminRouter.patch('/product-reports/:id', requirePermission('catalog.product.approve'), validate(opsIdParamSchema, 'params'), validate(resolveReportSchema), operations.resolveProductReport)

// --- System logs --------------------------------------------------------------
// `audit.read` rather than a new permission: both answer "what happened on this platform",
// and an operator trusted with one is trusted with the other.
adminRouter.get('/system-logs', requirePermission('audit.read'), validate(listLogsSchema, 'query'), operations.listSystemLogs)

// --- Teams --------------------------------------------------------------------
adminRouter.get('/teams', requirePermission('user.read'), operations.listTeams)
adminRouter.post('/teams', requirePermission('role.manage'), validate(createTeamSchema), operations.createTeam)
adminRouter.post('/teams/:slug/members', requirePermission('role.manage'), validate(opsSlugParamSchema, 'params'), validate(teamMembershipSchema), operations.setTeamMembership)
adminRouter.delete('/teams/:slug', requirePermission('role.manage'), validate(opsSlugParamSchema, 'params'), operations.deleteTeam)

// --- Attributes ----------------------------------------------------------------
adminRouter.get('/attributes', requirePermission('catalog.product.read'), operations.listAttributes)
adminRouter.post('/attributes', requirePermission('catalog.product.write'), validate(createAttributeSchema), operations.createAttribute)
adminRouter.delete('/attributes/:slug', requirePermission('catalog.product.write'), validate(opsSlugParamSchema, 'params'), operations.deleteAttribute)

// --- Messaging: templates, delivery log, capability --------------------------
// Real sending, through SMTP/an SMS gateway configured in the environment. A channel with no
// credentials reports as unavailable and records `skipped` rather than pretending to send.
adminRouter.get('/messaging/capabilities', requirePermission('settings.manage'), messaging.capabilities)
adminRouter.post('/messaging/test-connection', requirePermission('settings.manage'), messaging.testConnection)
adminRouter.get('/messaging/templates', requirePermission('settings.manage'), validate(listTemplatesSchema, 'query'), messaging.listTemplates)
adminRouter.patch('/messaging/templates/:channel/:key', requirePermission('settings.manage'), validate(templateParamSchema, 'params'), validate(updateTemplateSchema), messaging.updateTemplate)
adminRouter.get('/messaging/deliveries', requirePermission('settings.manage'), validate(listDeliveriesSchema, 'query'), messaging.listDeliveries)
adminRouter.post('/messaging/send-test', requirePermission('settings.manage'), validate(sendTestSchema), messaging.sendTest)

// --- Seller verification documents --------------------------------------------
// `seller.approve` rather than `seller.read`: seeing someone's CNIC is the same authority as
// deciding whether their store may trade.
adminRouter.get('/seller-documents', requirePermission('seller.approve'), validate(listDocumentsSchema, 'query'), messaging.listDocumentsAdmin)
adminRouter.get('/seller-documents/:id/file', requirePermission('seller.approve'), validate(msgIdParamSchema, 'params'), messaging.downloadDocumentAdmin)
adminRouter.patch('/seller-documents/:id', requirePermission('seller.approve'), validate(msgIdParamSchema, 'params'), validate(reviewDocumentSchema), messaging.reviewDocument)

// --- Analytics: marketplace, sellers, customers, finance, search ------------
//
// One endpoint per admin analytics page. Each aggregates orders, payouts, refunds or search
// telemetry that already exists; none of them writes anything.

adminRouter.get('/insights/marketplace', requirePermission('analytics.read'), validate(dateRangeSchema, 'query'), platform.marketplaceAnalytics)
adminRouter.get('/insights/sellers', requirePermission('analytics.read'), validate(dateRangeSchema, 'query'), platform.sellerAnalytics)
adminRouter.get('/insights/customers', requirePermission('analytics.read'), validate(dateRangeSchema, 'query'), platform.customerAnalytics)
adminRouter.get('/insights/finance', requirePermission('analytics.read'), validate(dateRangeSchema, 'query'), platform.financeAnalytics)
adminRouter.get('/insights/search', requirePermission('analytics.read'), validate(dateRangeSchema, 'query'), platform.searchAnalytics)
adminRouter.get('/insights/recommendations', requirePermission('analytics.read'), platform.recommendationInsights)
adminRouter.get('/insights/stores/:id', requirePermission('seller.read'), platform.sellerActivity)

// --- Returns, refunds and disputes ------------------------------------------
//
// Read-only apart from settling a manual refund. Approving a return stays with the seller it
// was filed against.

adminRouter.get('/returns', requirePermission('order.read'), validate(listReturnsSchema, 'query'), platform.listReturns)
adminRouter.get('/returns/:id', requirePermission('order.read'), validate(platformIdParamSchema, 'params'), platform.getReturn)
adminRouter.get('/disputes/:id', requirePermission('order.read'), validate(platformIdParamSchema, 'params'), platform.getDispute)
adminRouter.get('/refunds', requirePermission('order.read'), validate(listRefundsSchema, 'query'), platform.listRefunds)
adminRouter.get('/refunds/:id', requirePermission('order.read'), validate(platformIdParamSchema, 'params'), platform.getRefund)
adminRouter.patch('/refunds/:id/settle', requirePermission('order.write'), validate(platformIdParamSchema, 'params'), validate(settleRefundSchema), platform.settleRefund)

// --- Shipping ----------------------------------------------------------------

adminRouter.get('/shipping', requirePermission('settings.manage'), shipping.overview)
adminRouter.post('/shipping/zones', requirePermission('settings.manage'), validate(createZoneSchema), shipping.createZone)
adminRouter.patch('/shipping/zones/:id', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), validate(updateZoneSchema), shipping.updateZone)
adminRouter.delete('/shipping/zones/:id', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), shipping.deleteZone)
adminRouter.post('/shipping/zones/:id/methods', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), validate(createMethodSchema), shipping.createMethod)
adminRouter.patch('/shipping/methods/:id', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), validate(updateMethodSchema), shipping.updateMethod)
adminRouter.delete('/shipping/methods/:id', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), shipping.deleteMethod)
adminRouter.post('/shipping/warehouses', requirePermission('settings.manage'), validate(createWarehouseSchema), shipping.createWarehouse)
adminRouter.patch('/shipping/warehouses/:id', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), validate(updateWarehouseSchema), shipping.updateWarehouse)
adminRouter.delete('/shipping/warehouses/:id', requirePermission('settings.manage'), validate(shippingIdParamSchema, 'params'), shipping.deleteWarehouse)

// --- Platform: maintenance mode and database exports -------------------------
//
// Backups are restricted to super_admin rather than to a permission: an export is a complete
// copy of every customer record in the marketplace, and that is not a right to hand out
// through a role editor.

adminRouter.get('/platform/status', requirePermission('settings.manage'), platform.systemStatus)
adminRouter.patch('/platform/maintenance', requirePermission('settings.manage'), validate(updateMaintenanceSchema), platform.updateMaintenance)
adminRouter.get('/platform/backups', requireRole('super_admin'), validate(listBackupsSchema, 'query'), platform.listBackups)
adminRouter.post('/platform/backups', requireRole('super_admin'), platform.createBackup)
adminRouter.get('/platform/backups/:id/file', requireRole('super_admin'), validate(platformIdParamSchema, 'params'), platform.downloadBackup)
adminRouter.delete('/platform/backups/:id', requireRole('super_admin'), validate(platformIdParamSchema, 'params'), platform.deleteBackup)

// --- Security ----------------------------------------------------------------
//
// The two-factor routes act on the caller's OWN account and deliberately take no user id:
// enrolling a second factor for somebody else is not a coherent operation, and an endpoint
// that accepted an id would be one authorisation slip away from an account takeover.

adminRouter.get('/security', requirePermission('user.read'), platform.securityOverview)
adminRouter.patch('/security/policy', requireRole('super_admin'), validate(updateSecurityPolicySchema), platform.updateSecurityPolicy)
adminRouter.get('/security/two-factor', platform.twoFactorStatus)
adminRouter.post('/security/two-factor/setup', platform.beginTwoFactor)
adminRouter.post('/security/two-factor/confirm', validate(twoFactorCodeSchema), platform.confirmTwoFactor)
adminRouter.post('/security/two-factor/disable', validate(passwordConfirmSchema), platform.disableTwoFactor)
adminRouter.post('/security/two-factor/backup-codes', validate(passwordConfirmSchema), platform.regenerateBackupCodes)
