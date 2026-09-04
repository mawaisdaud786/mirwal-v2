import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { getNumericSetting, getSetting } from '../settings/settings.service.js'
import { createNotification } from '../notifications/notifications.service.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * Where a seller's money goes.
 *
 * `payouts.destination_hint` was free text typed by staff, which meant a seller had no way to
 * tell Mirwal where to send their earnings, and a changed destination left no record, needed
 * no verification, and triggered no hold.
 *
 * That last point is the reason this is its own module rather than three columns on `sellers`.
 * Changing the payout destination is the primary account-takeover cash-out path on any
 * marketplace: an attacker who gets into a seller's account does not steal products, they
 * change the bank details and wait for the next withdrawal. So a change here is a
 * first-class, audited, notified event that automatically holds payouts for a cooling-off
 * period, and the old account is archived rather than overwritten so the change is visible
 * afterwards.
 *
 * What is deliberately NOT stored: anything beyond what a transfer actually needs. An IBAN and
 * an account title are what a bank requires; a full account number, a branch code and a copy
 * of the cheque book are not, and holding them would make this table worth stealing.
 */

// Pakistani IBANs are PK + 2 check digits + 4 bank code + 16 account = 24 characters.
const PK_IBAN = /^PK\d{2}[A-Z]{4}\d{16}$/
const MSISDN = /^(?:\+?92|0)?3\d{9}$/

const normaliseIban = (value) => String(value ?? '').toUpperCase().replace(/[\s-]/g, '')
const normaliseMsisdn = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.startsWith('92')) return `+${digits}`
  if (digits.startsWith('0')) return `+92${digits.slice(1)}`
  return `+92${digits}`
}

function shapeAccount(row, { reveal = false } = {}) {
  return {
    id: row.public_id,
    method: row.method,
    accountTitle: row.account_title,
    bankName: row.bank_name,
    // Masked by default, everywhere, for everyone — including the seller's own list view.
    // The full value is returned only from the single endpoint that exists to show it, so a
    // page that merely lists accounts cannot leak them into a screenshot or a support chat.
    iban: row.iban ? (reveal ? row.iban : maskIban(row.iban)) : null,
    msisdn: row.msisdn ? (reveal ? row.msisdn : maskMsisdn(row.msisdn)) : null,
    last4: row.last4,
    status: row.status,
    rejectionReason: row.rejection_reason,
    isDefault: Boolean(row.is_default),
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  }
}

const maskIban = (value) => `${value.slice(0, 4)}${'•'.repeat(Math.max(value.length - 8, 0))}${value.slice(-4)}`
const maskMsisdn = (value) => `${value.slice(0, 5)}${'•'.repeat(Math.max(value.length - 8, 0))}${value.slice(-3)}`

/**
 * Validate a destination and normalise it.
 *
 * Both spellings of a Pakistani mobile number (03xx and +923xx) refer to one wallet, so they
 * are normalised to one form. Two rows for one destination would let a seller quietly hold
 * "two" accounts that are the same, which defeats the point of tracking a change.
 */
function normaliseInput(input) {
  if (input.method === 'bank') {
    const iban = normaliseIban(input.iban)
    if (!PK_IBAN.test(iban)) {
      throw badRequest(
        'That does not look like a Pakistani IBAN. It should be PK, two digits, four letters, then sixteen digits.',
        'INVALID_IBAN',
        [{ field: 'iban', message: 'Check the IBAN on your bank statement.' }],
      )
    }
    if (!input.bankName) {
      throw badRequest('Select your bank.', 'BANK_REQUIRED', [{ field: 'bankName', message: 'Required.' }])
    }
    return { iban, msisdn: null, last4: iban.slice(-4), bankName: input.bankName }
  }

  const msisdn = normaliseMsisdn(input.msisdn)
  if (!MSISDN.test(String(input.msisdn ?? ''))) {
    throw badRequest(
      'Enter the mobile number registered with the wallet, e.g. 03001234567.',
      'INVALID_MSISDN',
      [{ field: 'msisdn', message: 'Check the number.' }],
    )
  }
  return { iban: null, msisdn, last4: msisdn.slice(-4), bankName: input.method === 'easypaisa' ? 'EasyPaisa' : 'JazzCash' }
}

// ---------------------------------------------------------------------------
// Seller side
// ---------------------------------------------------------------------------

export async function listAccounts(sellerId) {
  const rows = await query(
    `SELECT * FROM seller_bank_accounts
      WHERE seller_id = ? AND status <> 'archived'
      ORDER BY is_default DESC, created_at DESC`,
    [sellerId],
  )
  return rows.map((row) => shapeAccount(row))
}

