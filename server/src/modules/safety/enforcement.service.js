import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { createNotification } from '../notifications/notifications.service.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * What Mirwal actually does about a problem.
 *
 * This is the half that was missing entirely: `product_reports` could be marked "upheld" and
 * nothing happened — the listing stayed up, the seller was never told, and no record existed
 * that they had done anything wrong. So nothing stopped them doing it again, and no score
 * could be computed from a history that was not kept.
 *
 * Four principles, each of which exists because the opposite fails badly:
 *
 *   1. **Every action is recorded, notified and appealable.** An enforcement action the seller
 *      is not told about is indistinguishable from a bug, and it makes an appeal impossible
 *      because they do not know there is anything to appeal.
 *
 *   2. **Restrict before suspend.** A restricted store can still fulfil the orders it already
 *      owes buyers; a suspended one cannot. Reaching for suspension first makes the buyers pay
 *      for the seller's misconduct.
 *
 *   3. **Temporary means temporary.** An action with an expiry lifts itself. A restriction
 *      nobody diarised quietly becomes permanent, which is how a marketplace ends up with
 *      sellers frozen for years over a resolved dispute.
 *
 *   4. **An appeal is decided by someone else.** The original decider cannot review their own
 *      decision, and the schema records both so that is checkable rather than merely intended.
 */

/** Reason codes, so "why do we suspend sellers" is answerable without reading prose. */
export const ENFORCEMENT_REASONS = {
  counterfeit: 'Selling counterfeit or unauthorised branded goods',
  prohibited_goods: 'Listing goods that cannot be sold on Mirwal',
  misleading_listing: 'Misleading title, images or specifications',
  non_delivery: 'Repeatedly failing to deliver paid orders',
  late_dispatch: 'Persistently missing the dispatch promise',
  high_cancellation: 'Cancelling an unacceptable share of orders',
  review_manipulation: 'Manipulating reviews or ratings',
  off_platform: 'Directing buyers off Mirwal to avoid protections',
  abusive_conduct: 'Abusive conduct toward buyers or staff',
  identity_fraud: 'False or fraudulent identity information',
  payment_fraud: 'Fraudulent payment or payout activity',
  policy_other: 'Other policy breach — see the note',
}

/** Which actions change the store's own status, and to what. */
const STATUS_EFFECT = {
  store_restricted: 'restricted',
  store_suspended: 'suspended',
  store_banned: 'banned',
  reinstated: 'approved',
}

/**
 * Take an action.
 *
 * The store status, the enforcement record and any listing changes happen in one transaction:
 * a suspension whose listings stay live, or a record with no effect, are both worse than
 * either half alone.
 */
