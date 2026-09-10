import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { createNotification } from '../notifications/notifications.service.js'
import * as messaging from '../messaging/messaging.service.js'
import { recordOrderEvent } from './events.service.js'
import { toSqlDateTime } from '../../lib/tokens.js'

/**
 * Parcels.
 *
 * "Shipped" was a status with nothing behind it: an order item could be moved to `shipped`
 * with no carrier, no tracking number and no dispatch time. The buyer's tracking page had
 * nothing to show, on-time-delivery could not be measured, and a "it never arrived" dispute —
 * the most common one on any Pakistani marketplace, because most orders are cash on delivery —
 * had no evidence on either side.
 *
 * A shipment is scoped to a seller rather than to an order, because a two-seller order is two
 * parcels sent by two people on two days. Pretending otherwise is what makes multi-vendor
 * tracking incoherent: the buyer is shown one status for goods that are in two different vans.
 *
 * Creating a shipment is also what moves its items to `shipped`. Those are one act, and
 * letting them happen separately produces the exact state this module exists to remove — an
 * item marked shipped with no parcel, or a parcel with items that still say "processing".
 */

function shapeShipment(row, items = []) {
  return {
    id: row.public_id,
    orderNumber: row.order_number,
    status: row.status,
    carrier: row.carrier_name
      ? { slug: row.carrier_slug, name: row.carrier_name, phone: row.carrier_phone }
      : null,
    trackingNumber: row.tracking_number || null,
    trackingUrl: row.tracking_url || null,
    estimatedDeliveryAt: row.estimated_delivery_at,
    dispatchedAt: row.dispatched_at,
    deliveredAt: row.delivered_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
    attemptCount: Number(row.attempt_count ?? 0),
    receivedBy: row.received_by,
    codAmount: formatMoney(row.cod_amount ?? 0, 'PKR'),
    codCollectedAt: row.cod_collected_at,
    notes: row.notes,
    items,
    createdAt: row.created_at,
  }
}

const SHIPMENT_SELECT = `
  SELECT s.*, o.order_number, o.public_id AS order_public_id, o.buyer_id,
         c.slug AS carrier_slug, c.name AS carrier_name, c.phone AS carrier_phone
    FROM shipments s
    JOIN orders o ON o.id = s.order_id
    LEFT JOIN carriers c ON c.id = s.carrier_id`

/** The carriers a seller can pick from. Seeded with the real Pakistani set in migration 021. */
export async function listCarriers() {
  const rows = await query(
    'SELECT slug, name, phone, supports_cod, tracking_url_template FROM carriers WHERE is_active = 1 ORDER BY position, name',
  )
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    phone: row.phone || null,
    supportsCod: Boolean(row.supports_cod),
    hasOnlineTracking: Boolean(row.tracking_url_template),
  }))
}

/**
 * Dispatch a parcel.
 *
 * Every item is re-checked as belonging to this seller and as being in a state that can ship,
 * inside the transaction. Without that a seller could attach another seller's line to their
 * own parcel and mark it shipped, which would tell the buyer something false about goods that
 * are not moving.
 */
