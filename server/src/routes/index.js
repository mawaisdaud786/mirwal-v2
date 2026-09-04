import { Router } from 'express'
import { authRouter } from '../modules/auth/auth.routes.js'
import { createScopedAuthRouter } from '../modules/auth/scopedAuth.routes.js'
import { catalogRouter } from '../modules/catalog/catalog.routes.js'
import { sellerRouter } from '../modules/sellers/seller.routes.js'
import { ordersRouter } from '../modules/orders/orders.routes.js'
import { adminRouter } from '../modules/admin/admin.routes.js'
import { addressesRouter } from '../modules/addresses/addresses.routes.js'
import { notificationsRouter } from '../modules/notifications/notifications.routes.js'
import { paymentsRouter } from '../modules/payments/payments.routes.js'
import { aiRouter } from '../modules/ai/ai.routes.js'
import { wishlistRouter } from '../modules/wishlist/wishlist.routes.js'
import { reviewsRouter } from '../modules/reviews/reviews.routes.js'
import { supportRouter } from '../modules/support/support.routes.js'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)

// Per-application authentication. Mounted ahead of the admin/seller routers so the login and
// refresh routes stay reachable without an existing session, while everything below them
// remains behind requireAuth + role/permission/ownership checks.
apiRouter.use('/admin/auth', createScopedAuthRouter('admin', ['admin', 'super_admin']))
apiRouter.use('/seller/auth', createScopedAuthRouter('seller', ['seller']))
apiRouter.use('/seller', sellerRouter)
apiRouter.use('/orders', ordersRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use('/addresses', addressesRouter)
apiRouter.use('/notifications', notificationsRouter)
apiRouter.use('/payments', paymentsRouter)
apiRouter.use('/ai', aiRouter)
apiRouter.use('/wishlist', wishlistRouter)
apiRouter.use('/reviews', reviewsRouter)
// Customer-facing support. The seller and admin views of the same threads live on their
// own routers, scoped differently.
apiRouter.use('/support', supportRouter)
apiRouter.use('/', catalogRouter)
