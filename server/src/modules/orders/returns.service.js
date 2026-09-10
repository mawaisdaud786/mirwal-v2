import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { conflict, forbidden, notFound, badRequest } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { toSqlDateTime } from '../../lib/tokens.js'
import { createNotification } from '../notifications/notifications.service.js'
import { createRefundForReturn, processRefund } from '../payments/refunds.service.js'
import { getSetting } from '../settings/settings.service.js'
import { recordOrderEvent } from './events.service.js'

/**
 * The return lifecycle.
 *
 * What existed was three states — requested, approved, rejected — and one actor. The seller
 * decided, and that was the end of it. Every other real situation had to be squeezed into one
 * of the three, which meant the status shown to the buyer was routinely untrue: a return that
 * had been approved and posted said "approved"; a seller who needed a photograph before
 * deciding had to either approve blind or reject; a buyer who wanted the item replaced got a
 * refund; and a buyer who thought the rejection was wrong had nowhere at all to go.
 *
 * Migration 021 put the full lifecycle in the schema — `more_info_required`, `in_transit`,
 * `received`, `refunded`, `replaced`, `cancelled`, `escalated`, plus evidence, carriage
 * liability and an admin decision — and nothing ever wrote any of it. This is that code.
 *
 * The design decisions worth stating, because each of them is a place this could have gone
 * differently:
 *
 * **The seller decides first, and Mirwal decides last.** A marketplace that adjudicates every
 * return cannot scale, and one that never does is a marketplace where the seller is the judge
 * of their own case. So the seller resolves; the buyer may escalate a rejection to Mirwal
 * within a window; and Mirwal's decision overrides. That is the sequence the `escalated_at` /
 * `admin_decision` columns were built for.
 *
 * **Escalation is a right, not a favour.** It is available on any rejection and on any request
 * the seller has simply not answered. A dispute route that only opens when a seller agrees to
 * open it protects the wrong party.
 *
 * **Refunds can be partial.** "Approve or reject" forces a seller facing a slightly damaged
 * item to either eat the whole line or refuse the buyer entirely, and both parties lose. A
 * partial refund settles far more disputes than it creates, so the amount is a parameter with
 * the line total as its ceiling.
 *
 * **Money moves once.** `refunds.return_request_id` is unique, so a return can only ever owe
 * one refund no matter how many times a decision is revisited. An admin overriding a seller's
 * rejection creates the refund that the rejection did not; overriding an approval cannot claw
 * one back, and the code says so rather than pretending otherwise.
 */

/**
 * How long a seller has to answer before the buyer may bring Mirwal in.
 *
 * A dispute route that only opens once the seller has acted lets a seller bury a claim by
 * ignoring it, so silence is escalatable too.
 */
const SELLER_RESPONSE_HOURS = 72

/** States in which a return is still someone's problem. Mirrors `uq_return_requests_open`. */
const OPEN_STATUSES = new Set(['requested', 'more_info_required', 'approved', 'in_transit', 'received', 'escalated'])

/** What the seller may do from each state. Anything not listed here is refused. */
const SELLER_TRANSITIONS = {
  requested: ['more_info_required', 'approved', 'rejected'],
  more_info_required: ['approved', 'rejected'],
  approved: ['received', 'refunded', 'replaced'],
  in_transit: ['received', 'refunded', 'replaced'],
  received: ['refunded', 'replaced', 'rejected'],
}

const SELECT_RETURN = `
  SELECT r.*, oi.product_id, oi.quantity, oi.line_total, oi.variant_id, oi.order_id, oi.status AS item_status,
         o.order_number, o.currency_code, o.buyer_id AS buyer_user_id,
         p.public_id AS product_public_id, p.name AS product_name,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position, id LIMIT 1) AS product_image_url,
         u.full_name AS buyer_name,
         s.public_id AS seller_public_id, s.store_name, s.user_id AS seller_user_id,
         c.name AS return_carrier_name
    FROM return_requests r
    JOIN order_items oi ON oi.id = r.order_item_id
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    JOIN users u ON u.id = r.buyer_id
    JOIN sellers s ON s.id = r.seller_id
    LEFT JOIN carriers c ON c.id = r.return_carrier_id`

