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

/**
 * What reaches this person, and how.
 *
 * Declared before `/:id/read` so "preferences" is never matched as a notification id — the
 * same ordering hazard `read-all` is arranged around below.
 *
 * A resource of its own rather than two JSON blobs on the profile PATCH: the categories are
 * the server's to define, and it returns them so the browser has nothing to invent.
 */
notificationsRouter.get('/preferences', controller.getNotificationPreferences)
notificationsRouter.put('/preferences', validate(controller.preferencesSchema), controller.updateNotificationPreferences)
// Declared before /:id/read so "read-all" is never matched as a notification id.
notificationsRouter.patch('/read-all', controller.markAllRead)
notificationsRouter.patch('/:id/read', validate(notificationIdSchema, 'params'), controller.markRead)
