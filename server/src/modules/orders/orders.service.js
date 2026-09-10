import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { createNotification } from '../notifications/notifications.service.js'
import { assertMethodAvailable } from '../payments/payments.service.js'
import { getNumericSetting } from '../settings/settings.service.js'
import { recordOrderEvent } from './events.service.js'
import { postSaleEarning } from '../payouts/ledger.service.js'
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
    seller: row.seller_slug ? { id: row.seller_public_id, slug: row.seller_slug, name: row.seller_store_name } : null,
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
    /**
     * What has already been pulled off this line.
     *
     * A quantity that silently drops from three to one is confusing on its own; showing the
     * cancellation beside it is what makes the smaller number make sense. Null when nothing was
     * cancelled, so the common line renders exactly as it always did.
     */
    cancelled: Number(row.cancelled_quantity) > 0 ? {
      quantity: Number(row.cancelled_quantity),
      amount: formatMoney(row.cancelled_amount, row.currency_code),
      by: row.cancelled_by,
      reason: row.cancelled_reason,
    } : null,
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
         oi.cancelled_quantity, oi.cancelled_amount, oi.cancelled_by, oi.cancelled_reason,
         p.public_id AS product_public_id, p.slug AS product_slug,
         s.public_id AS seller_public_id, s.slug AS seller_slug, s.store_name AS seller_store_name,
         o.public_id AS order_public_id,
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
    const coupon = await resolveCoupon(connection, { code: couponCode, buyerId, lines })
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
 * Every order on the marketplace, for staff.
 *
 * Used to take no arguments and return the lot. That is fine at 700 orders and untenable at
 * 70,000: the whole table crossed the wire on every visit to the page, and the panel's search
 * box filtered whatever had arrived rather than asking the database — so an order the admin
 * knew existed could simply fail to appear.
 *
 * The rolled-up status is computed in SQL rather than read from `orders.status` deliberately.
 * The order row records where the order as a whole stands; what an operator scanning this list
 * needs is what its items are actually doing, and the two legitimately disagree while a
 * multi-seller order is half shipped.
 */