function shape(row, { audience = 'buyer' } = {}) {
  return {
    id: row.public_id,
    status: row.status,
    type: row.return_type,
    reason: row.reason,
    description: row.description,
    resolutionNote: row.resolution_note,
    evidenceCount: Number(row.evidence_count ?? 0),
    orderNumber: row.order_number,
    product: { id: row.product_public_id, name: row.product_name, image: row.product_image_url ?? null },
    quantity: row.quantity,
    lineTotal: formatMoney(row.line_total, row.currency_code),
    refundAmount: row.refund_amount == null ? null : formatMoney(row.refund_amount, row.currency_code),
    returnShippingPaidBy: row.return_shipping_paid_by,
    returnTracking: row.return_tracking,
    returnCarrier: row.return_carrier_name ?? null,
    windowClosesAt: row.window_closes_at,
    escalatedAt: row.escalated_at,
    // `admin_decision` is deliberately visible to both sides. A buyer told only "rejected"
    // when Mirwal overruled the seller learns nothing; the point of an appeal is that its
    // result is legible.
    adminDecision: row.admin_decision
      ? { outcome: row.admin_decision, note: row.admin_decision_note, at: row.admin_decision_at }
      : null,
    receivedAt: row.received_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    // Worked out here rather than in the browser, because the three-day rule is the server's
    // and a page that computes its own copy of it will disagree with the API sooner or later.
    canEscalate: canEscalate(row),
    // Staff and the seller see who filed it; the buyer already knows.
    ...(audience === 'buyer' ? {} : { buyer: { name: row.buyer_name } }),
    ...(audience === 'admin' ? { seller: { id: row.seller_public_id, storeName: row.store_name } } : {}),
  }
}

function canEscalate(row) {
  if (row.escalated_at || row.admin_decision) return false
  if (row.status === 'rejected') return true
  return ['requested', 'more_info_required'].includes(row.status)
    && Date.now() - new Date(row.created_at).getTime() > SELLER_RESPONSE_HOURS * 3_600_000
}

const reload = async (id, options) => shape(await queryOne(`${SELECT_RETURN} WHERE r.id = ?`, [id]), options)

// ---------------------------------------------------------------------------
// The return window
// ---------------------------------------------------------------------------

/**
 * How long this buyer has, for this item.
 *
 * A seller may offer a longer window than Mirwal requires but never a shorter one — the
 * platform figure is a floor, not a default that a store policy can undercut. `store_policies`
 * says as much in its own comment; this is the code that honours it.
 */
export async function returnWindowFor(sellerId) {
  const platformDays = Number(await getSetting('orders.return_window_days')) || 7
  const policy = await queryOne(
    'SELECT return_window_days, returns_accepted, return_shipping_paid_by FROM store_policies WHERE seller_id = ?',
    [sellerId],
  )
  const sellerDays = policy?.return_window_days == null ? null : Number(policy.return_window_days)
  return {
    days: sellerDays == null ? platformDays : Math.max(sellerDays, platformDays),
    // A store may not switch returns off altogether; the setting narrows to non-faulty goods,
    // which is why a "damaged" or "wrong item" reason ignores it below.
    accepted: policy ? Boolean(policy.returns_accepted) : true,
    shippingPaidBy: policy?.return_shipping_paid_by ?? 'buyer',
  }
}

/** Faults where the seller pays carriage no matter what their policy says. */
const SELLER_FAULT_REASONS = new Set(['damaged', 'wrong_item', 'not_as_described', 'counterfeit', 'missing_parts'])

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------

/**
 * File a return.
 *
 * The old check refused a second request whenever *any* row existed for the item, which meant
 * a rejected request permanently consumed the buyer's only attempt — including when the
 * rejection was later overturned. Migration 021 replaced the unique index with "one *open*
 * request per item" for exactly that reason, and this now matches it.
 */