/**
 * Add or replace the payout destination.
 *
 * A seller has exactly one live destination at a time. Adding a second archives the first and
 * points the new row at it via `replaced_id`, so "this seller changed their bank account three
 * days before requesting a large withdrawal" is a single query rather than an inference.
 *
 * The hold is the important part. It is applied here, automatically, rather than left to an
 * operator to notice — an attacker's whole plan depends on the window between changing the
 * details and the money moving, and a hold that requires a human to spot the change closes
 * nothing.
 */
export async function addAccount(sellerId, input, { userId, storeName } = {}) {
  const normalised = normaliseInput(input)

  const existing = await queryOne(
    `SELECT id, public_id, iban, msisdn FROM seller_bank_accounts
      WHERE seller_id = ? AND is_default = 1 AND status <> 'archived'`,
    [sellerId],
  )

  // Re-submitting the same destination is a no-op, not a "change". Treating it as one would
  // hold a seller's payouts for three days because they clicked save twice.
  if (existing
    && existing.iban === normalised.iban
    && existing.msisdn === normalised.msisdn) {
    throw conflict('That is already your payout account.', 'BANK_ACCOUNT_UNCHANGED')
  }

  const holdHours = await getNumericSetting('sellers.bank_change_hold_hours', { fallback: 72, max: 720 })
  const publicId = randomUUID()
  const isChange = Boolean(existing)

  await withTransaction(async (connection) => {
    if (existing) {
      await connection.execute(
        `UPDATE seller_bank_accounts
            SET status = 'archived', is_default = 0, updated_at = NOW(3)
          WHERE id = ?`,
        [existing.id],
      )
    }
    await connection.execute(
      `INSERT INTO seller_bank_accounts
         (public_id, seller_id, method, account_title, bank_name, iban, msisdn, last4,
          status, is_default, replaced_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)`,
      [
        publicId, sellerId, input.method, input.accountTitle, normalised.bankName,
        normalised.iban, normalised.msisdn, normalised.last4,
        existing?.id ?? null,
      ],
    )

    // Only a *change* triggers the hold. A seller adding their first account has no earnings
    // history to protect and no reason to be delayed.
    if (isChange) {
      await connection.execute(
        `UPDATE sellers
            SET payout_hold = 1,
                payout_hold_reason = ?,
                updated_at = NOW(3)
          WHERE id = ?`,
        [`Payout destination changed — held for ${holdHours}h pending verification.`, sellerId],
      )
    }
  })

  if (isChange && userId) {
    // Told to the account holder, not only shown in the panel. If this change was not made by
    // the seller, the notification is the only thing that tells them so in time.
    await createNotification(userId, {
      type: 'bank_account_changed',
      title: 'Your payout account was changed',
      body: `Payouts are held for ${holdHours} hours while we verify the new account. `
        + 'If you did not make this change, contact Mirwal support immediately.',
      link: '/finance/settings',
    })
    const owner = await queryOne('SELECT email, full_name FROM users WHERE id = ?', [userId])
    await messaging.send('security.bank_account_changed', {
      to: owner?.email,
      userId,
      variables: {
        sellerName: owner?.full_name ?? '',
        storeName: storeName ?? '',
        last4: normalised.last4,
        hours: String(holdHours),
      },
    })
  }

  return { id: publicId, status: 'pending', isChange, holdHours }
}

/**
 * Whether this seller may be paid at all.
 *
 * Called by the payout path. Returns a reason rather than a boolean, because "you cannot
 * withdraw" with no explanation is the seller-support ticket this is meant to prevent.
 */
export async function payoutEligibility(sellerId) {
  const seller = await queryOne(
    'SELECT payout_hold, payout_hold_reason, status FROM sellers WHERE id = ?',
    [sellerId],
  )
  if (!seller) throw notFound('Seller not found.')

  if (seller.status !== 'approved') {
    return { eligible: false, reason: `Your store is ${seller.status}.`, code: 'SELLER_NOT_TRADING' }
  }
  if (seller.payout_hold) {
    return {
      eligible: false,
      reason: seller.payout_hold_reason || 'Payouts are on hold pending a review.',
      code: 'PAYOUT_HELD',
    }
  }

  const requireBank = Boolean(await getSetting('sellers.require_bank_before_payout', true))
  if (!requireBank) return { eligible: true }

  const account = await queryOne(
    `SELECT status FROM seller_bank_accounts
      WHERE seller_id = ? AND is_default = 1 AND status <> 'archived'`,
    [sellerId],
  )
  if (!account) {
    return {
      eligible: false,
      reason: 'Add a payout account before requesting a withdrawal.',
      code: 'BANK_ACCOUNT_MISSING',
    }
  }
  if (account.status !== 'verified') {
    return {
      eligible: false,
      reason: account.status === 'rejected'
        ? 'Your payout account was not accepted. Please add correct details.'
        : 'Your payout account is still being verified.',
      code: 'BANK_ACCOUNT_UNVERIFIED',
    }
  }
  return { eligible: true }
}

