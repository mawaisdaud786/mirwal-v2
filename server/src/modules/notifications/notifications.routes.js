import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { notificationIdSchema } from './notifications.schemas.js'
import * as controller from './notifications.controller.js'

// A user's own notifications. Every handler reads req.user.id from the verified access
// token; no route accepts a user id as a parameter.
export const notificationsRouter = Router()

notificationsRouter.use(requireAuth)

notificationsRouter.get('/', controller.list)
// Declared before /:id/read so "read-all" is never matched as a notification id.
notificationsRouter.patch('/read-all', controller.markAllRead)
notificationsRouter.patch('/:id/read', validate(notificationIdSchema, 'params'), controller.markRead)