export async function createReturn(buyerId, orderItem, { reason, description, returnType = 'refund' }) {
  if (orderItem.status !== 'delivered') {
    throw conflict('Only a delivered item can be returned.', 'ITEM_NOT_DELIVERED')
  }

  const open = await queryOne(
    'SELECT public_id, status FROM return_requests WHERE order_item_id = ? AND open_order_item_id IS NOT NULL',
    [orderItem.id],
  )
  if (open) throw conflict('A return request is already open for this item.', 'RETURN_ALREADY_REQUESTED')

  const window = await returnWindowFor(orderItem.seller_id)
  const sellerFault = SELLER_FAULT_REASONS.has(reason)
  if (!window.accepted && !sellerFault) {
    throw conflict(
      'This store does not accept returns for change of mind. If the item arrived damaged or is not what you ordered, choose that reason instead.',
      'RETURNS_NOT_ACCEPTED',
    )
  }

  // Measured from delivery, not from the order date: a parcel that took three weeks to arrive
  // must not arrive with its return window already spent.
  const deliveredAt = orderItem.delivered_at ?? orderItem.updated_at
  const closesAt = new Date(new Date(deliveredAt).getTime() + window.days * 86_400_000)
  if (!sellerFault && closesAt < new Date()) {
    throw conflict(
      `The ${window.days}-day return window for this item has closed.`,
      'RETURN_WINDOW_CLOSED',
    )
  }

  const publicId = randomUUID()
  await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO return_requests
         (public_id, order_item_id, buyer_id, seller_id, reason, return_type, description,
          window_closes_at, return_shipping_paid_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId, orderItem.id, buyerId, orderItem.seller_id, reason, returnType, description ?? '',
        toSqlDateTime(closesAt),
        // Decided at filing so both sides can see it before anything is posted. A fault is the
        // seller's carriage; anything else follows the store's policy.
        sellerFault ? 'seller' : window.shippingPaidBy,
      ],
    )
    await recordOrderEvent(connection, {
      orderId: orderItem.order_id,
      orderItemId: orderItem.id,
      eventType: 'return.requested',
      toStatus: 'requested',
      actorSide: 'buyer',
      actorUserId: buyerId,
      // The buyer's own words where they wrote any, and the reason otherwise. The reason code
      // is kept in the metadata, where it can still be counted.
      note: description || String(reason).replace(/_/g, ' '),
      metadata: { reason, returnType, requestId: result.insertId },
    })
  })

  const seller = await queryOne('SELECT user_id FROM sellers WHERE id = ?', [orderItem.seller_id])
  await createNotification(seller.user_id, {
    type: 'return_requested',
    // The order number is in the title because that is what a seller searches their own
    // records by; the product name alone is ambiguous across two orders of the same thing.
    title: `Return requested — order ${orderItem.order_number}`,
    body: `${orderItem.product_name ?? 'An item'}: ${String(reason).replace(/_/g, ' ')}`,
    link: '/orders/returns',
  })

  return { id: publicId, status: 'requested', windowClosesAt: closesAt }
}

/** The buyer's own returns. */
export async function listForBuyer(buyerId) {
  const rows = await query(`${SELECT_RETURN} WHERE r.buyer_id = ? ORDER BY r.created_at DESC`, [buyerId])
  return rows.map((row) => shape(row))
}

export async function getForBuyer(buyerId, publicId) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row || row.buyer_id !== buyerId) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  return {
    ...shape(row),
    evidence: await listEvidence(row.id),
    messages: await listMessages(row.id),
    timeline: await timeline(row.id),
  }
}

/** Withdraw a request. Only while it is still open and before anything has been posted. */
export async function cancelByBuyer(buyerId, publicId) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row || row.buyer_id !== buyerId) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (!['requested', 'more_info_required', 'approved'].includes(row.status)) {
    throw conflict('This return can no longer be withdrawn.', 'RETURN_NOT_CANCELLABLE')
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      "UPDATE return_requests SET status = 'cancelled', resolved_at = ? WHERE id = ?",
      [toSqlDateTime(), row.id],
    )
    await recordOrderEvent(connection, {
      orderId: row.order_id,
      orderItemId: row.order_item_id,
      eventType: 'return.cancelled',
      fromStatus: row.status,
      toStatus: 'cancelled',
      actorSide: 'buyer',
      actorUserId: buyerId,
    })
  })
  return reload(row.id)
}

/** Tell the seller it is on its way back. */
export async function markPosted(buyerId, publicId, { carrierId = null, tracking }) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row || row.buyer_id !== buyerId) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (row.status !== 'approved') {
    throw conflict('Wait for the seller to approve the return before posting it.', 'RETURN_NOT_APPROVED')
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      "UPDATE return_requests SET status = 'in_transit', return_carrier_id = ?, return_tracking = ? WHERE id = ?",
      [carrierId, tracking, row.id],
    )
    await recordOrderEvent(connection, {
      orderId: row.order_id,
      orderItemId: row.order_item_id,
      eventType: 'return.in_transit',
      fromStatus: row.status,
      toStatus: 'in_transit',
      actorSide: 'buyer',
      actorUserId: buyerId,
      metadata: { tracking },
    })
  })

  await createNotification(row.seller_user_id, {
    type: 'return_in_transit',
    title: `Return posted — ${row.product_name}`,
    body: `Tracking ${tracking}. Mark it received when it arrives.`,
    link: '/orders/returns',
  })
  return reload(row.id)
}

