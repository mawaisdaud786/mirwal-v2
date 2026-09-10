import { ok, okPage } from '../../lib/errors.js'
import * as service from './support.service.js'
import { AUDIT, recordAudit } from '../admin/audit.service.js'

/**
 * Support endpoints, shared by all three applications.
 *
 * `scopeOf` decides which end of a ticket the caller is on:
 *
 *   admin  → { isStaff: true }           the whole queue, internal notes included
 *   seller → { sellerId, requesterId }   their own store's tickets, no internal notes
 *   customer → { requesterId }           their own tickets, no internal notes
 *
 * The staff flag comes from the roles inside the verified access token, never from anything
 * the client sent — which is what stops a requester reading staff triage notes by asking.
 */
function scopeOf(req) {
  const isStaff = req.user.roles.includes('admin') || req.user.roles.includes('super_admin')
  return {
    isStaff,
    requesterId: req.user.id,
    sellerId: req.seller?.id ?? null,
  }
}

export async function listTickets(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await service.listTickets(scopeOf(req), { page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function ticketStats(req, res, next) {
  try { return ok(res, await service.getTicketStats(scopeOf(req))) }
  catch (error) { return next(error) }
}

export async function getTicket(req, res, next) {
  try { return ok(res, await service.getTicket(scopeOf(req), req.params.id)) }
  catch (error) { return next(error) }
}

export async function createTicket(req, res, next) {
  try {
    const ticket = await service.createTicket(
      { requesterId: req.user.id, sellerId: req.seller?.id ?? null },
      req.body,
    )
    // The reference is the whole point of the confirmation: it is what the requester quotes
    // back, and the old fake form gave them nothing to quote.
    return ok(res, ticket, `Request ${ticket.reference} submitted. We'll reply here.`, 201)
  } catch (error) { return next(error) }
}

export async function addMessage(req, res, next) {
  try {
    const ticket = await service.addMessage(scopeOf(req), req.params.id, req.body, req.user.id)
    return ok(res, ticket, req.body.isInternal ? 'Internal note added.' : 'Reply sent.')
  } catch (error) { return next(error) }
}

export async function updateTicket(req, res, next) {
  try {
    const ticket = await service.updateTicket(scopeOf(req), req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.TICKET_UPDATED, entityType: 'ticket', entityId: req.params.id,
      metadata: { reference: ticket.reference, fields: Object.keys(req.body) },
    })
    return ok(res, ticket, 'Ticket updated.')
  } catch (error) { return next(error) }
}

export async function closeTicket(req, res, next) {
  try {
    const result = await service.closeTicket(scopeOf(req), req.params.id)
    return ok(res, null, `Request ${result.reference} closed.`)
  } catch (error) { return next(error) }
}
