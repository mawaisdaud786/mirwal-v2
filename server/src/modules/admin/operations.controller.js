import { ok, okPage } from '../../lib/errors.js'
import * as ops from './operations.service.js'
import { AUDIT, recordAudit } from './audit.service.js'
import { getWorkQueue } from './workqueue.service.js'

/**
 * Admin operations endpoints.
 *
 * Reads are plain; every write is audited, because these are the actions with the widest
 * blast radius in the panel — suspending an account, ending someone's session, upholding a
 * report against a listing.
 */

export async function listStaff(req, res, next) {
  try { return ok(res, await ops.listStaff()) }
  catch (error) { return next(error) }
}

// --- Sessions ---------------------------------------------------------------

export async function listSessions(req, res, next) {
  try {
    const { page, pageSize, staffOnly } = req.validatedQuery
    const { items, total } = await ops.listSessions({ page, pageSize, staffOnly })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function revokeSession(req, res, next) {
  try {
    await ops.revokeSession(req.params.id)
    await recordAudit(req, { action: AUDIT.SESSION_REVOKED, entityType: 'session', entityId: req.params.id })
    return ok(res, null, 'Session ended.')
  } catch (error) { return next(error) }
}

export async function revokeAllSessions(req, res, next) {
  try {
    const result = await ops.revokeAllSessionsFor(req.params.id)
    await recordAudit(req, {
      action: AUDIT.SESSION_REVOKED, entityType: 'user', entityId: req.params.id,
      metadata: { name: result.name, revoked: result.revoked },
    })
    return ok(res, result, `Signed ${result.name} out of ${result.revoked} session${result.revoked === 1 ? '' : 's'}.`)
  } catch (error) { return next(error) }
}

// --- Accounts ---------------------------------------------------------------

export async function listAccounts(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await ops.listAccounts({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function setAccountStatus(req, res, next) {
  try {
    const result = await ops.setAccountStatus(req.params.id, req.body.status, req.user.id)
    await recordAudit(req, {
      action: req.body.status === 'active' ? AUDIT.ACCOUNT_RESTORED : AUDIT.ACCOUNT_SUSPENDED,
      entityType: 'user', entityId: req.params.id,
      metadata: { name: result.name, from: result.previousStatus, to: result.status, sessionsRevoked: result.sessionsRevoked },
    })
    return ok(
      res,
      result,
      result.status === 'active'
        ? `${result.name} restored.`
        : `${result.name} suspended and signed out of ${result.sessionsRevoked} session${result.sessionsRevoked === 1 ? '' : 's'}.`,
    )
  } catch (error) { return next(error) }
}

// --- Notifications, performance ---------------------------------------------

export async function listNotifications(req, res, next) {
  try {
    const { page, pageSize } = req.validatedQuery
    const result = await ops.listNotifications({ page, pageSize })
    return ok(res, result)
  } catch (error) { return next(error) }
}

export async function sellerPerformance(req, res, next) {
  try { return ok(res, await ops.getSellerPerformance()) }
  catch (error) { return next(error) }
}

// --- Product reports --------------------------------------------------------

export async function listProductReports(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    return ok(res, await ops.listProductReports({ page, pageSize, status }))
  } catch (error) { return next(error) }
}

export async function resolveProductReport(req, res, next) {
  try {
    const result = await ops.resolveProductReport(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.REPORT_RESOLVED, entityType: 'product_report', entityId: req.params.id,
      metadata: { from: result.previousStatus, to: result.status, resolution: req.body.resolution },
    })
    return ok(res, result, `Report marked ${result.status}.`)
  } catch (error) { return next(error) }
}

/** Storefront: a shopper reporting a listing. */
export async function createProductReport(req, res, next) {
  try {
    const result = await ops.createProductReport({
      productSlug: req.params.slug,
      reporterId: req.user?.id ?? null,
      reason: req.body.reason,
      details: req.body.details,
    })
    return ok(res, result, 'Thank you — Mirwal will review this listing.', 201)
  } catch (error) { return next(error) }
}

// --- System logs ------------------------------------------------------------

export async function listSystemLogs(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    return ok(res, await ops.listSystemLogs({ page, pageSize, ...filters }))
  } catch (error) { return next(error) }
}

// --- Teams ------------------------------------------------------------------

export async function listTeams(req, res, next) {
  try { return ok(res, await ops.listTeams()) }
  catch (error) { return next(error) }
}

export async function createTeam(req, res, next) {
  try {
    const result = await ops.createTeam(req.body)
    await recordAudit(req, { action: AUDIT.TEAM_CREATED, entityType: 'team', entityId: result.slug, metadata: { name: req.body.name } })
    return ok(res, result, 'Team created.', 201)
  } catch (error) { return next(error) }
}

export async function deleteTeam(req, res, next) {
  try {
    const result = await ops.deleteTeam(req.params.slug)
    await recordAudit(req, { action: AUDIT.TEAM_DELETED, entityType: 'team', entityId: req.params.slug, metadata: { name: result.name } })
    return ok(res, null, 'Team deleted.')
  } catch (error) { return next(error) }
}

export async function setTeamMembership(req, res, next) {
  try {
    const result = await ops.setTeamMembership(req.params.slug, req.body.userId, req.body.isMember)
    await recordAudit(req, {
      action: AUDIT.TEAM_MEMBERSHIP_CHANGED, entityType: 'team', entityId: req.params.slug,
      metadata: { name: result.name, isMember: result.isMember },
    })
    return ok(res, result, result.isMember ? `${result.name} added to ${result.team}.` : `${result.name} removed from ${result.team}.`)
  } catch (error) { return next(error) }
}

// --- Attributes -------------------------------------------------------------

export async function listAttributes(req, res, next) {
  try { return ok(res, await ops.listAttributes()) }
  catch (error) { return next(error) }
}

export async function createAttribute(req, res, next) {
  try {
    const result = await ops.createAttribute(req.body)
    await recordAudit(req, { action: AUDIT.ATTRIBUTE_CREATED, entityType: 'attribute', entityId: result.slug, metadata: { name: req.body.name } })
    return ok(res, result, 'Attribute created.', 201)
  } catch (error) { return next(error) }
}

export async function deleteAttribute(req, res, next) {
  try {
    const result = await ops.deleteAttribute(req.params.slug)
    await recordAudit(req, { action: AUDIT.ATTRIBUTE_DELETED, entityType: 'attribute', entityId: req.params.slug, metadata: { name: result.name } })
    return ok(res, null, 'Attribute deleted.')
  } catch (error) { return next(error) }
}

/**
 * The operations board.
 *
 * Scoped to what this operator can act on, using the permissions already resolved onto the
 * request — nothing here takes a role from the client.
 */
export async function workQueue(req, res, next) {
  try { return ok(res, await getWorkQueue(req.user.permissions)) }
  catch (error) { return next(error) }
}
