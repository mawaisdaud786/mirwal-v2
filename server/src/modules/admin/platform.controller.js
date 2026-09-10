import { ok, okPage } from '../../lib/errors.js'
import * as insights from './insights.service.js'
import * as platform from './platform.service.js'
import * as security from './security.service.js'
import * as fulfilment from './fulfilment.service.js'
import { AUDIT, recordAudit } from './audit.service.js'
import { invalidateMaintenanceCache } from '../../middleware/maintenance.js'
import { updateSettings } from '../settings/settings.service.js'

/**
 * Endpoints for the last group of admin pages: analytics, maintenance, backups, security and
 * the returns/refunds queues.
 *
 * Reads are plain. Every write here is audited — closing the storefront, taking a copy of the
 * database and settling a refund are all actions someone will eventually need explained.
 */

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const analytics = (fn) => async (req, res, next) => {
  try { return ok(res, await fn(req.validatedQuery)) }
  catch (error) { return next(error) }
}

export const marketplaceAnalytics = analytics(insights.marketplaceAnalytics)
export const sellerAnalytics = analytics(insights.sellerAnalytics)
export const customerAnalytics = analytics(insights.customerAnalytics)
export const financeAnalytics = analytics(insights.financeAnalytics)
export const searchAnalytics = analytics(insights.searchAnalytics)

export async function recommendationInsights(req, res, next) {
  try { return ok(res, await insights.recommendationInsights()) }
  catch (error) { return next(error) }
}

export async function sellerActivity(req, res, next) {
  try {
    const activity = await insights.sellerActivity(req.params.id)
    // Null rather than an error object: the page asks for a store that may legitimately not
    // exist, and a 404 body is easier to render than an exception.
    return ok(res, activity)
  } catch (error) { return next(error) }
}

// ---------------------------------------------------------------------------
// Maintenance and system status
// ---------------------------------------------------------------------------

export async function systemStatus(req, res, next) {
  try { return ok(res, await platform.systemStatus()) }
  catch (error) { return next(error) }
}

