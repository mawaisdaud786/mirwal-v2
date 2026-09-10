import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { toSqlDateTime } from '../../lib/tokens.js'
import { createNotification } from '../notifications/notifications.service.js'
import { recordOrderEvent } from './events.service.js'
import { createDiscretionaryRefund } from '../payments/refunds.service.js'
import { round2 } from './pricing.service.js'

/**
 * Cancelling part of an order.
 *
 * Cancellation used to be one shape: a buyer voiding a whole line before it shipped. Two things
 * that happen constantly had nowhere to go.
 *
 *   **Cancelling some of a line.** A buyer who ordered three and wants two had to void the line
 *   and re-order, losing their place in the dispatch queue and any coupon that needed the
 *   original basket. The quantity is reduced in place rather than the row being split, because
 *   shipments, returns, reviews and ledger entries all reference `order_items.id` — a split
 *   would leave half of them pointing at whichever row kept the id.
 *
 *   **A seller cancelling what they cannot supply.** There was no route at all, so an item the
 *   seller had no stock for sat in `processing` until somebody noticed. Worse, the
 *   cancellation-rate figure that scores sellers could not tell a seller's failure from a
 *   buyer's change of mind: `cancelled_by` existed and only ever held 'buyer'.
 *
 * Money is the part that must not be improvised. A cancelled portion is refunded at what it
 * actually cost — `line_total / quantity`, which carries the apportioned coupon discount —
 * never at `unit_price`, which would refund the buyer more than they paid on any discounted
 * order.
 */

/** What one unit of a line is worth, discount included. */
function unitValue(item) {
  const quantity = Number(item.quantity)
  if (quantity <= 0) return 0
  return Number(item.line_total) / quantity
}

/**
 * Statuses a cancellation may act on.
 *
 * Once an item is with a courier, cancelling is a return: the parcel exists and has to come
 * back. Conflating the two would leave stock credited for goods still in transit.
 */
const CANCELLABLE = ['pending', 'confirmed', 'processing']

function assertCancellable(item) {
  if (!CANCELLABLE.includes(item.status)) {
    throw conflict(
      item.status === 'shipped' || item.status === 'delivered'
        ? 'This item has already been dispatched — request a return instead.'
        : `This item is already ${item.status} and can no longer be cancelled.`,
      'CANNOT_CANCEL',
    )
  }
}

/**
 * Reduce a line by `quantity`, or void it entirely.
 *
 * Shared by all three actors so the arithmetic, the restock and the audit row cannot drift
 * apart between them. Returns what was cancelled and what it was worth.
 */
async function applyCancellation(connection, item, {
  quantity, reason, actorSide, actorUserId,
}) {
  const live = Number(item.quantity)
  const wanted = quantity == null ? live : Number(quantity)

  if (wanted <= 0) throw badRequest('Say how many to cancel.', 'INVALID_QUANTITY')
  if (wanted > live) {
    throw badRequest(
      live === 1
        ? 'There is only one of these left on the order.'
        : `Only ${live} of these are still on the order.`,
      'INVALID_QUANTITY',
    )
  }

  const value = round2(unitValue(item) * wanted)
  const whole = wanted === live

  if (whole) {
    /**
     * A voided line keeps its quantity and its price.
     *
     * `ck_order_items_quantity` requires a positive quantity, and more importantly the line is
     * the record of what was ordered — zeroing it would erase what the buyer asked for. Every
     * query that cares already filters on `status`, and `recomputeOrderTotals` below excludes
     * cancelled lines rather than relying on their money being zero.
     */
    await connection.execute(
      `UPDATE order_items
          SET status = 'cancelled',
              cancelled_quantity = cancelled_quantity + ?, cancelled_amount = cancelled_amount + ?,
              cancelled_by = ?, cancelled_reason = ?, cancelled_at = NOW(3), updated_at = ?
        WHERE id = ?`,
      [wanted, value, actorSide, reason ?? null, toSqlDateTime(), item.id],
    )
  } else {
    // The line stays live; only its size changes. `status` is deliberately untouched so
    // "is this line still to be shipped" remains a single-column question.
    await connection.execute(
      `UPDATE order_items
          SET quantity = quantity - ?, line_total = ROUND(line_total - ?, 2),
              cancelled_quantity = cancelled_quantity + ?, cancelled_amount = cancelled_amount + ?,
              cancelled_by = ?, cancelled_reason = ?, updated_at = ?
        WHERE id = ?`,
      [wanted, value, wanted, value, actorSide, reason ?? null, toSqlDateTime(), item.id],
    )
  }

  // Symmetric with checkout, which decremented the same row.
  await connection.execute(
    'UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ?',
    [wanted, item.variant_id],
  )

  await recordOrderEvent(connection, {
    orderId: item.order_id,
    orderItemId: item.id,
    eventType: whole ? 'item.cancelled' : 'item.partially_cancelled',
    fromStatus: item.status,
    toStatus: whole ? 'cancelled' : item.status,
    actorSide,
    actorUserId,
    note: reason ?? null,
    metadata: { quantity: wanted, remaining: live - wanted, amount: value },
  })

  return { quantity: wanted, amount: value, whole }
}

