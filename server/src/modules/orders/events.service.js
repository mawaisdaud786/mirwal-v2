import { query } from '../../db/pool.js'

/**
 * The order timeline.
 *
 * `orders.status` and `order_items.status` hold only where something is now. "When did this
 * become shipped, and who moved it" is the first question asked in every delivery dispute and
 * every chargeback, and before this table it was unanswerable — `updated_at` is overwritten by
 * the next edit, and the audit log covers admin actions only, never the seller's or the
 * buyer's or a payment provider's.
 *
 * Two rules, both borrowed from patterns already used elsewhere in this codebase:
 *
 *   * `actorSide` is stored rather than derived from the actor's roles, exactly as
 *     `support_messages.author_side` is. Roles change; the history of who did what must not.
 *
 *   * Writing an event never throws. Like `recordAudit`, every caller is doing something more
 *     important than annotating it, and a timeline write must not be able to roll back the
 *     delivery it is describing. The one exception is when a caller passes its own
 *     transaction connection: there the write is part of the same atomic unit on purpose, so
 *     an order and its "placed" event cannot exist without each other.
 */

/**
 * Record one transition.
 *
 * @param {object|null} connection  a transaction connection, or null to use the pool
 * @param {object} event
 * @param {number} event.orderId
 * @param {number} [event.orderItemId]
 * @param {string} event.eventType     e.g. 'order.placed', 'item.shipped', 'payment.succeeded'
 * @param {string} [event.fromStatus]
 * @param {string} [event.toStatus]
 * @param {'buyer'|'seller'|'admin'|'system'|'provider'} [event.actorSide]
 * @param {number} [event.actorUserId]
 * @param {string} [event.note]
 * @param {object} [event.metadata]
 */
export async function recordOrderEvent(connection, {
  orderId, orderItemId = null, eventType, fromStatus = null, toStatus = null,
  actorSide = 'system', actorUserId = null, note = null, metadata = null,
}) {
  const params = [
    orderId, orderItemId, eventType, fromStatus, toStatus, actorSide, actorUserId,
    note ? String(note).slice(0, 500) : null,
    metadata ? JSON.stringify(metadata) : null,
  ]
  const sql = `INSERT INTO order_events
                 (order_id, order_item_id, event_type, from_status, to_status,
                  actor_side, actor_user_id, note, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

  if (connection) {
    // Inside a caller's transaction: deliberately allowed to throw, so the event and the
    // change it describes commit or fail together.
    await connection.execute(sql, params)
    return
  }

  try {
    await query(sql, params)
  } catch {
    // Outside a transaction the timeline is an annotation, and losing one is strictly better
    // than failing the operation it was describing.
  }
}

/**
 * The timeline for one order, newest first.
 *
 * `scope` decides how much is shown. A buyer sees what happened to their order; staff also
 * see who did it. Neither ever sees another party's internal note, because none is stored
 * here — internal working notes belong on the support ticket, which already models them.
 */
export async function listOrderEvents(orderId, { scope = 'buyer' } = {}) {
  const rows = await query(
    `SELECT e.event_type, e.from_status, e.to_status, e.actor_side, e.note,
            e.metadata, e.created_at,
            oi.product_name,
            u.full_name AS actor_name
       FROM order_events e
       LEFT JOIN order_items oi ON oi.id = e.order_item_id
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.order_id = ?
      ORDER BY e.created_at DESC, e.id DESC`,
    [orderId],
  )

  return rows.map((row) => ({
    type: row.event_type,
    from: row.from_status,
    to: row.to_status,
    side: row.actor_side,
    // A buyer is told that "the seller" shipped their parcel, not which staff member or
    // which person at the store. Naming individuals to the other party is a privacy leak
    // that no order page needs.
    actor: scope === 'staff' ? (row.actor_name ?? null) : null,
    productName: row.product_name ?? null,
    note: row.note,
    at: row.created_at,
  }))
}