/**
 * Escalate to Mirwal.
 *
 * Open on any rejection and on any request the seller has left unanswered past the response
 * window. Both matter: a dispute route that only opens when the seller has acted lets a seller
 * bury a claim by ignoring it.
 */
export async function escalate(buyerId, publicId, { note }) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row || row.buyer_id !== buyerId) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (row.escalated_at) throw conflict('Mirwal is already looking at this.', 'ALREADY_ESCALATED')

  if (!canEscalate(row)) {
    throw conflict(
      row.status === 'requested' || row.status === 'more_info_required'
        ? 'Give the seller a chance to reply first — you can bring Mirwal in after three days.'
        : 'There is nothing to dispute on this return yet.',
      'NOT_ESCALATABLE',
    )
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      "UPDATE return_requests SET status = 'escalated', escalated_at = ? WHERE id = ?",
      [toSqlDateTime(), row.id],
    )
    await connection.execute(
      `INSERT INTO return_messages (public_id, return_request_id, author_id, author_side, body)
       VALUES (?, ?, ?, 'buyer', ?)`,
      [randomUUID(), row.id, buyerId, String(note).slice(0, 4000)],
    )
    await recordOrderEvent(connection, {
      orderId: row.order_id,
      orderItemId: row.order_item_id,
      eventType: 'return.escalated',
      fromStatus: row.status,
      toStatus: 'escalated',
      actorSide: 'buyer',
      actorUserId: buyerId,
      note,
    })
  })

  await createNotification(row.seller_user_id, {
    type: 'return_escalated',
    title: `Return disputed — ${row.product_name}`,
    body: 'The buyer has asked Mirwal to look at this return. You can add your side before we decide.',
    link: '/orders/returns',
  })
  return reload(row.id)
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

export async function listForSeller(sellerId, { status } = {}) {
  const rows = await query(
    `${SELECT_RETURN} WHERE r.seller_id = ?${status ? ' AND r.status = ?' : ''} ORDER BY r.created_at DESC`,
    status ? [sellerId, status] : [sellerId],
  )
  return rows.map((row) => shape(row, { audience: 'seller' }))
}

export async function getForSeller(sellerId, publicId) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (row.seller_id !== sellerId) throw forbidden('This return request does not belong to your store.')
  return {
    ...shape(row, { audience: 'seller' }),
    evidence: await listEvidence(row.id),
    messages: await listMessages(row.id),
    timeline: await timeline(row.id),
  }
}

/**
 * Move a return along.
 *
 * One entry point rather than a method per transition, because the guard that matters is the
 * same in every case — is this move legal from where the return is now — and splitting it
 * across six functions is how one of them ends up missing the check.
 *
 * A return under escalation is frozen: once Mirwal has been asked, the seller resolving it
 * unilaterally would decide the dispute they are a party to.
 */