/**
 * Recompute the order's money after a cancellation.
 *
 * The order total has to follow the lines or the invoice, the payment reconciliation and the
 * buyer's own arithmetic all disagree. Shipping is deliberately *not* refunded when anything
 * survives on the order: the parcel is still going out, and the courier still charges for it.
 */
async function recomputeOrderTotals(connection, orderId) {
  const [[sums]] = await connection.execute(
    // A cancelled line keeps its numbers as the record of what was ordered, so the order's
    // money comes from the lines that are still live rather than from all of them.
    `SELECT COALESCE(SUM(IF(status = 'cancelled', 0, line_total)), 0) AS subtotal,
            COALESCE(SUM(IF(status = 'cancelled', 0, tax_amount)), 0) AS tax,
            COUNT(*) AS line_count,
            SUM(status = 'cancelled') AS cancelled
       FROM order_items WHERE order_id = ?`,
    [orderId],
  )
  const [[order]] = await connection.execute('SELECT shipping_fee FROM orders WHERE id = ?', [orderId])

  const everythingGone = Number(sums.line_count) > 0 && Number(sums.line_count) === Number(sums.cancelled)
  const shipping = everythingGone ? 0 : Number(order.shipping_fee)
  const total = round2(Number(sums.subtotal) + Number(sums.tax) + shipping)

  await connection.execute(
    `UPDATE orders SET subtotal = ?, tax_total = ?, shipping_fee = ?, total = ?, updated_at = NOW(3)
      WHERE id = ?`,
    [round2(Number(sums.subtotal)), round2(Number(sums.tax)), shipping, total, orderId],
  )
  return { total, everythingGone }
}

