import { randomUUID } from 'node:crypto'
import { pool, query, queryOne } from '../../db/pool.js'
import { forbidden, notFound } from '../../lib/errors.js'
import { mayNotify } from './preferences.service.js'

/**
 * In-app notifications. There is no email/SMS provider integrated, so this is deliberately
 * scoped to what Mirwal can actually deliver: a real, persistent record a signed-in user sees
 * on their next visit, generated only by real events elsewhere in the app (see the calls into
 * `createNotification` from orders.service.js) — never a fabricated count or a static list.
 *
 * `createNotification` accepts an optional transaction `connection` so it can be inserted
 * atomically alongside the event that caused it (e.g. a notification for a new order is
 * written inside the same transaction that creates the order) — either both commit or
 * neither does.
 *
 * Preferences are honoured here too, but only for whole categories a person has switched off.
 * The in-app list is the record of what happened rather than an interruption, so switching a
 * category off is mostly about not being emailed or texted; a category genuinely turned off
 * stops appearing at all, because otherwise the setting means nothing on this surface.
 */
export async function createNotification(userId, { type, title, body = '', link = null }, connection = null) {
  if (!(await mayNotify(userId, type, 'inApp'))) return
  const executor = connection ?? pool
  await executor.execute(
    'INSERT INTO notifications (public_id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), userId, type, title, body, link],
  )
}

function shapeNotification(row) {
  return {
    id: row.public_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  }
}

export async function listNotifications(userId) {
  const rows = await query(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [userId],
  )
  return rows.map(shapeNotification)
}

export async function markNotificationRead(userId, publicId) {
  const row = await queryOne('SELECT id, user_id FROM notifications WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Notification not found.', 'NOTIFICATION_NOT_FOUND')
  if (row.user_id !== userId) throw forbidden('This notification does not belong to you.')
  await query('UPDATE notifications SET read_at = NOW(3) WHERE id = ? AND read_at IS NULL', [row.id])
}

export async function markAllNotificationsRead(userId) {
  await query('UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL', [userId])
}