export async function advanceBySeller(sellerId, sellerUserId, publicId, {
  status, note, refundAmount, returnShippingPaidBy,
}) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (row.seller_id !== sellerId) throw forbidden('This return request does not belong to your store.')
  if (row.status === 'escalated') {
    throw conflict('Mirwal is deciding this one. Add your evidence and we will come back to you.', 'RETURN_ESCALATED')
  }

  const allowed = SELLER_TRANSITIONS[row.status] ?? []
  if (!allowed.includes(status)) {
    throw conflict(
      `A return that is ${String(row.status).replace(/_/g, ' ')} cannot be moved to ${String(status).replace(/_/g, ' ')}.`,
      'INVALID_RETURN_TRANSITION',
    )
  }
  if (status === 'rejected' && (!note || note.trim().length < 5)) {
    throw badRequest('Tell the buyer why. They can ask Mirwal to look at it, and this is what we read.', 'REASON_REQUIRED')
  }
  if (status === 'more_info_required' && (!note || note.trim().length < 5)) {
    throw badRequest('Say what you need from the buyer.', 'REASON_REQUIRED')
  }

  const settlement = status === 'refunded' || status === 'replaced'
  const amount = settlement && status === 'refunded'
    ? resolveRefundAmount(refundAmount, row.line_total)
    : null

  let refundId = null
  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE return_requests
          SET status = ?, resolution_note = ?,
              refund_amount = COALESCE(?, refund_amount),
              return_shipping_paid_by = COALESCE(?, return_shipping_paid_by),
              received_at = CASE WHEN ? = 'received' THEN ? ELSE received_at END,
              resolved_at = CASE WHEN ? IN ('refunded','replaced','rejected') THEN ? ELSE resolved_at END
        WHERE id = ?`,
      [
        status, note ?? row.resolution_note ?? '', amount, returnShippingPaidBy ?? null,
        status, toSqlDateTime(), status, toSqlDateTime(), row.id,
      ],
    )

    // Stock and the order item only move when the goods are actually settled. An "approved"
    // return whose parcel never arrives must not have restocked anything.
    if (settlement) {
      await connection.execute(
        'UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?',
        ['returned', toSqlDateTime(), row.order_item_id],
      )
      await connection.execute(
        'UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ?',
        [row.quantity, row.variant_id],
      )
    }
    if (status === 'refunded') {
      refundId = await createRefundForReturn(connection, {
        returnRequestId: row.id,
        orderId: row.order_id,
        amount,
      })
    }

    await recordOrderEvent(connection, {
      orderId: row.order_id,
      orderItemId: row.order_item_id,
      eventType: `return.${status}`,
      fromStatus: row.status,
      toStatus: status,
      actorSide: 'seller',
      actorUserId: sellerUserId,
      note,
      metadata: amount ? { refundAmount: amount } : null,
    })
  })

  // Outside the transaction on purpose: a gateway call must not hold one open, and a failure
  // here leaves a retryable refund rather than undoing a decision the seller already saw.
  if (refundId) await processRefund(refundId)

  await notifyBuyer(row, status, { note, amount })
  return reload(row.id, { audience: 'seller' })
}

/** A partial refund is allowed; more than the line total is not. */
function resolveRefundAmount(requested, lineTotal) {
  const ceiling = Number(lineTotal)
  if (requested == null || requested === '') return ceiling.toFixed(2)
  const amount = Number(requested)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('Enter the amount to refund.', 'INVALID_AMOUNT')
  }
  if (amount > ceiling + 0.001) {
    throw badRequest(`A refund cannot exceed what was paid for the item (${ceiling.toFixed(2)}).`, 'AMOUNT_TOO_HIGH')
  }
  return amount.toFixed(2)
}

async function notifyBuyer(row, status, { note, amount }) {
  // Each outcome gets its own type and its own title, because "your return was updated" tells
  // a buyer nothing they can act on. The seller's own words are appended wherever they wrote
  // any — dropping them would mean a seller writes an explanation the buyer never sees.
  const messages = {
    more_info_required: ['The seller needs more information', ''],
    approved: ['Your return was approved', 'Post the item back and add the tracking number.'],
    received: ['The seller has your return', 'Your refund follows once it has been checked.'],
    refunded: ['Your refund is on its way', amount ? `${formatMoney(amount, row.currency_code).display} refunded.` : ''],
    replaced: ['A replacement is on its way', ''],
    rejected: ['Your return was declined', ''],
  }
  const [title, standard] = messages[status] ?? []
  if (!title) return
  const body = [standard, note].filter(Boolean).join(' ')
  await createNotification(row.buyer_user_id, {
    type: `return_${status}`,
    title: `${title} — ${row.product_name}`,
    body,
    link: '/account/returns',
  })
}

// ---------------------------------------------------------------------------
// Mirwal
// ---------------------------------------------------------------------------

/** The dispute queue. Oldest escalation first — a queue sorted any other way starves it. */
export async function listEscalated({ page = 1, pageSize = 25, status = 'escalated' } = {}) {
  const rows = await query(
    `${SELECT_RETURN} WHERE r.status = ? ORDER BY r.escalated_at ASC, r.created_at ASC LIMIT ? OFFSET ?`,
    [status, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM return_requests WHERE status = ?', [status])
  return { items: rows.map((row) => shape(row, { audience: 'admin' })), total: Number(total) }
}

export async function getForAdmin(publicId) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  return {
    ...shape(row, { audience: 'admin' }),
    evidence: await listEvidence(row.id),
    // Staff see the internal notes; nobody else does.
    messages: await listMessages(row.id, { includeInternal: true }),
    timeline: await timeline(row.id),
  }
}

/**
 * Mirwal's decision, which overrides the seller's.
 *
 * Three outcomes, and each maps to something concrete rather than to a sentiment:
 *
 *   `upheld_buyer`  — the return stands. Refund in full, restock, item returned.
 *   `partial`       — refund part of the line, usually where the item is usable but not as sold.
 *   `upheld_seller` — the rejection stands. Nothing moves, and the buyer is told why.
 *
 * Note the asymmetry that cannot be designed away: overturning a rejection creates the refund
 * the rejection did not, but overturning an approval cannot un-send money that has already
 * gone. `refunds.return_request_id` is unique, so the second case leaves the existing refund
 * alone and the decision is recorded as a judgement rather than pretending to reverse it.
 */
export async function decide(publicId, { outcome, note, refundAmount }, adminUserId) {
  const row = await queryOne(`${SELECT_RETURN} WHERE r.public_id = ?`, [publicId])
  if (!row) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')
  if (!row.escalated_at) throw conflict('This return has not been escalated to Mirwal.', 'NOT_ESCALATED')
  if (row.admin_decision) throw conflict('Mirwal has already decided this one.', 'ALREADY_DECIDED')

  const refunds = outcome === 'upheld_buyer' || outcome === 'partial'
  const amount = refunds
    ? resolveRefundAmount(outcome === 'partial' ? refundAmount : row.line_total, row.line_total)
    : null
  if (outcome === 'partial' && (refundAmount == null || refundAmount === '')) {
    throw badRequest('A partial decision needs the amount to refund.', 'AMOUNT_REQUIRED')
  }

  const finalStatus = refunds ? 'refunded' : 'rejected'
  let refundId = null

  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE return_requests
          SET status = ?, admin_decision = ?, admin_decision_by = ?, admin_decision_at = ?,
              admin_decision_note = ?, refund_amount = COALESCE(?, refund_amount), resolved_at = ?
        WHERE id = ?`,
      [finalStatus, outcome, adminUserId, toSqlDateTime(), note ?? null, amount, toSqlDateTime(), row.id],
    )

    if (refunds) {
      await connection.execute(
        'UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?',
        ['returned', toSqlDateTime(), row.order_item_id],
      )
      // Only restock what was not already restocked by a settlement earlier in the life of
      // this return; `item_status` tells us whether that happened.
      if (row.item_status !== 'returned') {
        await connection.execute(
          'UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ?',
          [row.quantity, row.variant_id],
        )
      }
      refundId = await createRefundForReturn(connection, {
        returnRequestId: row.id,
        orderId: row.order_id,
        amount,
      })
    }

    await recordOrderEvent(connection, {
      orderId: row.order_id,
      orderItemId: row.order_item_id,
      eventType: 'return.adjudicated',
      fromStatus: 'escalated',
      toStatus: finalStatus,
      actorSide: 'admin',
      actorUserId: adminUserId,
      note,
      metadata: { outcome, refundAmount: amount },
    })
  })

  if (refundId) await processRefund(refundId)

  const outcomeText = {
    upheld_buyer: 'Mirwal decided in your favour. Your refund is on its way.',
    partial: `Mirwal decided on a partial refund of ${formatMoney(amount, row.currency_code).display}.`,
    upheld_seller: 'Mirwal reviewed this and let the seller’s decision stand.',
  }[outcome]

  await createNotification(row.buyer_user_id, {
    type: 'return_adjudicated',
    title: `Decision on your return — ${row.product_name}`,
    body: `${outcomeText}${note ? ` ${note}` : ''}`,
    link: '/account/returns',
  })
  await createNotification(row.seller_user_id, {
    type: 'return_adjudicated',
    title: `Mirwal decided a disputed return — ${row.product_name}`,
    // The seller is told the outcome and the reason, because an adjudication they cannot
    // learn from is one they will lose again next week.
    body: `${String(outcome).replace(/_/g, ' ')}${note ? `: ${note}` : ''}`,
    link: '/orders/returns',
  })

  return reload(row.id, { audience: 'admin' })
}

