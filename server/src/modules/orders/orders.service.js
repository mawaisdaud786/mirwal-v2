import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { toSqlDateTime } from '../../lib/tokens.js'
import { createNotification } from '../notifications/notifications.service.js'
import { assertMethodAvailable } from '../payments/payments.service.js'
import { createRefundForReturn, processRefund } from '../payments/refunds.service.js'
import { getNumericSetting } from '../settings/settings.service.js'
import { recordOrderEvent } from './events.service.js'
import { allocateToLines, computeTax, resolveCoupon, resolveShipping, round2 } from './pricing.service.js'

/**
 * Checkout and order fulfillment.
 *
 * The one rule everything here enforces: nothing the client sends about price or stock is
 * trusted. `createOrder` re-reads every product/variant from the database inside a
 * transaction, locks the inventory row it is about to decrement (`FOR UPDATE`), and derives
 * the order's totals from what it just read — never from a client-supplied unit price or
 * line total. A tampered checkout request can only ever buy real products at their real
 * price, or fail.
 */

const STATUS_NOTIFICATION_COPY = {
  confirmed: 'the seller has confirmed your order.',
  processing: 'your order is being prepared.',
  shipped: 'your order is on its way.',
  delivered: 'your order has been delivered.',
  cancelled: 'this item was cancelled.',
}

function shapeOrderItem(row) {
  return {
    id: row.id,
    product: { id: row.product_public_id, slug: row.product_slug, name: row.product_name },
    variantName: row.variant_name || null,
    sku: row.sku,
    unitPrice: formatMoney(row.unit_price, row.currency_code),
    quantity: row.quantity,
    lineTotal: formatMoney(row.line_total, row.currency_code),
    status: row.status,
    seller: row.seller_slug ? { slug: row.seller_slug, name: row.seller_store_name } : null,
    image: row.image_url ?? null,
    // The seller fulfilling this item needs to know where it's going — same information a
    // courier waybill would carry, not a customer-identity leak.
    shipTo: row.shipping_full_name ? {
      name: row.shipping_full_name,
      phone: row.shipping_phone,
      city: row.shipping_city,
    } : null,
    // Cancellation is the buyer's own right before anything ships; a return needs the
    // seller's review and is only possible after delivery — see migration 005.
    canCancel: ['pending', 'confirmed', 'processing'].includes(row.status),
    canRequestReturn: row.status === 'delivered' && !row.return_id,
    returnRequest: row.return_id ? {
      id: row.return_public_id,
      reason: row.return_reason,
      description: row.return_description,
      status: row.return_status,
      resolutionNote: row.return_resolution_note,
      createdAt: row.return_created_at,
    } : null,
  }
}

function shapeOrder(row, items) {
  return {
    id: row.public_id,
    orderNumber: row.order_number,
    status: row.status,
    subtotal: formatMoney(row.subtotal, row.currency_code),
    // The full breakdown, so a buyer can see how the total was reached rather than being
    // asked to trust it. Every one of these is a stored column, not a figure recomputed on
    // read — a past order must keep the arithmetic it was actually charged with.
    discount: formatMoney(row.discount_total ?? 0, row.currency_code),
    couponCode: row.coupon_code ?? null,
    shippingFee: formatMoney(row.shipping_fee, row.currency_code),
    shippingMethod: row.shipping_method_name || null,
    tax: formatMoney(row.tax_total ?? 0, row.currency_code),
    total: formatMoney(row.total, row.currency_code),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    shippingAddress: {
      fullName: row.shipping_full_name,
      phone: row.shipping_phone,
      line1: row.shipping_line1,
      line2: row.shipping_line2,
      city: row.shipping_city,
      region: row.shipping_region,
      postalCode: row.shipping_postal_code,
      countryCode: row.shipping_country_code,
    },
    notes: row.notes,
    items,
    createdAt: row.created_at,
  }
}

const ORDER_ITEM_SELECT = `
  SELECT oi.id, oi.product_id, oi.product_name, oi.variant_name, oi.sku,
         oi.unit_price, oi.quantity, oi.line_total, oi.status, oi.created_at,
         p.public_id AS product_public_id, p.slug AS product_slug,
         s.slug AS seller_slug, s.store_name AS seller_store_name,
         o.currency_code, o.order_number, o.shipping_full_name, o.shipping_phone, o.shipping_city,
         (SELECT url FROM product_images WHERE product_id = oi.product_id ORDER BY position, id LIMIT 1) AS image_url,
         r.id AS return_id, r.public_id AS return_public_id, r.reason AS return_reason,
         r.description AS return_description, r.status AS return_status,
         r.resolution_note AS return_resolution_note, r.created_at AS return_created_at
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    JOIN sellers s ON s.id = oi.seller_id
    LEFT JOIN return_requests r ON r.order_item_id = oi.id
`