export async function listOrdersForAdmin({
  page = 1, pageSize = 25, search = '', status = '', paymentStatus = '',
} = {}) {
  const where = []
  const params = []

  if (search) {
    // Order number, buyer name and buyer email, because those are the three things somebody
    // arrives holding when they need to find an order.
    where.push('(o.order_number LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like)
  }
  if (paymentStatus) {
    where.push('o.payment_status = ?')
    params.push(paymentStatus)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  /**
   * The rolled-up status is a HAVING, not a WHERE.
   *
   * It is derived from the aggregated item counts, which do not exist until after grouping.
   * Filtering it in the WHERE clause would silently match nothing.
   */
  const havingSql = status
    ? `HAVING (CASE
                 WHEN COUNT(oi.id) > 0 AND SUM(oi.status = 'delivered') = COUNT(oi.id) THEN 'delivered'
                 WHEN COUNT(oi.id) > 0 AND SUM(oi.status = 'cancelled') = COUNT(oi.id) THEN 'cancelled'
                 WHEN SUM(oi.status = 'shipped') > 0 THEN 'shipped'
                 ELSE 'processing'
               END) = ?`
    : ''

  const rows = await query(
    `SELECT o.*, u.public_id AS buyer_public_id, u.full_name AS buyer_name, u.email AS buyer_email,
            COUNT(oi.id) AS item_count,
            SUM(oi.status = 'delivered') AS delivered_count,
            SUM(oi.status = 'cancelled') AS cancelled_count,
            SUM(oi.status = 'shipped') AS shipped_count
       FROM orders o
       JOIN users u ON u.id = o.buyer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${whereSql}
      GROUP BY o.id
      ${havingSql}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, ...(status ? [status] : []), pageSize, (page - 1) * pageSize],
  )

  /**
   * The count has to repeat the grouping.
   *
   * A plain `COUNT(*)` over the joined rows would count order items, not orders, and a status
   * filter only exists after the group — so the total is the number of surviving groups.
   */
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM (
        SELECT o.id
          FROM orders o
          JOIN users u ON u.id = o.buyer_id
          LEFT JOIN order_items oi ON oi.order_id = o.id
          ${whereSql}
         GROUP BY o.id
         ${havingSql}
     ) AS matched`,
    [...params, ...(status ? [status] : [])],
  )

  const items = rows.map((row) => {
    const itemCount = Number(row.item_count)
    const rolledUp = itemCount > 0 && Number(row.delivered_count) === itemCount ? 'delivered'
      : itemCount > 0 && Number(row.cancelled_count) === itemCount ? 'cancelled'
        : Number(row.shipped_count) > 0 ? 'shipped'
          : 'processing'
    return {
      id: row.public_id,
      orderNumber: row.order_number,
      // The id is what makes the buyer column a link rather than a dead string.
      buyer: { id: row.buyer_public_id, name: row.buyer_name, email: row.buyer_email },
      itemCount,
      total: formatMoney(row.total, row.currency_code),
      status: rolledUp,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      createdAt: row.created_at,
    }
  })

  return { items, total: Number(total) }
}

/** Headline counts for the list, over every order rather than the page being shown. */
export async function orderCountsForAdmin() {
  const [row] = await query(
    `SELECT COUNT(*) AS total,
            SUM(o.payment_status = 'paid') AS paid,
            SUM(o.payment_status = 'pending') AS unpaid,
            SUM(o.payment_status IN ('refunded', 'partially_refunded')) AS refunded
       FROM orders o`,
  )
  const rolled = await query(
    `SELECT rolled_up AS status, COUNT(*) AS n FROM (
        SELECT CASE
                 WHEN COUNT(oi.id) > 0 AND SUM(oi.status = 'delivered') = COUNT(oi.id) THEN 'delivered'
                 WHEN COUNT(oi.id) > 0 AND SUM(oi.status = 'cancelled') = COUNT(oi.id) THEN 'cancelled'
                 WHEN SUM(oi.status = 'shipped') > 0 THEN 'shipped'
                 ELSE 'processing'
               END AS rolled_up
          FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
         GROUP BY o.id
     ) AS grouped
     GROUP BY rolled_up`,
  )

  const counts = { total: Number(row.total), paid: Number(row.paid ?? 0), unpaid: Number(row.unpaid ?? 0), refunded: Number(row.refunded ?? 0) }
  for (const entry of rolled) counts[entry.status] = Number(entry.n)
  return counts
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

/**
 * The lines a store has to fulfil.
 *
 * Returned every order item the store had ever sold, and the panel filtered and counted that
 * array in the browser — so a store with ten thousand lines downloaded all of them to work
 * today's dispatches, and the status tabs described only what had arrived.
 */
export async function listOrderItemsForSeller(sellerId, { page = 1, pageSize = 25, status, search } = {}) {
  const where = ['oi.seller_id = ?']
  const params = [sellerId]

  if (status === 'processing') {
    // What the panel calls "processing" is the pre-dispatch group, not a single status.
    where.push("oi.status IN ('pending', 'confirmed', 'processing')")
  } else if (status) {
    where.push('oi.status = ?')
    params.push(status)
  }
  if (search) {
    where.push('(o.order_number LIKE ? OR oi.product_name LIKE ? OR o.shipping_full_name LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like)
  }
  const whereSql = where.join(' AND ')

  const rows = await query(
    `${ORDER_ITEM_SELECT} WHERE ${whereSql} ORDER BY oi.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${whereSql}`,
    params,
  )

  return {
    items: rows.map((row) => ({
      ...shapeOrderItem(row),
      orderNumber: row.order_number,
      orderId: row.order_public_id,
      placedAt: row.created_at,
    })),
    total: Number(total),
  }
}

/** How many lines sit in each state, over the whole store rather than the visible page. */
export async function orderItemCountsForSeller(sellerId) {
  const rows = await query(
    'SELECT status, COUNT(*) AS n FROM order_items WHERE seller_id = ? GROUP BY status',
    [sellerId],
  )
  const counts = { all: 0, processing: 0 }
  for (const row of rows) {
    const n = Number(row.n)
    counts[row.status] = n
    counts.all += n
    if (['pending', 'confirmed', 'processing'].includes(row.status)) counts.processing += n
  }
  return counts
}
/**
 * Update the status of one order item — a seller may only ever move their own items, and
 * only forward through the fulfillment lifecycle (or to cancelled).
 */
export async function updateOrderItemStatusForSeller(sellerId, orderItemId, status, { reason } = {}) {
  const item = await queryOne(
    'SELECT id, order_id, seller_id, status, line_total, discount_amount, discount_funded_by FROM order_items WHERE id = ?',
    [orderItemId],
  )
  if (!item) throw notFound('Order item not found.', 'ORDER_ITEM_NOT_FOUND')
  if (item.seller_id !== sellerId) throw forbidden('This order item does not belong to your store.')

  /**
   * The lifecycle.
   *
   * `failed_delivery` is new and is not a synonym for cancelled: the seller shipped, performed
   * correctly, and the courier could not hand the parcel over. Scoring that as a cancellation
   * — which the old three-outcome model forced — punishes a seller for a buyer being out.
   * From there the parcel is either re-attempted (back to shipped) or comes back (returned).
   */
  const FORWARD = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered', 'failed_delivery'],
    failed_delivery: ['shipped', 'delivered', 'returned'],
    delivered: [],
    cancelled: [],
    returned: [],
  }
  if (!FORWARD[item.status]?.includes(status)) {
    throw conflict(`Cannot move an order item from "${item.status}" to "${status}".`, 'INVALID_STATUS_TRANSITION')
  }

  /**
   * "Shipped" is not a status a seller may simply assert.
   *
   * It is what a shipment *means*, and a shipment carries a carrier, a tracking number and a
   * dispatch time — the things a buyer needs to follow their parcel and the only evidence
   * either side has in a "it never arrived" dispute. Allowing this status to be set directly
   * left it decorative, which is exactly the state this whole area was built to fix.
   *
   * The exception is a re-attempt after a failed delivery: the shipment already exists, the
   * courier is simply trying again, and forcing a second shipment row would misrepresent one
   * parcel as two.
   */
  if (status === 'shipped' && item.status !== 'failed_delivery') {
    throw conflict(
      'Create a shipment with the carrier and tracking number instead — that is what marks an item shipped.',
      'SHIPMENT_REQUIRED',
    )
  }

  const order = await queryOne(
    `SELECT o.id, o.buyer_id, o.public_id, o.order_number, o.payment_method, o.payment_status,
            o.currency_code
       FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?`,
    [orderItemId],
  )

  await withTransaction(async (connection) => {
    /**
     * Real fulfilment timestamps.
     *
     * `updated_at` cannot answer "was this dispatched on time" because the next edit
     * overwrites it, so on-time-dispatch rate — the metric seller performance is actually
     * judged on — was previously uncomputable.
     */
    const stamps = {
      confirmed: 'confirmed_at = COALESCE(confirmed_at, NOW(3))',
      shipped: 'shipped_at = COALESCE(shipped_at, NOW(3))',
      delivered: 'delivered_at = COALESCE(delivered_at, NOW(3))',
    }[status]

    await connection.execute(
      `UPDATE order_items
          SET status = ?,
              ${stamps ? `${stamps},` : ''}
              ${status === 'cancelled' ? "cancelled_by = 'seller', cancelled_reason = ?, cancelled_at = NOW(3)," : ''}
              updated_at = NOW(3)
        WHERE id = ?`,
      status === 'cancelled'
        ? [status, reason ?? null, orderItemId]
        : [status, orderItemId],
    )

    await recordOrderEvent(connection, {
      orderId: order.id,
      orderItemId,
      eventType: `item.${status}`,
      fromStatus: item.status,
      toStatus: status,
      actorSide: 'seller',
      note: reason ?? null,
    })

    /**
     * Delivery is the earning event.
     *
     * Posted here, inside the same transaction as the status change, so a delivered item and
     * the money it earns cannot disagree. `uq_seller_ledger_sale_once` makes a repeat harmless,
     * which matters because this path is reachable from a retry.
     */
    if (status === 'delivered') {
      await postSaleEarning(connection, {
        sellerId,
        orderItemId,
        orderId: order.id,
        lineTotal: item.line_total,
        discountAmount: item.discount_amount,
        discountFundedBy: item.discount_funded_by,
        currencyCode: order.currency_code,
      })
    }
  })

  const updated = await queryOne(`${ORDER_ITEM_SELECT} WHERE oi.id = ?`, [orderItemId])

  // Cash on Delivery is settled by the courier at the door, so delivery IS the payment event
  // — nothing else would ever mark a COD order paid. Applied once every item that is still
  // live has been delivered, so a partly-delivered multi-seller order isn't called paid
  // early. Without this, COD orders stayed 'pending' forever, which also meant an approved
  // return on one owed the buyer nothing.
  if (status === 'delivered' && order.payment_method === 'cod' && order.payment_status !== 'paid') {
    const outstanding = await queryOne(
      `SELECT COUNT(*) AS count FROM order_items
        WHERE order_id = ? AND status NOT IN ('delivered', 'cancelled', 'returned', 'failed_delivery')`,
      [order.id],
    )
    if (Number(outstanding.count) === 0) {
      await query("UPDATE orders SET payment_status = 'paid', paid_at = NOW(3) WHERE id = ?", [order.id])
    }
  }

  await syncOrderStatus(order.id)

  await createNotification(order.buyer_id, {
    type: 'order_status_changed',
    title: `Order ${order.order_number} is now ${status.replace('_', ' ')}`,
    body: `${updated.product_name} — ${STATUS_NOTIFICATION_COPY[status] ?? `status updated to ${status}`}`,
    link: `/order-success/${order.public_id}`,
  })

  return shapeOrderItem(updated)
}

/**
 * Recompute the order-level status from its items.
 *
 * A multi-seller order has no single status of its own — it is a summary of its lines, and the
 * summary previously had no way to say "one of three sellers cancelled". `partially_cancelled`
 * is that missing state: calling the whole order cancelled would tell the buyer their other
 * two items were not coming, which is untrue.
 */
async function syncOrderStatus(orderId) {
  const [counts] = await query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'delivered') AS delivered,
            SUM(status = 'cancelled') AS cancelled,
            SUM(status = 'returned') AS returned,
            SUM(status = 'failed_delivery') AS failed,
            SUM(status = 'shipped') AS shipped,
            SUM(status IN ('confirmed','processing')) AS in_progress
       FROM order_items WHERE order_id = ?`,
    [orderId],
  )

  const total = Number(counts.total)
  if (total === 0) return

  const delivered = Number(counts.delivered ?? 0)
  const cancelled = Number(counts.cancelled ?? 0)
  const returned = Number(counts.returned ?? 0)
  const failed = Number(counts.failed ?? 0)
  const shipped = Number(counts.shipped ?? 0)
  const inProgress = Number(counts.in_progress ?? 0)

  const status = cancelled === total ? 'cancelled'
    : returned === total ? 'returned'
      : delivered + cancelled + returned === total && delivered > 0
        ? (cancelled > 0 ? 'partially_cancelled' : 'delivered')
        : failed > 0 && shipped === 0 && inProgress === 0 ? 'failed_delivery'
          : shipped > 0 ? 'shipped'
            : inProgress > 0 ? 'processing'
              : 'pending'

  await query('UPDATE orders SET status = ?, updated_at = NOW(3) WHERE id = ?', [status, orderId])
}

/** Exported for the returns module, which needs the same ownership check. */
export async function findOwnedOrderItem(buyerId, orderItemId) {
  const item = await queryOne(
    `SELECT oi.*, o.buyer_id, o.order_number FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?`,
    [orderItemId],
  )
  if (!item) throw notFound('Order item not found.', 'ORDER_ITEM_NOT_FOUND')
  if (item.buyer_id !== buyerId) throw forbidden('This order item does not belong to you.')
  return item
}

/*
 * Buyer cancellation moved to `cancellation.service.js`.
 *
 * What was here could only void a whole line, and only for a buyer. It could not cancel two of
 * three, no seller or operator could cancel at all, and it never refunded anything — a paid
 * order that was cancelled simply kept the buyer's money with nothing recording the debt.
 */
/*
 * The return lifecycle moved to `returns.service.js`.
 *
 * What was here handled three states and one actor: the seller decided a return filed against
 * their own store, and there was no appeal. It also refused a second request whenever any row
 * existed for the item, so a rejection permanently consumed the buyer's only attempt — which
 * migration 021 had already replaced with a "one *open* request per item" index that nothing
 * read. `findOwnedOrderItem` above is exported for the new module; nothing else here is needed.
 */
