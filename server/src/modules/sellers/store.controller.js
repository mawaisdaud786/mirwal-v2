import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import * as media from '../media/media.service.js'
import * as bank from './bank.service.js'
import * as store from './store.service.js'

/**
 * A seller's own store, payout account and policies.
 *
 * Every handler is scoped by `req.seller.id`, which `requireSeller` resolved from the
 * authenticated user. No route here takes a seller id, so "edit another store" is not a
 * request that can be formed rather than one that is merely rejected.
 */

export const updateStoreSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  logoUrl: z.string().trim().max(500).optional().nullable(),
  bannerUrl: z.string().trim().max(500).optional().nullable(),
  supportEmail: z.string().trim().toLowerCase().email().max(255).optional().nullable(),
  supportPhone: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  addressLine1: z.string().trim().max(255).optional().nullable(),
  addressLine2: z.string().trim().max(255).optional().nullable(),
  province: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  about: z.string().trim().max(20000).optional().nullable(),
  // A weekday-keyed map of opening hours. Values are free text ("9:00 - 18:00", "Closed")
  // because a marketplace seller's hours are read by humans, never computed against.
  businessHours: z.record(z.string().max(20), z.string().max(60)).optional().nullable(),
  metaTitle: z.string().trim().max(180).optional().nullable(),
  metaDescription: z.string().trim().max(320).optional().nullable(),
}).strict()

export const kycSchema = z.object({
  // Accepted as printed on the card; normalised to bare digits in the service.
  cnic: z.string().trim().max(20).optional().nullable(),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional().nullable(),
  legalName: z.string().trim().max(200).optional().nullable(),
  ntn: z.string().trim().max(20).optional().nullable(),
  strn: z.string().trim().max(30).optional().nullable(),
  businessRegNo: z.string().trim().max(60).optional().nullable(),
  businessType: z.enum(['sole_proprietor', 'partnership', 'private_limited', 'other']).optional().nullable(),
}).strict()

export const policiesSchema = z.object({
  returnsAccepted: z.boolean().optional(),
  // Nullable means "use Mirwal's default". A shorter window than the platform minimum is
  // raised in the service rather than rejected — buyer protection is not the seller's to waive.
  returnWindowDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  returnShippingPaidBy: z.enum(['buyer', 'seller']).optional(),
  exchangeOffered: z.boolean().optional(),
  dispatchDays: z.coerce.number().int().min(0).max(60).optional().nullable(),
  warrantyText: z.string().trim().max(2000).optional().nullable(),
  returnsText: z.string().trim().max(2000).optional().nullable(),
  shippingText: z.string().trim().max(2000).optional().nullable(),
}).strict()

export const vacationSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(255).optional().nullable(),
})

export const bankAccountSchema = z.object({
  method: z.enum(['bank', 'easypaisa', 'jazzcash']),
  // Must match the CNIC name for an individual or the registered business name for a
  // business. The mismatch between the two is the most common KYC failure there is, which is
  // why the field is required rather than inferred from the account.
  accountTitle: z.string().trim().min(3, 'Enter the account title exactly as the bank has it.').max(150),
  bankName: z.string().trim().max(120).optional().nullable(),
  iban: z.string().trim().max(40).optional().nullable(),
  msisdn: z.string().trim().max(20).optional().nullable(),
})

// --- store -------------------------------------------------------------------

export async function getStore(req, res, next) {
  try { return ok(res, await store.getStore(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function updateStore(req, res, next) {
  try {
    const patch = { ...req.body }

    // An image reference must be one this seller actually uploaded. `store.service.js` already
    // refuses anything that is not a relative Mirwal path; this is the other half — a valid
    // path pointing at someone else's asset is still not theirs to use.
    if (patch.logoUrl !== undefined) patch.logoUrl = await media.assertOwnedUrl(req.seller.id, patch.logoUrl)
    if (patch.bannerUrl !== undefined) patch.bannerUrl = await media.assertOwnedUrl(req.seller.id, patch.bannerUrl)

    const result = await store.updateStore(req.seller.id, patch)
    await recordAudit(req, {
      action: AUDIT.STORE_UPDATED,
      entityType: 'seller',
      entityId: req.seller.public_id,
      metadata: { fields: Object.keys(req.body), badgeDropped: result.badgeDropped },
    })
    return ok(res, result, result.notice ?? 'Store updated.')
  } catch (error) { return next(error) }
}

export async function setVacation(req, res, next) {
  try {
    const result = await store.setVacationMode(req.seller.id, req.body)
    return ok(res, result, result.notice)
  } catch (error) { return next(error) }
}

export async function getPolicies(req, res, next) {
  try { return ok(res, await store.getPolicies(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function updatePolicies(req, res, next) {
  try {
    const result = await store.updatePolicies(req.seller.id, req.body)
    await recordAudit(req, {
      action: AUDIT.STORE_UPDATED,
      entityType: 'store_policies',
      entityId: req.seller.public_id,
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, result, result.notice ?? 'Policies saved.')
  } catch (error) { return next(error) }
}

export async function getKyc(req, res, next) {
  try { return ok(res, await store.getKyc(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function updateKyc(req, res, next) {
  try {
    const result = await store.updateKyc(req.seller.id, req.body)
    await recordAudit(req, {
      // Its own action, not a store update: a change to identity after verification is exactly
      // the event a later fraud review looks for.
      action: result.downgraded ? AUDIT.SELLER_BADGE_REVOKED : AUDIT.STORE_UPDATED,
      entityType: 'seller_kyc',
      entityId: req.seller.public_id,
      metadata: { fields: Object.keys(req.body), downgraded: result.downgraded },
    })
    return ok(res, result, result.notice ?? 'Details saved.')
  } catch (error) { return next(error) }
}

// --- payout account ----------------------------------------------------------

export async function listBankAccounts(req, res, next) {
  try { return ok(res, await bank.listAccounts(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function addBankAccount(req, res, next) {
  try {
    const result = await bank.addAccount(req.seller.id, req.body, {
      userId: req.user.id,
      storeName: req.seller.store_name,
    })
    await recordAudit(req, {
      // A change is a different event from a first-time addition, and the security review
      // that matters is the one that looks for changes.
      action: result.isChange ? AUDIT.BANK_ACCOUNT_CHANGED : AUDIT.BANK_ACCOUNT_ADDED,
      entityType: 'seller_bank_account',
      entityId: result.id,
      metadata: { method: req.body.method, sellerId: req.seller.public_id },
    })
    return ok(
      res,
      result,
      result.isChange
        ? `Payout account updated. Withdrawals are held for ${result.holdHours} hours while we verify it.`
        : 'Payout account added. Mirwal will verify it shortly.',
      201,
    )
  } catch (error) { return next(error) }
}

export async function payoutEligibility(req, res, next) {
  try { return ok(res, await bank.payoutEligibility(req.seller.id)) }
  catch (error) { return next(error) }
}

// --- media -------------------------------------------------------------------

export async function listMedia(req, res, next) {
  try {
    const { page, pageSize, purpose } = req.validatedQuery
    const { items, total } = await media.listForSeller(req.seller.id, { page, pageSize, purpose })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}