async function loadItemsForOrder(orderId) {
  const rows = await query(`${ORDER_ITEM_SELECT} WHERE oi.order_id = ? ORDER BY oi.id`, [orderId])
  return rows.map(shapeOrderItem)
}

/**
 * Create an order from a cart.
 *
 * Every requested line is locked and re-priced from `products`/`product_variants`/
 * `inventory` before anything is written. If any line is out of stock or no longer active,
 * the whole checkout fails and nothing is decremented — a multi-seller cart is one atomic
 * commitment, not a partial one.
 */
export async function createOrder(buyerId, {
  items, shippingAddress, notes, paymentMethod = 'cod', couponCode = null, shippingMethodId = null,
}) {
  // Rejects a method whose gateway credentials aren't actually configured, so a client can
  // never select its way into a payment path that doesn't exist. Runs before the transaction
  // — there is no point locking inventory for an order that can't be paid for.
  assertMethodAvailable(paymentMethod)

  return withTransaction(async (connection) => {
    const lines = []

    for (const requested of items) {
      const [rows] = await connection.execute(
        `SELECT p.id AS product_id, p.status AS product_status, p.deleted_at, p.name,
                p.price AS product_price, p.currency_code, p.seller_id,
                s.status AS seller_status, s.deleted_at AS seller_deleted_at,
                s.vacation_mode, s.store_name,
                v.id AS variant_id, v.sku, v.name AS variant_name, v.price AS variant_price,
                v.is_active AS variant_active,
                COALESCE(i.quantity, 0) AS quantity, COALESCE(i.reserved, 0) AS reserved
           FROM products p
           JOIN sellers s ON s.id = p.seller_id
           JOIN product_variants v
             ON v.product_id = p.id
            AND (${requested.sku ? 'v.sku = ?' : 'v.is_default = 1'})
           LEFT JOIN inventory i ON i.variant_id = v.id
          WHERE p.public_id = ?
          FOR UPDATE`,
        requested.sku ? [requested.sku, requested.productId] : [requested.productId],
      )
      const row = rows[0]
      if (!row || row.product_status !== 'active' || row.deleted_at || !row.variant_active) {
        throw notFound(`One of the items in your cart is no longer available.`, 'ORDER_ITEM_UNAVAILABLE')
      }

      // The seller has to be allowed to trade at the moment of purchase, not merely at the
      // moment the listing was approved. The storefront already hides a suspended store's
      // products, but a cart can be minutes or days old, and a checkout that succeeds against
      // a suspended store creates an order nobody is allowed to fulfil.
      if (row.seller_status !== 'approved' || row.seller_deleted_at) {
        throw conflict(
          `"${row.name}" is no longer being sold on Mirwal.`,
          'SELLER_NOT_TRADING',
        )
      }
      // Vacation mode is the seller saying "I cannot fulfil right now". Honouring it is what
      // makes it safe for them to use it instead of silently cancelling orders later.
      if (row.vacation_mode) {
        throw conflict(
          `${row.store_name} is not accepting orders at the moment.`,
          'SELLER_ON_VACATION',
        )
      }

      const sellable = Number(row.quantity) - Number(row.reserved)
      if (sellable < requested.quantity) {
        throw conflict(
          sellable > 0
            ? `Only ${sellable} of "${row.name}" left in stock — reduce the quantity and try again.`
            : `"${row.name}" just sold out.`,
          'INSUFFICIENT_STOCK',
        )
      }

      const unitPrice = Number(row.variant_price ?? row.product_price)
      const lineTotal = Math.round(unitPrice * requested.quantity * 100) / 100

      await connection.execute(
        'UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ?',
        [requested.quantity, row.variant_id],
      )

      lines.push({
        // Stable within this checkout, so a discount can be attributed to a specific line
        // even when the same product appears twice with different SKUs.
        key: `${row.product_id}:${row.variant_id}`,
        sellerId: row.seller_id,
        productId: row.product_id,
        variantId: row.variant_id,
        productName: row.name,
        variantName: row.variant_name === 'Default' ? '' : row.variant_name,
        sku: row.sku,
        unitPrice,
        quantity: requested.quantity,
        lineTotal,
        currency: row.currency_code,
      })
    }

    const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0))

    // Everything below is derived server-side. The client chose a shipping option and typed a
    // coupon code; it supplied no amounts, and none of these figures can be influenced by it
    // beyond those two choices.
    const coupon = await resolveCoupon(connection, {
      code: couponCode, buyerId, lines, subtotal,
    })
    const discountTotal = coupon?.discount ?? 0

    const shipping = await resolveShipping(connection, {
      city: shippingAddress.city,
      countryCode: shippingAddress.countryCode,
      // Quoted against what the shopper actually pays for goods, so a free-delivery threshold
      // is not reached by a discount the shopper did not pay.
      subtotal: round2(subtotal - discountTotal),
      methodPublicId: shippingMethodId,
    })
    // A free-shipping coupon zeroes the carriage rather than the goods.
    const shippingFee = coupon?.freeShipping ? 0 : shipping.amount

    // Tax applies to the discounted goods plus carriage, which is the ordinary treatment.
    const tax = await computeTax(round2(subtotal - discountTotal + shippingFee))

    // When prices already include tax, the tax is a breakdown of the total rather than an
    // addition to it - adding it again would charge every shopper twice.
    const total = round2(subtotal - discountTotal + shippingFee + (tax.inclusive ? 0 : tax.amount))
    const currency = lines[0]?.currency ?? 'PKR'
    const publicId = randomUUID()

    const priced = allocateToLines(lines, { discount: discountTotal, coupon, tax })

    // How long this seller has to hand the parcel to a courier. Captured per order rather than
    // read live, so tightening the platform SLA later cannot retroactively make past orders
    // late.
    const dispatchHours = await getNumericSetting('orders.dispatch_sla_hours', { fallback: 48, max: 8760 })

    const [result] = await connection.execute(
      `INSERT INTO orders (public_id, order_number, buyer_id, currency_code, subtotal,
                            discount_total, coupon_id, coupon_code, shipping_fee, tax_total,
                            shipping_method_id, shipping_method_name, total,
                            payment_method,
                            shipping_full_name, shipping_phone, shipping_line1, shipping_line2,
                            shipping_city, shipping_region, shipping_postal_code, notes)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [publicId, buyerId, currency, subtotal,
        discountTotal, coupon?.id ?? null, coupon?.code ?? null, shippingFee, tax.amount,
        shipping.methodId, shipping.name, total,
        paymentMethod,
        shippingAddress.fullName, shippingAddress.phone, shippingAddress.line1, shippingAddress.line2 ?? '',
        shippingAddress.city, shippingAddress.region ?? '', shippingAddress.postalCode ?? '', notes ?? ''],
    )
    const orderId = result.insertId
    const orderNumber = `MW-${String(orderId).padStart(6, '0')}`
    await connection.execute('UPDATE orders SET order_number = ? WHERE id = ?', [orderNumber, orderId])

    for (const line of priced) {
      await connection.execute(
        `INSERT INTO order_items (order_id, seller_id, product_id, variant_id, product_name,
                                   variant_name, sku, unit_price, quantity, line_total,
                                   discount_amount, tax_amount, discount_funded_by,
                                   dispatch_due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? HOUR))`,
        [orderId, line.sellerId, line.productId, line.variantId, line.productName,
          line.variantName, line.sku, line.unitPrice, line.quantity, line.lineTotal,
          line.discountAmount, line.taxAmount, line.discountFundedBy, dispatchHours],
      )
    }

    // Record the redemption only now that the order exists. `uq_redemption_order` makes a
    // retried checkout unable to count one coupon twice, and counting from this ledger rather
    // than from `usage_count` is what makes the usage limit enforceable.
    if (coupon) {
      await connection.execute(
        `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_amount)
         VALUES (?, ?, ?, ?)`,
        [coupon.id, buyerId, orderId, discountTotal],
      )
      // The denormalised counter stays a cache of the ledger, never the other way round.
      await connection.execute(
        'UPDATE coupons SET usage_count = (SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = ?) WHERE id = ?',
        [coupon.id, coupon.id],
      )
    }

    await recordOrderEvent(connection, {
      orderId,
      eventType: 'order.placed',
      toStatus: 'pending',
      actorSide: 'buyer',
      actorUserId: buyerId,
      metadata: {
        subtotal, discountTotal, shippingFee, taxTotal: tax.amount, total,
        coupon: coupon?.code ?? null,
      },
    })

    const [orderRow] = await connection.execute('SELECT * FROM orders WHERE id = ?', [orderId])
    const items2 = await connection.execute(`${ORDER_ITEM_SELECT} WHERE oi.order_id = ? ORDER BY oi.id`, [orderId])
    const order = shapeOrder(orderRow[0], items2[0].map(shapeOrderItem))

    await createNotification(buyerId, {
      type: 'order_placed',
      title: `Order ${orderNumber} placed`,
      body: `${priced.length} item${priced.length > 1 ? 's' : ''} · ${order.total.display}`
        + (paymentMethod === 'cod' ? ', paid on delivery.' : '. Complete payment to confirm it.'),
      link: `/order-success/${publicId}`,
    }, connection)

    // One notification per distinct seller in this order, not per line item — a seller with
    // two items in the same checkout should hear about it once, not twice.
    const sellerIds = [...new Set(priced.map((line) => line.sellerId))]
    const [sellerUsers] = await connection.execute(
      `SELECT id, user_id FROM sellers WHERE id IN (${sellerIds.map(() => '?').join(',')})`,
      sellerIds,
    )
    for (const sellerUser of sellerUsers) {
      await createNotification(sellerUser.user_id, {
        type: 'new_order',
        title: `New order ${orderNumber}`,
        body: 'A shopper just placed an order for one of your products.',
        link: '/seller-center/orders',
      }, connection)
    }

    return order
  })
}

export async function listOrdersForBuyer(buyerId) {
  const rows = await query('SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC', [buyerId])
  const orders = []
  for (const row of rows) {
    orders.push(shapeOrder(row, await loadItemsForOrder(row.id)))
  }
  return orders
}

export async function getOrderForBuyer(buyerId, publicId) {
  const row = await queryOne('SELECT * FROM orders WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Order not found.', 'ORDER_NOT_FOUND')
  if (row.buyer_id !== buyerId) throw forbidden('This order does not belong to you.')
  return shapeOrder(row, await loadItemsForOrder(row.id))
}

/**
 * Every order sitewide, for the admin order list — unlike a buyer or seller view, this is
 * not scoped to anyone's ownership, because admin is the one role that legitimately sees
 * across the whole marketplace.
 *
 * `orders.status` itself is never updated after checkout — only `order_items.status` is,
 * since a multi-seller order is fulfilled per seller. Showing the raw column here would
 * read "Pending" forever regardless of what actually happened, so the displayed status is
 * the same items-rollup `ProfileOrdersPage.jsx` computes for the buyer's own view, computed
 * here in SQL so the list doesn't need a second query per order.
 */
export async function listOrdersForAdmin() {
  const rows = await query(
    `SELECT o.*, u.full_name AS buyer_name, u.email AS buyer_email,
            COUNT(oi.id) AS item_count,
            SUM(oi.status = 'delivered') AS delivered_count,
            SUM(oi.status = 'cancelled') AS cancelled_count,
            SUM(oi.status = 'shipped') AS shipped_count
       FROM orders o
       JOIN users u ON u.id = o.buyer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC`,
  )
  return rows.map((row) => {
    const itemCount = Number(row.item_count)
    const status = itemCount > 0 && Number(row.delivered_count) === itemCount ? 'delivered'
      : itemCount > 0 && Number(row.cancelled_count) === itemCount ? 'cancelled'
      : Number(row.shipped_count) > 0 ? 'shipped'
      : 'processing'
    return {
      id: row.public_id,
      orderNumber: row.order_number,
      buyer: { name: row.buyer_name, email: row.buyer_email },
      itemCount,
      total: formatMoney(row.total, row.currency_code),
      status,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      createdAt: row.created_at,
    }
  })
}

export async function getOrderForAdmin(publicId) {
  const row = await queryOne(
    `SELECT o.*, u.full_name AS buyer_name, u.email AS buyer_email
       FROM orders o JOIN users u ON u.id = o.buyer_id
      WHERE o.public_id = ?`,
    [publicId],
  )
  if (!row) throw notFound('Order not found.', 'ORDER_NOT_FOUND')
  return { ...shapeOrder(row, await loadItemsForOrder(row.id)), buyer: { name: row.buyer_name, email: row.buyer_email } }
}

/** A seller's own fulfillment queue — every order_item that belongs to their store. */
export async function listOrderItemsForSeller(sellerId) {
  const rows = await query(
    `${ORDER_ITEM_SELECT}
     WHERE oi.seller_id = ?
     ORDER BY oi.created_at DESC`,
    [sellerId],
  )
  return rows.map((row) => ({
    ...shapeOrderItem(row),
    orderNumber: row.order_number,
    placedAt: row.created_at,
  }))
}

/**
 * Update the status of one order item — a seller may only ever move their own items, and
 * only forward through the fulfillment lifecycle (or to cancelled).
 */
export async function updateOrderItemStatusForSeller(sellerId, orderItemId, status) {
  const item = await queryOne(
    'SELECT id, seller_id, status FROM order_items WHERE id = ?',
    [orderItemId],
  )
  if (!item) throw notFound('Order item not found.', 'ORDER_ITEM_NOT_FOUND')
  if (item.seller_id !== sellerId) throw forbidden('This order item does not belong to your store.')

  const FORWARD = { pending: ['confirmed', 'cancelled'], confirmed: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] }
  if (!FORWARD[item.status]?.includes(status)) {
    throw conflict(`Cannot move an order item from "${item.status}" to "${status}".`, 'INVALID_STATUS_TRANSITION')
  }

  await query('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?', [status, toSqlDateTime(), orderItemId])
  const updated = await queryOne(`${ORDER_ITEM_SELECT} WHERE oi.id = ?`, [orderItemId])

  const order = await queryOne(
    'SELECT o.id, o.buyer_id, o.public_id, o.order_number, o.payment_method, o.payment_status FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?',
    [orderItemId],
  )

  // Cash on Delivery is settled by the courier at the door, so delivery IS the payment event
  // — nothing else would ever mark a COD order paid. Applied once every item that is still
  // live has been delivered, so a partly-delivered multi-seller order isn't called paid
  // early. Without this, COD orders stayed 'pending' forever, which also meant an approved
  // return on one owed the buyer nothing.
  if (status === 'delivered' && order.payment_method === 'cod' && order.payment_status !== 'paid') {
    const outstanding = await queryOne(
      `SELECT COUNT(*) AS count FROM order_items
        WHERE order_id = ? AND status NOT IN ('delivered', 'cancelled', 'returned')`,
      [order.id],
    )
    if (Number(outstanding.count) === 0) {
      await query("UPDATE orders SET payment_status = 'paid', paid_at = NOW(3) WHERE id = ?", [order.id])
    }
  }
  await createNotification(order.buyer_id, {
    type: 'order_status_changed',
    title: `Order ${order.order_number} is now ${status}`,
    body: `${updated.product_name} — ${STATUS_NOTIFICATION_COPY[status] ?? `status updated to ${status}`}`,
    link: `/order-success/${order.public_id}`,
  })

  return shapeOrderItem(updated)
}

async function findOwnedOrderItem(buyerId, orderItemId) {
  const item = await queryOne(
    `SELECT oi.*, o.buyer_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?`,
    [orderItemId],
  )
  if (!item) throw notFound('Order item not found.', 'ORDER_ITEM_NOT_FOUND')
  if (item.buyer_id !== buyerId) throw forbidden('This order item does not belong to you.')
  return item
}

/**
 * A buyer cancelling their own item before it ships — no seller review needed, unlike a
 * return. Restocks the inventory that checkout reserved, symmetric with how `createOrder`
 * decremented it.
 */
export async function cancelOrderItemForBuyer(buyerId, orderItemId) {
  const item = await findOwnedOrderItem(buyerId, orderItemId)
  if (!['pending', 'confirmed', 'processing'].includes(item.status)) {
    throw conflict(`This item is already ${item.status} and can no longer be cancelled.`, 'CANNOT_CANCEL')
  }
  await withTransaction(async (connection) => {
    await connection.execute('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?', ['cancelled', toSqlDateTime(), orderItemId])
    await connection.execute('UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ?', [item.quantity, item.variant_id])
  })
  const cancelled = await queryOne(`${ORDER_ITEM_SELECT} WHERE oi.id = ?`, [orderItemId])

  const seller = await queryOne('SELECT user_id FROM sellers WHERE id = ?', [item.seller_id])
  await createNotification(seller.user_id, {
    type: 'item_cancelled',
    title: `Order ${cancelled.order_number} — item cancelled`,
    body: `The buyer cancelled ${cancelled.product_name} before it shipped.`,
    link: '/seller-center/orders',
  })

  return shapeOrderItem(cancelled)
}

/** File a return request on a delivered item. Only one request is ever allowed per item —
 * see the unique index in migration 005. */
export async function createReturnRequestForBuyer(buyerId, orderItemId, { reason, description }) {
  const item = await findOwnedOrderItem(buyerId, orderItemId)
  if (item.status !== 'delivered') {
    throw conflict('Only a delivered item can be returned.', 'ITEM_NOT_DELIVERED')
  }
  const existing = await queryOne('SELECT id FROM return_requests WHERE order_item_id = ?', [orderItemId])
  if (existing) throw conflict('A return request already exists for this item.', 'RETURN_ALREADY_REQUESTED')

  const publicId = randomUUID()
  await query(
    `INSERT INTO return_requests (public_id, order_item_id, buyer_id, seller_id, reason, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [publicId, orderItemId, buyerId, item.seller_id, reason, description ?? ''],
  )
  const updated = await queryOne(`${ORDER_ITEM_SELECT} WHERE oi.id = ?`, [orderItemId])

  const seller = await queryOne('SELECT user_id FROM sellers WHERE id = ?', [item.seller_id])
  await createNotification(seller.user_id, {
    type: 'return_requested',
    title: `Return requested — order ${updated.order_number}`,
    body: `${updated.product_name}: "${reason}"`,
    link: '/seller-center/orders/returns',
  })

  return shapeOrderItem(updated)
}