// ---------------------------------------------------------------------------
// Evidence and history
// ---------------------------------------------------------------------------

/**
 * Say something on a return.
 *
 * Both sides may, and so may Mirwal. `is_internal` keeps staff notes away from the parties —
 * a note written for a colleague that reaches the seller by accident is the expensive mistake,
 * so it is the default nowhere and an explicit choice everywhere.
 */
/**
 * Say something on a return.
 *
 * Takes the public id and works out for itself whether the caller is a party to it, rather
 * than trusting a caller-supplied internal id. That is the codebase's convention everywhere
 * else, and it is what stops a second endpoint written later from becoming the hole.
 *
 * `isInternal` is staff-only and ignored for everyone else — a buyer cannot post a message the
 * seller is not allowed to read, and a seller cannot post one the buyer cannot see.
 */
export async function postMessage(publicId, { userId, sellerId = null, isAdmin = false, body, isInternal = false }) {
  const row = await queryOne(
    'SELECT id, buyer_id, seller_id FROM return_requests WHERE public_id = ?',
    [publicId],
  )
  if (!row) throw notFound('Return request not found.', 'RETURN_NOT_FOUND')

  const side = isAdmin ? 'admin' : sellerId != null && row.seller_id === sellerId ? 'seller' : 'buyer'
  if (!isAdmin && side === 'buyer' && row.buyer_id !== userId) {
    throw forbidden('This return request is not yours.')
  }
  if (!isAdmin && side === 'seller' && row.seller_id !== sellerId) {
    throw forbidden('This return request does not belong to your store.')
  }

  const messageId = randomUUID()
  await query(
    `INSERT INTO return_messages (public_id, return_request_id, author_id, author_side, is_internal, body)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [messageId, row.id, userId ?? null, side, isAdmin && isInternal ? 1 : 0, String(body).slice(0, 4000)],
  )
  return { id: messageId, side }
}

/**
 * The thread.
 *
 * Internal notes are filtered here rather than at the caller, so a new endpoint cannot leak
 * them by forgetting to pass the flag — the safe reading is the default one.
 */
export async function listMessages(returnRequestId, { includeInternal = false } = {}) {
  const rows = await query(
    `SELECT m.public_id, m.author_side, m.is_internal, m.body, m.created_at, u.full_name AS author
       FROM return_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.return_request_id = ?${includeInternal ? '' : ' AND m.is_internal = 0'}
      ORDER BY m.created_at ASC, m.id ASC`,
    [returnRequestId],
  )
  return rows.map((row) => ({
    id: row.public_id,
    side: row.author_side,
    author: row.author ?? null,
    body: row.body,
    isInternal: Boolean(row.is_internal),
    at: row.created_at,
  }))
}

/**
 * Photographs attached to a return.
 *
 * Files only — `return_evidence` is a file table and stays one. They go through the same
 * hardened store as seller documents: generated names, kept outside any web root, and read
 * only through an authenticated endpoint, because a photograph of someone's living room is
 * not public.
 */
export async function listEvidence(returnRequestId) {
  const rows = await query(
    `SELECT e.public_id, e.uploader_side, e.original_name, e.mime_type, e.size_bytes,
            e.caption, e.uploaded_at, u.full_name AS author
       FROM return_evidence e
       LEFT JOIN users u ON u.id = e.uploaded_by
      WHERE e.return_request_id = ? AND e.deleted_at IS NULL
      ORDER BY e.uploaded_at ASC`,
    [returnRequestId],
  )
  return rows.map((row) => ({
    id: row.public_id,
    side: row.uploader_side,
    author: row.author ?? null,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    caption: row.caption,
    at: row.uploaded_at,
  }))
}

/** What happened, in order. Drawn from `order_events` so it agrees with the order timeline. */
async function timeline(returnRequestId) {
  const request = await queryOne('SELECT order_item_id FROM return_requests WHERE id = ?', [returnRequestId])
  const rows = await query(
    `SELECT event_type, from_status, to_status, actor_side, note, created_at
       FROM order_events
      WHERE order_item_id = ? AND event_type LIKE 'return.%'
      ORDER BY created_at ASC, id ASC`,
    [request.order_item_id],
  )
  return rows.map((row) => ({
    type: row.event_type.replace('return.', ''),
    from: row.from_status,
    to: row.to_status,
    side: row.actor_side,
    note: row.note,
    at: row.created_at,
  }))
}

/** Exported for the buyer-side guard in orders.service.js. */
export const isOpen = (status) => OPEN_STATUSES.has(status)