/** The verified default account a payout should be sent to. */
export async function defaultAccountId(sellerId) {
  const row = await queryOne(
    `SELECT id FROM seller_bank_accounts
      WHERE seller_id = ? AND is_default = 1 AND status = 'verified'`,
    [sellerId],
  )
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// Reviewer side
// ---------------------------------------------------------------------------

export async function listPending({ page = 1, pageSize = 25, status = 'pending' } = {}) {
  const rows = await query(
    `SELECT b.*, s.public_id AS seller_public_id, s.store_name, s.legal_name,
            s.seller_type, s.cnic IS NOT NULL AS has_cnic
       FROM seller_bank_accounts b
       JOIN sellers s ON s.id = b.seller_id
      WHERE b.status = ?
      ORDER BY b.created_at ASC
      LIMIT ? OFFSET ?`,
    [status, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    'SELECT COUNT(*) AS total FROM seller_bank_accounts WHERE status = ?',
    [status],
  )
  return {
    items: rows.map((row) => ({
      ...shapeAccount(row),
      seller: {
        id: row.seller_public_id,
        storeName: row.store_name,
        legalName: row.legal_name,
        sellerType: row.seller_type,
      },
    })),
    total: Number(total),
  }
}

/**
 * One account with the destination revealed, for a reviewer who is about to verify it.
 *
 * Separate from the list endpoint precisely so that reading a full IBAN is a distinct,
 * individually logged act rather than a side effect of opening a queue.
 */
export async function revealAccount(publicId) {
  const row = await queryOne(
    `SELECT b.*, s.public_id AS seller_public_id, s.store_name, s.legal_name, s.seller_type,
            s.id AS seller_db_id
       FROM seller_bank_accounts b JOIN sellers s ON s.id = b.seller_id
      WHERE b.public_id = ?`,
    [publicId],
  )
  if (!row) throw notFound('Payout account not found.')
  return {
    ...shapeAccount(row, { reveal: true }),
    sellerDbId: row.seller_db_id,
    seller: {
      id: row.seller_public_id,
      storeName: row.store_name,
      legalName: row.legal_name,
      sellerType: row.seller_type,
    },
  }
}

/**
 * Verify or reject a payout destination.
 *
 * Verifying also lifts the hold that the change itself imposed — but only the hold this
 * module set. A hold placed by risk or enforcement carries its own reason and is not cleared
 * by a bank verification, because those are different decisions made by different people.
 */
export async function reviewAccount(publicId, { approved, reason }, reviewerId) {
  const row = await queryOne(
    `SELECT b.id, b.seller_id, b.status, b.last4, s.user_id, s.store_name, s.payout_hold_reason
       FROM seller_bank_accounts b JOIN sellers s ON s.id = b.seller_id
      WHERE b.public_id = ?`,
    [publicId],
  )
  if (!row) throw notFound('Payout account not found.')
  if (row.status !== 'pending') {
    throw conflict(`This account has already been ${row.status}.`, 'ALREADY_REVIEWED')
  }
  if (!approved && !reason) {
    throw badRequest('A reason is required so the seller knows what to correct.', 'REASON_REQUIRED')
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE seller_bank_accounts
          SET status = ?, rejection_reason = ?, verified_by = ?, verified_at = NOW(3), updated_at = NOW(3)
        WHERE id = ?`,
      [approved ? 'verified' : 'rejected', approved ? null : reason, reviewerId, row.id],
    )

    // Only lift a hold this module is responsible for. Matching on the reason text is crude
    // but deliberate: it means an enforcement hold is never cleared by an unrelated approval,
    // which is the failure that actually matters here.
    if (approved && String(row.payout_hold_reason ?? '').startsWith('Payout destination changed')) {
      await connection.execute(
        "UPDATE sellers SET payout_hold = 0, payout_hold_reason = NULL, updated_at = NOW(3) WHERE id = ?",
        [row.seller_id],
      )
    }
  })

  await createNotification(row.user_id, {
    type: approved ? 'bank_account_verified' : 'bank_account_rejected',
    title: approved ? 'Payout account verified' : 'Payout account not accepted',
    body: approved
      ? `Withdrawals will be sent to the account ending ${row.last4}.`
      : String(reason).slice(0, 480),
    link: '/finance/settings',
  })

  return { status: approved ? 'verified' : 'rejected', storeName: row.store_name }
}