function shapeReturnRequest(row) {
  return {
    id: row.public_id,
    reason: row.reason,
    description: row.description,
    status: row.status,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    orderNumber: row.order_number,
    product: { id: row.product_public_id, name: row.product_name },
    quantity: row.quantity,
    lineTotal: formatMoney(row.line_total, row.currency_code),
    buyer: { name: row.buyer_name },
  }
}

/** A seller's own return-request review queue. */
export async function listReturnRequestsForSeller(sellerId) {
  const rows = await query(
    `SELECT r.*, oi.product_id, oi.quantity, oi.line_total, oi.variant_id,
            o.order_number, o.currency_code,
            p.public_id AS product_public_id, p.name AS product_name,
            u.full_name AS buyer_name
       FROM return_requests r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN users u ON u.id = r.buyer_id
      WHERE r.seller_id = ?
      ORDER BY r.created_at DESC`,
    [sellerId],
  )
  return rows.map(shapeReturnRequest)
}

/**
 * Approve or reject a return request — only the seller it belongs to may resolve it, and
 * only once (a resolved request cannot be re-resolved). Approval restocks the returned
 * quantity and marks the order item 'returned'; rejection leaves the item exactly as it was.
 */
export async function resolveReturnRequestForSeller(sellerId, returnRequestId, { status, resolutionNote }) {
  const request = await queryOne(
    `SELECT r.*, oi.variant_id, oi.quantity, oi.line_total, oi.order_id
       FROM return_requests r
       JOIN order_items oi ON oi.id = r.order_item_id
      WHERE r.public_id = ?`,
    [returnRequestId],
  )
  if (!request) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (request.seller_id !== sellerId) throw forbidden('This return request does not belong to your store.')
  if (request.status !== 'requested') throw conflict('This return request has already been resolved.', 'RETURN_ALREADY_RESOLVED')

  let refundId = null
  await withTransaction(async (connection) => {
    await connection.execute(
      'UPDATE return_requests SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ?',
      [status, resolutionNote ?? '', toSqlDateTime(), request.id],
    )
    if (status === 'approved') {
      await connection.execute('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?', ['returned', toSqlDateTime(), request.order_item_id])
      await connection.execute('UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ?', [request.quantity, request.variant_id])
      // Recorded inside the transaction so an approved return can never end up with no
      // refund owed; the gateway call itself happens after commit, below.
      refundId = await createRefundForReturn(connection, {
        returnRequestId: request.id,
        orderId: request.order_id,
        amount: request.line_total,
      })
    }
  })

  // Deliberately outside the transaction: an external API call must not hold a database
  // transaction open, and a gateway failure here leaves a retryable 'pending' refund rather
  // than rolling back the return approval itself.
  if (refundId) await processRefund(refundId)

  const resolved = shapeReturnRequest(await queryOne(
    `SELECT r.*, oi.product_id, oi.quantity, oi.line_total, oi.variant_id,
            o.order_number, o.currency_code,
            p.public_id AS product_public_id, p.name AS product_name,
            u.full_name AS buyer_name
       FROM return_requests r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN users u ON u.id = r.buyer_id
      WHERE r.id = ?`,
    [request.id],
  ))

  await createNotification(request.buyer_id, {
    type: 'return_resolved',
    title: `Return ${status} — order ${resolved.orderNumber}`,
    body: `${resolved.product.name}${resolutionNote ? `: ${resolutionNote}` : ''}`,
    link: '/orders',
  })

  return resolved
}