export async function updateMaintenance(req, res, next) {
  try {
    const before = await platform.getMaintenance()
    const after = await platform.setMaintenance(req.body, req.user?.id)
    // The middleware caches the setting for a few seconds; clearing it makes the change
    // visible immediately to whoever just made it.
    invalidateMaintenanceCache()

    if (before.enabled !== after.enabled) {
      await recordAudit(req, {
        action: AUDIT.MAINTENANCE_TOGGLED, entityType: 'platform', entityId: 'maintenance',
        metadata: { enabled: after.enabled },
      })
    }
    return ok(res, after, after.enabled
      ? 'Maintenance mode is on. The storefront is closed; the admin panel stays open.'
      : 'Maintenance mode is off. The storefront is open again.')
  } catch (error) { return next(error) }
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export async function listBackups(req, res, next) {
  try {
    const { page, pageSize } = req.validatedQuery
    const { items, total, summary } = await platform.listBackups({ page, pageSize })
    return okPage(res, items, { page, pageSize, total }, undefined, { summary })
  } catch (error) { return next(error) }
}

export async function createBackup(req, res, next) {
  try {
    const backup = await platform.createBackup(req.user?.id)
    await recordAudit(req, {
      action: AUDIT.BACKUP_CREATED, entityType: 'backup', entityId: backup.id,
      metadata: { tables: backup.tableCount, rows: backup.rowCount },
    })
    return ok(res, backup, `Exported ${backup.tableCount} tables (${backup.rowCount.toLocaleString('en-PK')} rows).`, 201)
  } catch (error) { return next(error) }
}

/**
 * Stream one export.
 *
 * A backup is the whole database in one file, including every address and password hash, so
 * it is served exactly like a seller document: authenticated, as an attachment, never cached,
 * and never from a static path.
 */
export async function downloadBackup(req, res, next) {
  try {
    const { fileName, buffer } = await platform.readBackup(req.params.id)
    await recordAudit(req, { action: AUDIT.BACKUP_DOWNLOADED, entityType: 'backup', entityId: req.params.id })

    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Length', buffer.length)
    return res.end(buffer)
  } catch (error) { return next(error) }
}

export async function deleteBackup(req, res, next) {
  try {
    const { fileName } = await platform.deleteBackup(req.params.id)
    await recordAudit(req, { action: AUDIT.BACKUP_DELETED, entityType: 'backup', entityId: req.params.id, metadata: { fileName } })
    return ok(res, null, 'Backup deleted.')
  } catch (error) { return next(error) }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export async function securityOverview(req, res, next) {
  try { return ok(res, await security.securityOverview()) }
  catch (error) { return next(error) }
}

export async function updateSecurityPolicy(req, res, next) {
  try {
    await updateSettings({ 'security.require_2fa_for_staff': req.body.requireTwoFactorForStaff }, req.user?.id)
    await recordAudit(req, {
      action: AUDIT.SETTINGS_UPDATED, entityType: 'settings', entityId: 'security',
      metadata: { requireTwoFactorForStaff: req.body.requireTwoFactorForStaff },
    })
    return ok(res, await security.securityOverview(), 'Security policy saved.')
  } catch (error) { return next(error) }
}

// --- The caller's own second factor -----------------------------------------

export async function twoFactorStatus(req, res, next) {
  try { return ok(res, await security.twoFactorStatus(req.user.id)) }
  catch (error) { return next(error) }
}

export async function beginTwoFactor(req, res, next) {
  try {
    return ok(res, await security.beginTwoFactor(req.user.id),
      'Scan this in your authenticator app, then enter the code it shows.')
  } catch (error) { return next(error) }
}

export async function confirmTwoFactor(req, res, next) {
  try {
    const result = await security.confirmTwoFactor(req.user.id, req.body.code)
    await recordAudit(req, { action: AUDIT.TWO_FACTOR_ENABLED, entityType: 'user', entityId: req.user.publicId })
    return ok(res, result, 'Two-factor is on. Save these recovery codes — they are shown once.')
  } catch (error) { return next(error) }
}

export async function disableTwoFactor(req, res, next) {
  try {
    const result = await security.disableTwoFactor(req.user.id, req.body.password)
    await recordAudit(req, { action: AUDIT.TWO_FACTOR_DISABLED, entityType: 'user', entityId: req.user.publicId })
    return ok(res, result, 'Two-factor is off.')
  } catch (error) { return next(error) }
}

export async function regenerateBackupCodes(req, res, next) {
  try {
    const result = await security.regenerateBackupCodes(req.user.id, req.body.password)
    return ok(res, result, 'New recovery codes issued. The previous ones no longer work.')
  } catch (error) { return next(error) }
}

// ---------------------------------------------------------------------------
// Returns and refunds
// ---------------------------------------------------------------------------

export async function listReturns(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total, stats } = await fulfilment.listReturns({ page, pageSize, status })
    return okPage(res, items, { page, pageSize, total }, undefined, { stats })
  } catch (error) { return next(error) }
}

export async function getReturn(req, res, next) {
  try { return ok(res, await fulfilment.getReturn(req.params.id)) }
  catch (error) { return next(error) }
}

export async function getDispute(req, res, next) {
  try { return ok(res, await fulfilment.getDispute(req.params.id)) }
  catch (error) { return next(error) }
}

export async function listRefunds(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total, stats } = await fulfilment.listRefunds({ page, pageSize, status })
    return okPage(res, items, { page, pageSize, total }, undefined, { stats })
  } catch (error) { return next(error) }
}

export async function getRefund(req, res, next) {
  try { return ok(res, await fulfilment.getRefund(req.params.id)) }
  catch (error) { return next(error) }
}

export async function settleRefund(req, res, next) {
  try {
    const refund = await fulfilment.settleRefund(req.params.id, req.body, req.user?.id)
    await recordAudit(req, {
      action: AUDIT.REFUND_SETTLED, entityType: 'refund', entityId: refund.id,
      metadata: { status: refund.status, orderNumber: refund.orderNumber },
    })
    return ok(res, refund, refund.status === 'succeeded'
      ? 'Refund recorded as paid, and the buyer has been emailed.'
      : 'Refund recorded as failed.')
  } catch (error) { return next(error) }
}
