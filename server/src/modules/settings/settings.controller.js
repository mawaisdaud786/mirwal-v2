import { ok, okPage } from '../../lib/errors.js'
import * as settings from './settings.service.js'
import * as payouts from '../payouts/payouts.service.js'
import * as roles from '../admin/roles.service.js'
import { AUDIT, recordAudit } from '../admin/audit.service.js'

/**
 * Settings, integrations, webhooks, payouts and roles.
 *
 * Everything here is admin-only except the two seller payout handlers at the bottom, which
 * are mounted on the seller router and scope themselves to `req.seller.id`.
 *
 * Every write is audited. These are the highest-consequence changes in the panel — turning
 * off a payment method, changing the commission rate, granting a permission, marking money as
 * paid — so "who changed this and when" matters more here than anywhere else.
 */

// --- Platform settings ------------------------------------------------------

export async function listSettings(req, res, next) {
  try { return ok(res, await settings.listSettings(req.validatedQuery?.category)) }
  catch (error) { return next(error) }
}

export async function updateSettings(req, res, next) {
  try {
    const result = await settings.updateSettings(req.body.updates, req.user.id)
    await recordAudit(req, {
      action: AUDIT.SETTINGS_UPDATED, entityType: 'settings', entityId: null,
      // The keys and their new values: a settings change is small, and knowing what it became
      // is the entire value of auditing it.
      metadata: { keys: result.keys, values: req.body.updates },
    })
    return ok(res, result, `${result.updated} setting${result.updated === 1 ? '' : 's'} saved.`)
  } catch (error) { return next(error) }
}

// --- Integrations -----------------------------------------------------------

export async function listIntegrations(req, res, next) {
  try { return ok(res, await settings.listIntegrations()) }
  catch (error) { return next(error) }
}

export async function updateIntegration(req, res, next) {
  try {
    const integration = await settings.updateIntegration(req.params.provider, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.INTEGRATION_UPDATED, entityType: 'integration', entityId: req.params.provider,
      metadata: { status: integration?.status },
    })
    return ok(res, integration, 'Integration updated.')
  } catch (error) { return next(error) }
}

// --- Webhooks ---------------------------------------------------------------

export async function listWebhooks(req, res, next) {
  try { return ok(res, await settings.listWebhooks()) }
  catch (error) { return next(error) }
}

export async function createWebhook(req, res, next) {
  try {
    const result = await settings.createWebhook(req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.WEBHOOK_CREATED, entityType: 'webhook', entityId: result.id,
      // Never the secret.
      metadata: { name: req.body.name, url: req.body.url, events: req.body.events },
    })
    return ok(
      res,
      result,
      'Endpoint created. Copy the signing secret now — it is not shown again.',
      201,
    )
  } catch (error) { return next(error) }
}

export async function updateWebhook(req, res, next) {
  try {
    const id = await settings.updateWebhook(req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.WEBHOOK_UPDATED, entityType: 'webhook', entityId: id,
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, { id }, 'Endpoint updated.')
  } catch (error) { return next(error) }
}

export async function deleteWebhook(req, res, next) {
  try {
    const result = await settings.deleteWebhook(req.params.id)
    await recordAudit(req, {
      action: AUDIT.WEBHOOK_DELETED, entityType: 'webhook', entityId: req.params.id,
      metadata: { name: result.name },
    })
    return ok(res, null, 'Endpoint deleted.')
  } catch (error) { return next(error) }
}

export async function rotateWebhookSecret(req, res, next) {
  try {
    const result = await settings.rotateWebhookSecret(req.params.id)
    await recordAudit(req, {
      action: AUDIT.WEBHOOK_SECRET_ROTATED, entityType: 'webhook', entityId: req.params.id,
    })
    return ok(res, result, 'New signing secret generated. The previous one no longer works.')
  } catch (error) { return next(error) }
}

// --- Roles ------------------------------------------------------------------

export async function listRoles(req, res, next) {
  try { return ok(res, await roles.listRoles()) }
  catch (error) { return next(error) }
}

export async function listPermissions(req, res, next) {
  try { return ok(res, await roles.listPermissions()) }
  catch (error) { return next(error) }
}

export async function accessMatrix(req, res, next) {
  try { return ok(res, await roles.getAccessMatrix()) }
  catch (error) { return next(error) }
}

export async function getRole(req, res, next) {
  try { return ok(res, await roles.getRole(req.params.slug)) }
  catch (error) { return next(error) }
}

export async function setRolePermissions(req, res, next) {
  try {
    const result = await roles.setRolePermissions(req.params.slug, req.body.permissions)
    await recordAudit(req, {
      action: AUDIT.ROLE_PERMISSIONS_UPDATED, entityType: 'role', entityId: req.params.slug,
      metadata: { granted: result.granted, revoked: result.revoked, total: result.total },
    })
    return ok(
      res,
      result,
      // Permissions travel inside the access token, so an admin signed in right now keeps the
      // old set until their token is next refreshed. Saying so avoids a confusing "I granted
      // it but it doesn't work yet".
      'Permissions saved. Signed-in users pick up the change when their session next refreshes.',
    )
  } catch (error) { return next(error) }
}

// --- Payouts: admin ---------------------------------------------------------

export async function listPayoutsAdmin(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total } = await payouts.listPayouts({ sellerId: null }, { page, pageSize, status })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function payoutStats(req, res, next) {
  try { return ok(res, await payouts.getPayoutStats()) }
  catch (error) { return next(error) }
}

export async function getPayoutAdmin(req, res, next) {
  try { return ok(res, await payouts.getPayout({ sellerId: null }, req.params.id)) }
  catch (error) { return next(error) }
}

export async function updatePayout(req, res, next) {
  try {
    const { status, externalReference, failureReason, notes } = req.body
    const result = await payouts.updatePayoutStatus(req.params.id, status, {
      adminUserId: req.user.id, externalReference, failureReason, notes,
    })
    const action = status === 'paid' ? AUDIT.PAYOUT_PAID
      : status === 'approved' ? AUDIT.PAYOUT_APPROVED
        : status === 'rejected' ? AUDIT.PAYOUT_REJECTED
          : AUDIT.PAYOUT_UPDATED
    await recordAudit(req, {
      action, entityType: 'payout', entityId: req.params.id,
      metadata: {
        reference: result.reference, from: result.previousStatus, to: result.status,
        ...(externalReference ? { externalReference } : {}),
        ...(failureReason ? { reason: failureReason } : {}),
      },
    })
    return ok(res, result, `Payout ${result.reference} marked ${status}.`)
  } catch (error) { return next(error) }
}

// --- Payouts: seller --------------------------------------------------------

export async function listPayoutsSeller(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total } = await payouts.listPayouts({ sellerId: req.seller.id }, { page, pageSize, status })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function getPayoutSeller(req, res, next) {
  try { return ok(res, await payouts.getPayout({ sellerId: req.seller.id }, req.params.id)) }
  catch (error) { return next(error) }
}

export async function availableBalance(req, res, next) {
  try { return ok(res, await payouts.getAvailableBalance(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function requestPayout(req, res, next) {
  try {
    const result = await payouts.requestPayout(req.seller.id, req.body)
    return ok(
      res,
      result,
      `Withdrawal ${result.reference} requested for ${result.itemCount} delivered order item${result.itemCount === 1 ? '' : 's'}.`,
      201,
    )
  } catch (error) { return next(error) }
}
