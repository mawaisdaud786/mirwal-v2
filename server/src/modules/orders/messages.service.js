import { randomUUID } from 'node:crypto'
import { query, queryOne } from '../../db/pool.js'
import { forbidden, notFound } from '../../lib/errors.js'
import { createNotification } from '../notifications/notifications.service.js'

/**
 * Buyer and seller talking about an order.
 *
 * A buyer with a question about a live order had two options: open a support ticket with Mirwal,
 * or file a return. Neither reaches the person actually holding the parcel, which is why so much
 * of `support_tickets` is people asking Mirwal to relay a message to a seller.
 *
 * The shape that matters: **a thread per (order, seller)**, not per order. A basket split across
 * three stores is three conversations, and one seller reading another's thread would expose both
 * the buyer's other purchases and a competitor's service quality.
 *
 * Staff can read a thread and add internal notes, and this is deliberate rather than a
 * concession. When a case is opened over an order, what the two parties actually said to each
 * other is the evidence — a private channel would produce disputes with nothing to adjudicate
 * on. Both parties can see the thread is attached to their order; nothing here is secret from
 * them except an operator's internal note.
 */

const MAX_BODY = 4000

function shape(row, { includeInternal = false } = {}) {
  return {
    id: row.public_id,
    side: row.author_side,
    author: row.author_name ?? (row.author_side === 'admin' ? 'Mirwal' : null),
    body: row.body,
    ...(includeInternal ? { isInternal: Boolean(row.is_internal) } : {}),
    at: row.created_at,
  }
}

/** Resolve the thread, checking the caller belongs to it. */
async function resolveThread({ orderPublicId, sellerPublicId = null, buyerId = null, sellerId = null }) {
  const order = await queryOne('SELECT id, buyer_id, order_number FROM orders WHERE public_id = ?', [orderPublicId])
  if (!order) throw notFound('Order not found.')
  if (buyerId != null && order.buyer_id !== buyerId) throw forbidden('This order does not belong to you.')

  let seller
  if (sellerId != null) {
    seller = await queryOne('SELECT id, user_id, store_name FROM sellers WHERE id = ?', [sellerId])
  } else if (sellerPublicId) {
    seller = await queryOne('SELECT id, user_id, store_name FROM sellers WHERE public_id = ?', [sellerPublicId])
  }
  if (!seller) throw notFound('Store not found.')

  // The store must actually be on this order. Without this check any buyer could open a thread
  // with any seller by naming an order they happen to own.
  const line = await queryOne(
    'SELECT id FROM order_items WHERE order_id = ? AND seller_id = ? LIMIT 1',
    [order.id, seller.id],
  )
  if (!line) throw forbidden('That store has nothing on this order.')

  return { order, seller }
}

/** Which stores a buyer can talk to about this order, and whether anything is unread. */
export async function threadsForBuyer(buyerId, orderPublicId) {
  const order = await queryOne('SELECT id, buyer_id FROM orders WHERE public_id = ?', [orderPublicId])
  if (!order) throw notFound('Order not found.')
  if (order.buyer_id !== buyerId) throw forbidden('This order does not belong to you.')

  const rows = await query(
    `SELECT s.public_id, s.store_name, s.logo_url,
            (SELECT COUNT(*) FROM order_messages m
              WHERE m.order_id = ? AND m.seller_id = s.id AND m.is_internal = 0) AS message_count,
            (SELECT COUNT(*) FROM order_messages m
              WHERE m.order_id = ? AND m.seller_id = s.id AND m.is_internal = 0
                AND m.author_side <> 'buyer' AND m.read_by_buyer_at IS NULL) AS unread,
            (SELECT MAX(m.created_at) FROM order_messages m
              WHERE m.order_id = ? AND m.seller_id = s.id AND m.is_internal = 0) AS last_at
       FROM order_items oi JOIN sellers s ON s.id = oi.seller_id
      WHERE oi.order_id = ?
      GROUP BY s.id
      ORDER BY s.store_name`,
    [order.id, order.id, order.id, order.id],
  )

  return rows.map((row) => ({
    seller: { id: row.public_id, storeName: row.store_name, logoUrl: row.logo_url },
    messageCount: Number(row.message_count),
    unread: Number(row.unread),
    lastMessageAt: row.last_at,
  }))
}

/** One thread, from the buyer's side. Internal notes are never included. */
export async function readAsBuyer(buyerId, orderPublicId, sellerPublicId) {
  const { order, seller } = await resolveThread({ orderPublicId, sellerPublicId, buyerId })
  const rows = await query(
    `SELECT m.*, u.full_name AS author_name FROM order_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.order_id = ? AND m.seller_id = ? AND m.is_internal = 0
      ORDER BY m.created_at, m.id`,
    [order.id, seller.id],
  )
  await query(
    `UPDATE order_messages SET read_by_buyer_at = NOW(3)
      WHERE order_id = ? AND seller_id = ? AND author_side <> 'buyer' AND read_by_buyer_at IS NULL`,
    [order.id, seller.id],
  )
  return { storeName: seller.store_name, messages: rows.map((row) => shape(row)) }
}

