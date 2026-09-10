import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from './audit.service.js'
import { recordPiiAccess, listPiiAccess, piiAccessSummary, PII_SUBJECT } from './pii.service.js'
import * as bank from '../sellers/bank.service.js'

/**
 * Staff-side KYC: payout-account verification and the PII access log.
 *
 * The rule this file exists to enforce: reading someone's identity or banking data is an
 * event, not a side effect. `audit_logs` recorded that a document was *approved*; it never
 * recorded that one was *looked at*, and for a CNIC or an IBAN the read is the thing that
 * matters. A reviewer who browses records they have no case for triggers no approve/reject
 * entry at all.
 *
 * So `reveal` is a separate endpoint from `list`. Queue pages return masked values and log
 * nothing; seeing a full IBAN is a deliberate act with its own route, its own permission and
 * its own log entry.
 */

export const listBankAccountsSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected', 'archived']).optional().default('pending'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})

export const reviewBankAccountSchema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().max(255).optional().nullable(),
})

export const listPiiSchema = z.object({
  actorId: z.string().trim().max(36).optional(),
  sellerId: z.string().trim().max(36).optional(),
  subjectType: z.string().trim().max(60).optional(),
  action: z.enum(['view', 'download', 'export']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(36) })

// --- payout accounts ---------------------------------------------------------

export async function listBankAccounts(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total } = await bank.listPending({ page, pageSize, status })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

/**
 * Show a full payout destination to a reviewer who is about to verify it.
 *
 * Separate from the list precisely so that reading an IBAN is individually logged rather than
 * happening for every row a reviewer happens to scroll past.
 */
export async function revealBankAccount(req, res, next) {
  try {
    const account = await bank.revealAccount(req.params.id)
    await recordPiiAccess(req, {
      subjectType: PII_SUBJECT.BANK_ACCOUNT,
      subjectId: req.params.id,
      sellerId: account.sellerDbId,
      action: 'view',
    })
    // The internal row id is used only to key the log entry; it never leaves the server.
    const { sellerDbId: _ignored, ...safe } = account
    return ok(res, safe)
  } catch (error) { return next(error) }
}

export async function reviewBankAccount(req, res, next) {
  try {
    const result = await bank.reviewAccount(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: req.body.approved ? AUDIT.BANK_ACCOUNT_VERIFIED : AUDIT.BANK_ACCOUNT_REJECTED,
      entityType: 'seller_bank_account',
      entityId: req.params.id,
      metadata: { storeName: result.storeName },
    })
    return ok(res, result, req.body.approved
      ? 'Payout account verified.'
      : 'Payout account rejected and the seller notified.')
  } catch (error) { return next(error) }
}

// --- PII access log ----------------------------------------------------------

export async function listAccess(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await listPiiAccess({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function accessSummary(req, res, next) {
  try { return ok(res, await piiAccessSummary({ days: 7 })) }
  catch (error) { return next(error) }
}