export async function createShipment(sellerId, { orderItemIds, carrierSlug, trackingNumber, estimatedDeliveryAt, notes, weightGrams }) {
  if (!orderItemIds?.length) throw badRequest('Choose at least one item to ship.', 'NO_ITEMS')

  const carrier = carrierSlug
    ? await queryOne('SELECT id, name, tracking_url_template FROM carriers WHERE slug = ? AND is_active = 1', [carrierSlug])
    : null
  if (carrierSlug && !carrier) throw badRequest('That courier is not available.', 'CARRIER_NOT_FOUND')

  // A tracked carrier with no number is the case that makes a tracking page useless, so it is
  // refused rather than accepted and silently unhelpful. "Self / own rider" legitimately has
  // no number, which is why the rule is per-carrier rather than global.
  if (carrier?.tracking_url_template && !trackingNumber) {
    throw badRequest(
      `${carrier.name} provides tracking — enter the tracking number from the receipt.`,
      'TRACKING_NUMBER_REQUIRED',
    )
  }

  const publicId = randomUUID()

  const result = await withTransaction(async (connection) => {
    const [items] = await connection.execute(
      `SELECT oi.id, oi.seller_id, oi.status, oi.quantity, oi.line_total, oi.order_id,
              o.payment_method, o.payment_status, o.currency_code
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.id IN (${orderItemIds.map(() => '?').join(',')})
        FOR UPDATE`,
      orderItemIds,
    )

    if (items.length !== orderItemIds.length) throw notFound('One of those order items does not exist.')
    if (items.some((item) => item.seller_id !== sellerId)) {
      throw forbidden('One of those items does not belong to your store.')
    }
    // One parcel, one order. Items from two different orders cannot share a waybill.
    const orderIds = new Set(items.map((item) => String(item.order_id)))
    if (orderIds.size > 1) throw badRequest('A shipment can only cover one order.', 'MULTIPLE_ORDERS')

    const notReady = items.filter((item) => !['confirmed', 'processing', 'failed_delivery'].includes(item.status))
    if (notReady.length) {
      throw conflict(
        `An item that is "${notReady[0].status}" cannot be dispatched. Confirm the order first.`,
        'ITEM_NOT_DISPATCHABLE',
      )
    }

    const order = items[0]
    // What the courier collects at the door. Zero for anything already paid — asking a
    // courier to collect on a prepaid order is how a buyer ends up charged twice.
    const codAmount = order.payment_method === 'cod' && order.payment_status !== 'paid'
      ? items.reduce((sum, item) => sum + Number(item.line_total), 0)
      : 0

    const trackingUrl = carrier?.tracking_url_template && trackingNumber
      ? carrier.tracking_url_template.replace('{{tracking}}', encodeURIComponent(trackingNumber))
      : ''

    const [inserted] = await connection.execute(
      `INSERT INTO shipments
         (public_id, order_id, seller_id, carrier_id, tracking_number, tracking_url,
          status, estimated_delivery_at, dispatched_at, cod_amount, weight_grams, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'dispatched', ?, NOW(3), ?, ?, ?, NULL)`,
      [
        publicId, order.order_id, sellerId, carrier?.id ?? null,
        trackingNumber ?? '', trackingUrl,
        // MariaDB DATETIME will not accept an ISO instant with a trailing Z — it rejects the
        // whole INSERT rather than coercing. The schema validates an offset-bearing string
        // precisely so it can be converted here rather than trusted onwards.
        estimatedDeliveryAt ? toSqlDateTime(new Date(estimatedDeliveryAt)) : null,
        codAmount.toFixed(2), weightGrams ?? null, notes ?? null,
      ],
    )

    for (const item of items) {
      await connection.execute(
        'INSERT INTO shipment_items (shipment_id, order_item_id, quantity) VALUES (?, ?, ?)',
        [inserted.insertId, item.id, item.quantity],
      )
      // Dispatching IS marking shipped. See the module comment: separating them produces the
      // inconsistent state this table exists to eliminate.
      await connection.execute(
        `UPDATE order_items
            SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW(3)), updated_at = NOW(3)
          WHERE id = ?`,
        [item.id],
      )
      await recordOrderEvent(connection, {
        orderId: order.order_id,
        orderItemId: item.id,
        eventType: 'item.shipped',
        fromStatus: item.status,
        toStatus: 'shipped',
        actorSide: 'seller',
        note: trackingNumber ? `${carrier?.name ?? 'Courier'} · ${trackingNumber}` : (carrier?.name ?? null),
      })
    }

    return { orderId: order.order_id, itemCount: items.length }
  })

  await notifyBuyer(publicId, 'shipped')
  return { id: publicId, ...result }
}

/**
 * Move a parcel along.
 *
 * `delivered` and `failed` propagate to the order items, because a parcel arriving is exactly
 * what "delivered" means for the goods inside it — and a delivery that is recorded on the
 * parcel but not on the items would leave the seller unpaid and the buyer unable to return
 * anything.
 */
