import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import { recordPiiAccess, PII_SUBJECT } from '../admin/pii.service.js'
import * as service from './applications.service.js'

/**
 * Seller applications, from both sides.
 *
 * The one thing worth noting here rather than in the service: which reviewer may see an
 * applicant's CNIC is decided in this layer, from the permission the caller actually holds,
 * and every such read writes a PII access log entry. Keeping that decision in the controller
 * — beside the route that grants it — means the answer to "who can see identity documents"
 * is reviewable in one place rather than inferred from a flag threaded through a service.
 */

// --- applicant ---------------------------------------------------------------

export async function requirements(req, res, next) {
  try { return ok(res, await service.getApplicationRequirements(req.user.id)) }
  catch (error) { return next(error) }
}

export async function submit(req, res, next) {
  try {
    const result = await service.submitApplication(req.user.id, req.body, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? '',
    })
    return ok(res, result, 'Application submitted. Mirwal will review it shortly.', 201)
  } catch (error) { return next(error) }
}

export async function mine(req, res, next) {
  try { return ok(res, await service.getMyApplication(req.user.id)) }
  catch (error) { return next(error) }
}

export async function resubmit(req, res, next) {
  try {
    const result = await service.resubmitApplication(req.user.id, req.body)
    return ok(res, result, 'Thank you — your application is back with our team.')
  } catch (error) { return next(error) }
}

export async function withdraw(req, res, next) {
  try { return ok(res, await service.withdrawApplication(req.user.id), 'Application withdrawn.') }
  catch (error) { return next(error) }
}

// --- reviewer ----------------------------------------------------------------

export async function list(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await service.listApplications({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function counts(req, res, next) {
  try { return ok(res, await service.applicationStatusCounts()) }
  catch (error) { return next(error) }
}

/**
 * One application.
 *
 * Identity numbers are included only for a caller holding `seller.kyc.view`. A reviewer who
 * only decides applications — say, someone triaging obviously incomplete ones — has no need
 * to read a CNIC, and giving it to them anyway is the difference between "a small named group
 * can see identity documents" and "everyone with an admin login can".
 */
export async function detail(req, res, next) {
  try {
    const mayViewPii = req.user?.permissions?.includes('seller.kyc.view')
      || req.user?.roles?.includes('super_admin')

    const application = await service.getApplication(req.params.id, { includePii: Boolean(mayViewPii) })

    if (mayViewPii) {
      await recordPiiAccess(req, {
        subjectType: PII_SUBJECT.APPLICATION,
        subjectId: req.params.id,
        action: 'view',
      })
    }
    return ok(res, application)
  } catch (error) { return next(error) }
}

export async function claim(req, res, next) {
  try {
    const result = await service.claimApplication(req.params.id, req.user.id)
    await recordAudit(req, {
      action: AUDIT.APPLICATION_CLAIMED, entityType: 'seller_application', entityId: req.params.id,
    })
    return ok(res, result, 'Application claimed for review.')
  } catch (error) { return next(error) }
}

export async function requestInfo(req, res, next) {
  try {
    const result = await service.requestMoreInformation(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.APPLICATION_INFO_REQUESTED,
      entityType: 'seller_application',
      entityId: req.params.id,
      metadata: { code: req.body.code ?? null },
    })
    return ok(res, result, 'The applicant has been asked for more information.')
  } catch (error) { return next(error) }
}

export async function approve(req, res, next) {
  try {
    const result = await service.approveApplication(req.params.id, req.user.id, req.body)
    await recordAudit(req, {
      action: AUDIT.APPLICATION_APPROVED,
      entityType: 'seller_application',
      entityId: req.params.id,
      metadata: { storeName: result.storeName, sellerId: result.sellerId },
    })
    return ok(res, result, `${result.storeName} is now a Mirwal store.`)
  } catch (error) { return next(error) }
}

export async function reject(req, res, next) {
  try {
    const result = await service.rejectApplication(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.APPLICATION_REJECTED,
      entityType: 'seller_application',
      entityId: req.params.id,
      metadata: { code: req.body.code },
    })
    return ok(res, result, 'Application rejected and the applicant notified.')
  } catch (error) { return next(error) }
}