export async function act(sellerPublicId, {
  actionType, reasonCode, note, severity = 'medium', expiresAt = null, caseId = null,
  subjectType = null, subjectId = null,
}, actorUserId) {
  // `caseId` arrives as a public id; the column is the internal one. An unknown reference is
  // treated as "no case" rather than an error: the enforcement action is the important part
  // and refusing it over a bad link would be the wrong trade.
  const linkedCase = caseId
    ? await queryOne('SELECT id FROM cases WHERE public_id = ?', [caseId])
    : null

  if (!ENFORCEMENT_REASONS[reasonCode]) {
    throw badRequest('Choose a reason for this action.', 'REASON_CODE_REQUIRED', [
      { field: 'reasonCode', message: `One of: ${Object.keys(ENFORCEMENT_REASONS).join(', ')}` },
    ])
  }
  if (reasonCode === 'policy_other' && !note) {
    throw badRequest('A note is required when the reason is "other".', 'NOTE_REQUIRED')
  }

  const seller = await queryOne(
    'SELECT id, user_id, public_id, store_name, status FROM sellers WHERE public_id = ? AND deleted_at IS NULL',
    [sellerPublicId],
  )
  if (!seller) throw notFound('Seller not found.')

  if (actionType === 'reinstated' && !['restricted', 'suspended'].includes(seller.status)) {
    throw conflict(`${seller.store_name} is ${seller.status} and has nothing to reinstate.`, 'NOTHING_TO_LIFT')
  }
  if (seller.status === 'banned' && actionType !== 'reinstated') {
    throw conflict('This store is already banned.', 'ALREADY_BANNED')
  }

  const publicId = randomUUID()
  const newStatus = STATUS_EFFECT[actionType]

  const result = await withTransaction(async (connection) => {
    const [inserted] = await connection.execute(
      `INSERT INTO seller_enforcement_actions
         (public_id, seller_id, case_id, action_type, severity, reason_code, reason_note,
          subject_type, subject_id, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId, seller.id, linkedCase?.id ?? null, actionType, severity, reasonCode, note ?? null,
        subjectType, subjectId, expiresAt, actorUserId,
      ],
    )

    if (newStatus) {
      await connection.execute(
        `UPDATE sellers
            SET status = ?,
                restricted_until  = CASE WHEN ? = 'restricted' THEN ? ELSE NULL END,
                restricted_reason = CASE WHEN ? = 'restricted' THEN ? ELSE NULL END,
                suspended_reason  = CASE WHEN ? = 'suspended' THEN ? ELSE NULL END,
                banned_at         = CASE WHEN ? = 'banned' THEN NOW(3) ELSE banned_at END,
                banned_reason     = CASE WHEN ? = 'banned' THEN ? ELSE banned_reason END,
                updated_at = NOW(3)
          WHERE id = ?`,
        [
          newStatus,
          newStatus, expiresAt,
          newStatus, note ?? ENFORCEMENT_REASONS[reasonCode],
          newStatus, note ?? ENFORCEMENT_REASONS[reasonCode],
          newStatus,
          newStatus, note ?? ENFORCEMENT_REASONS[reasonCode],
          seller.id,
        ],
      )
    }

    /**
     * Suspension and a ban pull the listings; a restriction does not.
     *
     * That distinction is the whole point of having both: a restricted seller keeps selling
     * what is already listed while they fix whatever is wrong, and only loses the ability to
     * add more. Archiving is reversible, so reinstating restores exactly what was pulled.
     */
    let productsAffected = 0
    if (actionType === 'store_suspended' || actionType === 'store_banned') {
      const [update] = await connection.execute(
        `UPDATE products SET status = 'archived', updated_at = NOW(3)
          WHERE seller_id = ? AND status = 'active' AND deleted_at IS NULL`,
        [seller.id],
      )
      productsAffected = update.affectedRows
    }
    if (actionType === 'reinstated') {
      const [update] = await connection.execute(
        `UPDATE products SET status = 'active', updated_at = NOW(3)
          WHERE seller_id = ? AND status = 'archived' AND deleted_at IS NULL`,
        [seller.id],
      )
      productsAffected = update.affectedRows

      // Close out whatever is still in force, so the seller's record shows the restriction
      // ended rather than leaving an open action against a store that is trading normally.
      await connection.execute(
        `UPDATE seller_enforcement_actions
            SET lifted_at = NOW(3), lifted_by = ?, lifted_reason = ?
          WHERE seller_id = ? AND lifted_at IS NULL
            AND action_type IN ('store_restricted','store_suspended','listing_restricted','payout_held')`,
        [actorUserId, note ?? 'Reinstated', seller.id],
      )
    }

    // Holding the money is its own action and does not touch the store's ability to trade.
    if (actionType === 'payout_held') {
      await connection.execute(
        'UPDATE sellers SET payout_hold = 1, payout_hold_reason = ?, updated_at = NOW(3) WHERE id = ?',
        [note ?? ENFORCEMENT_REASONS[reasonCode], seller.id],
      )
    }

    return { id: inserted.insertId, productsAffected }
  })

  await notifySeller(seller, { actionType, reasonCode, note, expiresAt })

  return {
    id: publicId,
    storeName: seller.store_name,
    previousStatus: seller.status,
    status: newStatus ?? seller.status,
    productsAffected: result.productsAffected,
  }
}

async function notifySeller(seller, { actionType, reasonCode, note, expiresAt }) {
  const label = {
    warning: 'A warning has been recorded on your store',
    product_removed: 'A listing was removed',
    listing_restricted: 'You cannot add new listings at the moment',
    payout_held: 'Your payouts are on hold',
    store_restricted: 'Your store has been restricted',
    store_suspended: 'Your store has been suspended',
    store_banned: 'Your store has been permanently closed',
    review_removed: 'A review was removed',
    penalty: 'A penalty has been applied to your account',
    reinstated: 'Your store has been reinstated',
  }[actionType] ?? 'Action taken on your store'

  const reason = note || ENFORCEMENT_REASONS[reasonCode] || ''
  const until = expiresAt ? ` This applies until ${new Date(expiresAt).toDateString()}.` : ''

  await createNotification(seller.user_id, {
    type: 'enforcement_action',
    title: label,
    body: `${reason}${until}`.slice(0, 480),
    link: '/compliance',
  })

  const owner = await queryOne('SELECT email, full_name FROM users WHERE id = ?', [seller.user_id])
  messaging.sendInBackground('seller.enforcement_action', {
    to: owner?.email,
    userId: seller.user_id,
    variables: {
      sellerName: owner?.full_name ?? '',
      storeName: seller.store_name,
      action: label,
      reason: `${reason}${until}`,
      // Every action is appealable, and saying so in the message is what makes that real
      // rather than a policy nobody can find.
      appealNote: actionType === 'reinstated'
        ? ''
        : 'If you believe this is wrong, you can appeal from the Compliance page in your seller panel.',
    },
  })
}

/** What is currently in force against a store — the seller's own view, and the risk score's. */
export async function activeActions(sellerId) {
  const rows = await query(
    `SELECT public_id, action_type, severity, reason_code, reason_note, expires_at,
            appeal_status, created_at
       FROM seller_enforcement_actions
      WHERE seller_id = ?
        AND lifted_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW(3))
      ORDER BY created_at DESC`,
    [sellerId],
  )
  return rows.map(shapeAction)
}

/** The full record, including what has been lifted. Shown on the seller's compliance page. */
export async function history(sellerId, { page = 1, pageSize = 50 } = {}) {
  const rows = await query(
    `SELECT a.public_id, a.action_type, a.severity, a.reason_code, a.reason_note,
            a.expires_at, a.lifted_at, a.lifted_reason, a.appeal_status, a.appeal_note,
            a.appeal_decided_at, a.created_at, c.reference AS case_reference
       FROM seller_enforcement_actions a
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE a.seller_id = ?
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [sellerId, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    'SELECT COUNT(*) AS total FROM seller_enforcement_actions WHERE seller_id = ?',
    [sellerId],
  )
  return { items: rows.map(shapeAction), total: Number(total) }
}

function shapeAction(row) {
  return {
    id: row.public_id,
    type: row.action_type,
    severity: row.severity,
    reasonCode: row.reason_code,
    reason: row.reason_note || ENFORCEMENT_REASONS[row.reason_code] || null,
    caseReference: row.case_reference ?? null,
    expiresAt: row.expires_at,
    liftedAt: row.lifted_at,
    liftedReason: row.lifted_reason ?? null,
    active: !row.lifted_at && (!row.expires_at || new Date(`${row.expires_at}Z`) > new Date()),
    appeal: {
      status: row.appeal_status,
      note: row.appeal_note ?? null,
      decidedAt: row.appeal_decided_at ?? null,
      // An appeal can be lodged once, while the action is still in force.
      canAppeal: row.appeal_status === 'none' && !row.lifted_at,
    },
    at: row.created_at,
  }
}

/** A seller contesting an action. */
export async function appeal(sellerId, publicId, { note }) {
  const row = await queryOne(
    'SELECT id, seller_id, appeal_status, lifted_at FROM seller_enforcement_actions WHERE public_id = ?',
    [publicId],
  )
  if (!row || row.seller_id !== sellerId) throw notFound('Action not found.')
  if (row.appeal_status !== 'none') {
    throw conflict('You have already appealed this. We will come back to you.', 'ALREADY_APPEALED')
  }
  if (row.lifted_at) {
    throw conflict('This action has already been lifted.', 'ALREADY_LIFTED')
  }
  if (!note || String(note).trim().length < 20) {
    throw badRequest('Tell us why you think this is wrong, in a sentence or two.', 'NOTE_REQUIRED')
  }

  await query(
    "UPDATE seller_enforcement_actions SET appeal_status = 'requested', appeal_note = ?, appeal_at = NOW(3) WHERE id = ?",
    [note, row.id],
  )
  return { status: 'requested' }
}

/**
 * Decide an appeal.
 *
 * Refused if the person deciding is the one who took the action. That is the entire value of
 * an appeals process — a second look by someone who has not already made up their mind — and
 * enforcing it here rather than by convention is what makes it true.
 */
export async function decideAppeal(publicId, { upheld, note }, actorUserId) {
  const row = await queryOne(
    `SELECT a.id, a.seller_id, a.appeal_status, a.action_type, a.created_by,
            s.user_id, s.store_name, s.public_id AS seller_public_id
       FROM seller_enforcement_actions a JOIN sellers s ON s.id = a.seller_id
      WHERE a.public_id = ?`,
    [publicId],
  )
  if (!row) throw notFound('Action not found.')
  if (!['requested', 'under_review'].includes(row.appeal_status)) {
    throw conflict('There is no open appeal on this action.', 'NO_OPEN_APPEAL')
  }
  if (row.created_by && String(row.created_by) === String(actorUserId)) {
    throw forbidden(
      'An appeal has to be decided by someone other than the person who took the action.',
      'APPEAL_SELF_REVIEW',
    )
  }

  // "Upheld" means the original action stands. "Overturned" means it is lifted.
  const status = upheld ? 'upheld' : 'overturned'

  await query(
    `UPDATE seller_enforcement_actions
        SET appeal_status = ?, appeal_decided_by = ?, appeal_decided_at = NOW(3),
            lifted_at = CASE WHEN ? = 'overturned' THEN NOW(3) ELSE lifted_at END,
            lifted_by = CASE WHEN ? = 'overturned' THEN ? ELSE lifted_by END,
            lifted_reason = CASE WHEN ? = 'overturned' THEN ? ELSE lifted_reason END
      WHERE id = ?`,
    [status, actorUserId, status, status, actorUserId, status, note ?? 'Appeal upheld', row.id],
  )

  // Overturning a store-level action puts the store back, listings included.
  if (!upheld && ['store_restricted', 'store_suspended'].includes(row.action_type)) {
    await act(row.seller_public_id, {
      actionType: 'reinstated',
      reasonCode: 'policy_other',
      note: note ?? 'Appeal successful.',
    }, actorUserId)
  }

  await createNotification(row.user_id, {
    type: 'appeal_decided',
    title: upheld ? 'Your appeal was not successful' : 'Your appeal was successful',
    body: note
      ? String(note).slice(0, 400)
      : upheld
        ? 'We reviewed the action and it stands.'
        : 'We reviewed the action and have lifted it.',
    link: '/compliance',
  })

  return { status, storeName: row.store_name }
}

/**
 * Lift actions whose time is up.
 *
 * Run from the maintenance sweep. Without it "temporary" is only true if a human remembers,
 * and a 7-day restriction silently becomes permanent.
 */
export async function expireActions() {
  const due = await query(
    `SELECT a.public_id, a.seller_id, a.action_type, s.public_id AS seller_public_id, s.status
       FROM seller_enforcement_actions a JOIN sellers s ON s.id = a.seller_id
      WHERE a.lifted_at IS NULL AND a.expires_at IS NOT NULL AND a.expires_at <= NOW(3)`,
  )

  let lifted = 0
  for (const row of due) {
    await query(
      "UPDATE seller_enforcement_actions SET lifted_at = NOW(3), lifted_reason = 'Expired' WHERE public_id = ?",
      [row.public_id],
    )
    // Only restore a store that is still in the state this action put it in — a seller who has
    // since been suspended for something else must not be reinstated by an unrelated expiry.
    if (row.action_type === 'store_restricted' && row.status === 'restricted') {
      await query(
        `UPDATE sellers SET status = 'approved', restricted_until = NULL, restricted_reason = NULL,
                            updated_at = NOW(3) WHERE id = ?`,
        [row.seller_id],
      )
    }
    if (row.action_type === 'payout_held') {
      await query(
        'UPDATE sellers SET payout_hold = 0, payout_hold_reason = NULL, updated_at = NOW(3) WHERE id = ?',
        [row.seller_id],
      )
    }
    lifted += 1
  }
  return { lifted }
}