/** The order's status after the lines moved under it. Mirrors `syncOrderStatus`. */
async function syncStatus(orderId) {
  const [counts] = await query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'delivered') AS delivered,
            SUM(status = 'cancelled') AS cancelled,
            SUM(status = 'returned') AS returned,
            SUM(status = 'shipped') AS shipped,
            SUM(status IN ('confirmed','processing')) AS in_progress,
            SUM(cancelled_quantity > 0) AS touched
       FROM order_items WHERE order_id = ?`,
    [orderId],
  )
  const total = Number(counts.total)
  if (total === 0) return

  const cancelled = Number(counts.cancelled ?? 0)
  const returned = Number(counts.returned ?? 0)
  const delivered = Number(counts.delivered ?? 0)
  const shipped = Number(counts.shipped ?? 0)
  const inProgress = Number(counts.in_progress ?? 0)
  const touched = Number(counts.touched ?? 0)

  const status = cancelled === total ? 'cancelled'
    : returned === total ? 'returned'
      // Something was pulled but something survives: the order is partially cancelled whatever
      // else is true of it. Without this a part-cancelled order read as an ordinary one.
      : (cancelled > 0 || touched > 0) && delivered + cancelled + returned < total ? 'partially_cancelled'
        : delivered + cancelled + returned === total && delivered > 0
          ? (cancelled > 0 ? 'partially_cancelled' : 'delivered')
          : shipped > 0 ? 'shipped'
            : inProgress > 0 ? 'processing'
              : 'pending'

  await query('UPDATE orders SET status = ?, updated_at = NOW(3) WHERE id = ?', [status, orderId])
}

/** Load the line plus who it belongs to on both sides. */
async function loadItem(orderItemId) {
  const item = await queryOne(
    `SELECT oi.*, o.buyer_id, o.order_number, o.payment_status, o.currency_code,
            s.user_id AS seller_user_id, s.store_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN sellers s ON s.id = oi.seller_id
      WHERE oi.id = ?`,
    [orderItemId],
  )
  if (!item) throw notFound('Order item not found.', 'ORDER_ITEM_NOT_FOUND')
  return item
}

/**
 * Refund a cancelled portion, when there is anything to refund.
 *
 * Only a paid order owes money back; cash on delivery that was never collected owes nothing,
 * and creating a refund row for it would put a phantom obligation in front of finance.
 */
async function refundIfPaid(item, { amount, reason, actorUserId }) {
  if (item.payment_status !== 'paid' || amount <= 0) return null
  return createDiscretionaryRefund({
    orderId: item.order_id,
    orderItemId: item.id,
    amount,
    kind: 'cancellation',
    reason,
    createdByUserId: actorUserId,
  })
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------

/**
 * A buyer cancelling all or part of their own line before it ships.
 *
 * No password re-check: cancelling an unshipped item is the buyer's own right, it is
 * reversible, and no marketplace asks someone to re-authenticate for it. Re-auth is reserved
 * for actions where a hijacked session does lasting damage — changing the payout destination is
 * the one that earns it.
 */
export async function cancelByBuyer(buyerId, orderItemId, { quantity = null, reason = null } = {}) {
  const item = await loadItem(orderItemId)
  if (item.buyer_id !== buyerId) throw forbidden('This order item does not belong to you.')
  assertCancellable(item)

  const result = await withTransaction(async (connection) => {
    const cancelled = await applyCancellation(connection, item, {
      quantity, reason, actorSide: 'buyer', actorUserId: buyerId,
    })
    const totals = await recomputeOrderTotals(connection, item.order_id)
    return { ...cancelled, ...totals }
  })

  await syncStatus(item.order_id)
  const refund = await refundIfPaid(item, {
    amount: result.amount,
    reason: reason ?? 'Buyer cancelled before dispatch',
    actorUserId: buyerId,
  })

  await createNotification(item.seller_user_id, {
    type: 'item_cancelled',
    title: `Order ${item.order_number} — ${result.whole ? 'item cancelled' : 'quantity reduced'}`,
    body: result.whole
      ? `The buyer cancelled ${item.product_name} before it shipped.`
      : `The buyer cancelled ${result.quantity} of ${item.product_name}; ${Number(item.quantity) - result.quantity} still to ship.`,
    link: '/seller-center/orders',
  })

  return {
    cancelledQuantity: result.quantity,
    remainingQuantity: Number(item.quantity) - result.quantity,
    refunded: formatMoney(result.amount, item.currency_code),
    orderTotal: formatMoney(result.total, item.currency_code),
    refundStatus: refund?.status ?? null,
  }
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

/**
 * A seller cancelling what they cannot supply.
 *
 * Recorded as `cancelled_by = 'seller'`, which is the whole point: the seller's own
 * cancellation rate should count this and must not count the buyer's change of mind. A reason
 * is required — the buyer is told it, and "cancelled" with no explanation is the single most
 * complained-about experience on any marketplace.
 */
export async function cancelBySeller(sellerId, sellerUserId, orderItemId, { quantity = null, reason }) {
  const item = await loadItem(orderItemId)
  if (item.seller_id !== sellerId) throw forbidden('This item belongs to another store.')
  assertCancellable(item)

  const result = await withTransaction(async (connection) => {
    const cancelled = await applyCancellation(connection, item, {
      quantity, reason, actorSide: 'seller', actorUserId: sellerUserId,
    })
    const totals = await recomputeOrderTotals(connection, item.order_id)
    return { ...cancelled, ...totals }
  })

  await syncStatus(item.order_id)
  const refund = await refundIfPaid(item, {
    amount: result.amount,
    reason: `Seller could not supply: ${reason}`,
    actorUserId: sellerUserId,
  })

  const buyer = await queryOne('SELECT buyer_id FROM orders WHERE id = ?', [item.order_id])
  await createNotification(buyer.buyer_id, {
    type: 'item_cancelled',
    title: `Order ${item.order_number} — ${result.whole ? 'an item was cancelled' : 'quantity reduced'}`,
    // The buyer is told what happened and what it means for their money, in one message.
    body: `${item.store_name} could not supply ${result.whole ? item.product_name : `${result.quantity} of ${item.product_name}`}. ${
      item.payment_status === 'paid'
        ? `${formatMoney(result.amount, item.currency_code)} is being refunded.`
        : 'You will not be charged for it.'
    }${reason ? ` Reason given: ${reason}` : ''}`,
    link: '/account/orders',
  })

  return {
    cancelledQuantity: result.quantity,
    remainingQuantity: Number(item.quantity) - result.quantity,
    refunded: formatMoney(result.amount, item.currency_code),
    refundStatus: refund?.status ?? null,
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * Mirwal cancelling on either party's behalf.
 *
 * `actorSide` decides whose record carries it, because an operator cancelling for a seller who
 * telephoned is still the seller's failure, and attributing it to Mirwal would quietly launder
 * a bad seller's statistics.
 */
export async function cancelByAdmin(adminUserId, orderItemId, { quantity = null, reason, onBehalfOf = 'admin' }) {
  const item = await loadItem(orderItemId)
  assertCancellable(item)

  const result = await withTransaction(async (connection) => {
    const cancelled = await applyCancellation(connection, item, {
      quantity, reason, actorSide: onBehalfOf, actorUserId: adminUserId,
    })
    const totals = await recomputeOrderTotals(connection, item.order_id)
    return { ...cancelled, ...totals }
  })

  await syncStatus(item.order_id)
  const refund = await refundIfPaid(item, {
    amount: result.amount,
    reason: `Cancelled by Mirwal: ${reason}`,
    actorUserId: adminUserId,
  })

  await createNotification(item.buyer_id, {
    type: 'item_cancelled',
    title: `Order ${item.order_number} — an item was cancelled`,
    body: `${result.whole ? item.product_name : `${result.quantity} of ${item.product_name}`} was cancelled. ${reason}`,
    link: '/account/orders',
  })
  await createNotification(item.seller_user_id, {
    type: 'item_cancelled',
    title: `Order ${item.order_number} — Mirwal cancelled an item`,
    body: `${item.product_name}: ${reason}`,
    link: '/seller-center/orders',
  })

  return {
    cancelledQuantity: result.quantity,
    refunded: formatMoney(result.amount, item.currency_code),
    refundStatus: refund?.status ?? null,
    attributedTo: onBehalfOf,
  }
}

/**
 * What has been pulled off an order, for the buyer's own record.
 *
 * A line whose quantity silently dropped from three to one is confusing; showing the
 * cancellation alongside it is what makes the smaller number make sense.
 */
export async function cancellationsForOrder(orderId) {
  const rows = await query(
    `SELECT oi.product_name, oi.cancelled_quantity, oi.cancelled_amount, oi.cancelled_by,
            oi.cancelled_reason, oi.cancelled_at, o.currency_code
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id = ? AND oi.cancelled_quantity > 0
      ORDER BY oi.id`,
    [orderId],
  )
  return rows.map((row) => ({
    product: row.product_name,
    quantity: Number(row.cancelled_quantity),
    amount: formatMoney(row.cancelled_amount, row.currency_code),
    by: row.cancelled_by,
    reason: row.cancelled_reason,
    at: row.cancelled_at,
  }))
}