export async function updateShipmentStatus(scope, publicId, { status, failureReason, receivedBy, proofUrl }) {
  const shipment = await queryOne(`${SHIPMENT_SELECT} WHERE s.public_id = ?`, [publicId])
  if (!shipment) throw notFound('Shipment not found.')
  if (scope.sellerId != null && shipment.seller_id !== scope.sellerId) {
    throw notFound('Shipment not found.')
  }

  const FORWARD = {
    ready: ['dispatched', 'cancelled'],
    dispatched: ['in_transit', 'out_for_delivery', 'delivered', 'failed'],
    in_transit: ['out_for_delivery', 'delivered', 'failed'],
    out_for_delivery: ['delivered', 'failed'],
    // A failed attempt is not terminal: couriers retry, and the parcel only truly ends as
    // delivered or returned to the seller.
    failed: ['out_for_delivery', 'in_transit', 'delivered', 'returned'],
    delivered: [],
    returned: [],
    cancelled: [],
  }
  if (!FORWARD[shipment.status]?.includes(status)) {
    throw conflict(`A shipment that is "${shipment.status}" cannot become "${status}".`, 'INVALID_STATUS_TRANSITION')
  }
  if (status === 'failed' && !failureReason) {
    throw badRequest(
      'Say why delivery failed — it decides whether the buyer, the seller or nobody is at fault.',
      'REASON_REQUIRED',
    )
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE shipments
          SET status = ?,
              delivered_at = CASE WHEN ? = 'delivered' THEN NOW(3) ELSE delivered_at END,
              failed_at    = CASE WHEN ? = 'failed' THEN NOW(3) ELSE failed_at END,
              attempt_count = attempt_count + CASE WHEN ? = 'failed' THEN 1 ELSE 0 END,
              failure_reason = COALESCE(?, failure_reason),
              received_by = COALESCE(?, received_by),
              proof_url = COALESCE(?, proof_url),
              cod_collected_at = CASE WHEN ? = 'delivered' AND cod_amount > 0
                                      THEN NOW(3) ELSE cod_collected_at END,
              updated_at = NOW(3)
        WHERE id = ?`,
      [status, status, status, status, failureReason ?? null, receivedBy ?? null, proofUrl ?? null, status, shipment.id],
    )

    await recordOrderEvent(connection, {
      orderId: shipment.order_id,
      eventType: `shipment.${status}`,
      fromStatus: shipment.status,
      toStatus: status,
      actorSide: scope.sellerId ? 'seller' : 'admin',
      note: failureReason ?? null,
      metadata: { shipmentId: publicId, trackingNumber: shipment.tracking_number || null },
    })
  })

  // The goods follow the parcel. Routed through the ordinary fulfilment path rather than a
  // direct UPDATE so the ledger posting, the COD settlement and the order-level status
  // recomputation all still happen exactly once.
  if (status === 'delivered' || status === 'failed') {
    const items = await query(
      'SELECT order_item_id FROM shipment_items WHERE shipment_id = ?',
      [shipment.id],
    )
    const { updateOrderItemStatusForSeller } = await import('./orders.service.js')
    for (const item of items) {
      try {
        await updateOrderItemStatusForSeller(
          shipment.seller_id,
          item.order_item_id,
          status === 'delivered' ? 'delivered' : 'failed_delivery',
          { reason: failureReason },
        )
      } catch (error) {
        // An item already in that state is not a failure of this update — the parcel status
        // is still correct, and forcing the whole call to fail would leave the courier's
        // report unrecorded.
        if (error?.code !== 'INVALID_STATUS_TRANSITION') throw error
      }
    }
  }

  await notifyBuyer(publicId, status)
  return { id: publicId, status }
}

/**
 * Tell the buyer, on the channel that actually reaches people.
 *
 * In-app for everything, plus email where there is something to read and SMS for
 * out-for-delivery — which is the one message that has to arrive within the hour, and the one
 * a Pakistani shopper will actually see. Never throws: a courier update that fails because a
 * mail server is down is still a courier update worth keeping.
 */
async function notifyBuyer(publicId, status) {
  const copy = {
    shipped: { title: 'Your order is on its way', body: 'The seller has handed your parcel to the courier.' },
    out_for_delivery: { title: 'Out for delivery today', body: 'Your parcel is with the courier for delivery.' },
    delivered: { title: 'Delivered', body: 'Your parcel has been delivered.' },
    failed: { title: 'Delivery attempt failed', body: 'The courier could not deliver your parcel.' },
  }[status]
  if (!copy) return

  try {
    const shipment = await queryOne(
      `SELECT s.tracking_number, s.failure_reason, s.cod_amount,
              o.order_number, o.public_id AS order_public_id,
              u.id AS buyer_id, u.email AS buyer_email, u.phone AS buyer_phone, u.full_name AS buyer_name
         FROM shipments s
         JOIN orders o ON o.id = s.order_id
         JOIN users u ON u.id = o.buyer_id
        WHERE s.public_id = ?`,
      [publicId],
    )
    if (!shipment) return

    const body = status === 'failed' && shipment.failure_reason
      ? shipment.failure_reason
      : copy.body

    await createNotification(shipment.buyer_id, {
      type: `shipment_${status}`,
      title: copy.title,
      body: shipment.tracking_number ? `${body} Tracking: ${shipment.tracking_number}` : body,
      link: `/order-success/${shipment.order_public_id}`,
    })

    if (status === 'out_for_delivery' && shipment.buyer_phone) {
      messaging.sendInBackground('order.out_for_delivery', {
        to: shipment.buyer_phone,
        userId: shipment.buyer_id,
        channel: 'sms',
        variables: {
          orderNumber: shipment.order_number,
          amount: formatMoney(shipment.cod_amount ?? 0, 'PKR').display,
        },
      })
    }
    if (status === 'shipped' && shipment.buyer_email) {
      messaging.sendInBackground('order.shipped', {
        to: shipment.buyer_email,
        userId: shipment.buyer_id,
        variables: {
          customerName: shipment.buyer_name ?? '',
          orderNumber: shipment.order_number,
          productName: 'your order',
        },
      })
    }
    if (status === 'failed' && shipment.buyer_email) {
      messaging.sendInBackground('order.delivery_failed', {
        to: shipment.buyer_email,
        userId: shipment.buyer_id,
        variables: {
          customerName: shipment.buyer_name ?? '',
          orderNumber: shipment.order_number,
          reason: shipment.failure_reason ?? 'The courier could not complete the delivery.',
        },
      })
    }
  } catch (error) {
    console.error('[shipments] buyer notification failed', { publicId, status, error: error.message })
  }
}

/** A seller's parcels. */
export async function listForSeller(sellerId, { status, page = 1, pageSize = 25 } = {}) {
  const where = ['s.seller_id = ?']
  const params = [sellerId]
  if (status) { where.push('s.status = ?'); params.push(status) }
  const clause = `WHERE ${where.join(' AND ')}`

  const rows = await query(
    `${SHIPMENT_SELECT} ${clause} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM shipments s ${clause}`,
    params,
  )
  return { items: await withItems(rows), total: Number(total) }
}

/**
 * The buyer's tracking view.
 *
 * Deliberately excludes the seller's internal notes and the proof-of-delivery photograph:
 * a proof image can show a doorway, a face or a neighbour, and it exists to settle a dispute
 * rather than to be browsed.
 */
export async function listForOrder(buyerId, orderPublicId) {
  const order = await queryOne(
    'SELECT id, buyer_id FROM orders WHERE public_id = ?',
    [orderPublicId],
  )
  if (!order) throw notFound('Order not found.')
  if (order.buyer_id !== buyerId) throw notFound('Order not found.')

  const rows = await query(`${SHIPMENT_SELECT} WHERE s.order_id = ? ORDER BY s.created_at`, [order.id])
  const shaped = await withItems(rows)
  return shaped.map(({ notes: _notes, ...rest }) => rest)
}

async function withItems(rows) {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const items = await query(
    `SELECT si.shipment_id, si.quantity, oi.product_name, oi.sku
       FROM shipment_items si JOIN order_items oi ON oi.id = si.order_item_id
      WHERE si.shipment_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )
  const byShipment = new Map()
  for (const item of items) {
    const list = byShipment.get(String(item.shipment_id)) ?? []
    list.push({ productName: item.product_name, sku: item.sku, quantity: item.quantity })
    byShipment.set(String(item.shipment_id), list)
  }
  return rows.map((row) => shapeShipment(row, byShipment.get(String(row.id)) ?? []))
}
