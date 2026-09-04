import { ok } from '../../lib/errors.js'
import * as service from './notifications.service.js'

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
