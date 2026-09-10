import { z } from 'zod'
import { ok } from '../../lib/errors.js'
import * as service from './notifications.service.js'
import * as preferences from './preferences.service.js'

export async function list(req, res, next) {
  try { return ok(res, await service.listNotifications(req.user.id)) }
  catch (error) { return next(error) }
}

export async function markRead(req, res, next) {
  try { await service.markNotificationRead(req.user.id, req.params.id); return ok(res, null, 'Notification marked read.') }
  catch (error) { return next(error) }
}

export async function markAllRead(req, res, next) {
  try { await service.markAllNotificationsRead(req.user.id); return ok(res, null, 'All notifications marked read.') }
  catch (error) { return next(error) }
}

/**
 * Notification preferences.
 *
 * A separate resource from the profile PATCH the settings panel used to write through. That
 * endpoint took two opaque JSON blobs and the browser invented their shape, which is how the
 * old panel ended up toggling five keys taken from an icon lookup table. The categories are
 * the server's now, and it returns them so nothing has to guess.
 */
export async function getNotificationPreferences(req, res, next) {
  try { return ok(res, await preferences.getPreferences(req.user.id)) }
  catch (error) { return next(error) }
}

export const preferencesSchema = z.object({
  categories: z.record(z.boolean()).optional().default({}),
  channels: z.record(z.boolean()).optional().default({}),
})

export async function updateNotificationPreferences(req, res, next) {
  try {
    const result = await preferences.setPreferences(req.user.id, req.body)
    return ok(res, result, 'Saved.')
  } catch (error) { return next(error) }
}