export async function writeAsBuyer(buyerId, orderPublicId, sellerPublicId, { body }) {
  const { order, seller } = await resolveThread({ orderPublicId, sellerPublicId, buyerId })
  await query(
    `INSERT INTO order_messages (public_id, order_id, seller_id, author_side, author_user_id, body)
     VALUES (?, ?, ?, 'buyer', ?, ?)`,
    [randomUUID(), order.id, seller.id, buyerId, String(body).slice(0, MAX_BODY)],
  )
  await createNotification(seller.user_id, {
    type: 'order_message',
    title: `Question about order ${order.order_number}`,
    // The message itself is not put in the notification: it goes to whoever holds the seller
    // account, and the thread is where it belongs.
    body: 'The buyer sent you a message about their order.',
    link: '/seller-center/orders',
  })
  return { sent: true }
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

/** Threads on this seller's own orders, newest activity first. */
export async function threadsForSeller(sellerId, { unreadOnly = false } = {}) {
  const rows = await query(
    `SELECT o.public_id AS order_id, o.order_number, u.full_name AS buyer_name,
            COUNT(*) AS message_count,
            SUM(m.author_side = 'buyer' AND m.read_by_seller_at IS NULL) AS unread,
            MAX(m.created_at) AS last_at
       FROM order_messages m
       JOIN orders o ON o.id = m.order_id
       JOIN users u ON u.id = o.buyer_id
      WHERE m.seller_id = ? AND m.is_internal = 0
      GROUP BY o.id
      ${unreadOnly ? 'HAVING unread > 0' : ''}
      ORDER BY last_at DESC
      LIMIT 100`,
    [sellerId],
  )
  return rows.map((row) => ({
    order: { id: row.order_id, number: row.order_number },
    buyerName: row.buyer_name,
    messageCount: Number(row.message_count),
    unread: Number(row.unread ?? 0),
    lastMessageAt: row.last_at,
  }))
}

export async function readAsSeller(sellerId, orderPublicId) {
  const { order, seller } = await resolveThread({ orderPublicId, sellerId })
  const rows = await query(
    `SELECT m.*, u.full_name AS author_name FROM order_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.order_id = ? AND m.seller_id = ? AND m.is_internal = 0
      ORDER BY m.created_at, m.id`,
    [order.id, seller.id],
  )
  await query(
    `UPDATE order_messages SET read_by_seller_at = NOW(3)
      WHERE order_id = ? AND seller_id = ? AND author_side = 'buyer' AND read_by_seller_at IS NULL`,
    [order.id, seller.id],
  )
  return { orderNumber: order.order_number, messages: rows.map((row) => shape(row)) }
}

export async function writeAsSeller(sellerId, sellerUserId, orderPublicId, { body }) {
  const { order, seller } = await resolveThread({ orderPublicId, sellerId })
  await query(
    `INSERT INTO order_messages (public_id, order_id, seller_id, author_side, author_user_id, body)
     VALUES (?, ?, ?, 'seller', ?, ?)`,
    [randomUUID(), order.id, seller.id, sellerUserId, String(body).slice(0, MAX_BODY)],
  )
  const buyer = await queryOne('SELECT buyer_id FROM orders WHERE id = ?', [order.id])
  await createNotification(buyer.buyer_id, {
    type: 'order_message',
    title: `${seller.store_name} replied about order ${order.order_number}`,
    body: 'You have a new message about your order.',
    link: '/account/orders',
  })
  return { sent: true }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/**
 * The thread as staff see it, internal notes included.
 *
 * Read-only for support unless they add a note: an operator writing into the thread as Mirwal
 * is visible to both parties and is recorded as `admin`, never impersonating either of them.
 */
export async function readAsAdmin(orderPublicId, sellerPublicId) {
  const { order, seller } = await resolveThread({ orderPublicId, sellerPublicId })
  const rows = await query(
    `SELECT m.*, u.full_name AS author_name FROM order_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.order_id = ? AND m.seller_id = ?
      ORDER BY m.created_at, m.id`,
    [order.id, seller.id],
  )
  return {
    orderNumber: order.order_number,
    storeName: seller.store_name,
    messages: rows.map((row) => shape(row, { includeInternal: true })),
  }
}

export async function writeAsAdmin(adminUserId, orderPublicId, sellerPublicId, { body, isInternal = false }) {
  const { order, seller } = await resolveThread({ orderPublicId, sellerPublicId })
  await query(
    `INSERT INTO order_messages (public_id, order_id, seller_id, author_side, author_user_id, body, is_internal)
     VALUES (?, ?, ?, 'admin', ?, ?, ?)`,
    [randomUUID(), order.id, seller.id, adminUserId, String(body).slice(0, MAX_BODY), isInternal ? 1 : 0],
  )
  // An internal note reaches nobody: telling the parties Mirwal wrote something they cannot
  // read is worse than saying nothing.
  if (!isInternal) {
    const buyer = await queryOne('SELECT buyer_id FROM orders WHERE id = ?', [order.id])
    await createNotification(buyer.buyer_id, {
      type: 'order_message',
      title: `Mirwal replied about order ${order.order_number}`,
      body: 'Mirwal added a message to your order conversation.',
      link: '/account/orders',
    })
    await createNotification(seller.user_id, {
      type: 'order_message',
      title: `Mirwal replied about order ${order.order_number}`,
      body: 'Mirwal added a message to an order conversation.',
      link: '/seller-center/orders',
    })
  }
  return { sent: true }
}

/** How many of this seller's threads are waiting on them. Feeds the seller panel's badge. */
export async function unreadCountForSeller(sellerId) {
  const [{ unread }] = await query(
    `SELECT COUNT(*) AS unread FROM order_messages
      WHERE seller_id = ? AND author_side = 'buyer' AND is_internal = 0 AND read_by_seller_at IS NULL`,
    [sellerId],
  )
  return { unread: Number(unread) }
}
