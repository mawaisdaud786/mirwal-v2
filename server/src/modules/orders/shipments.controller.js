import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import { recordAudit, AUDIT } from '../admin/audit.service.js'
import { listOrderEvents } from './events.service.js'
import { queryOne } from '../../db/pool.js'
import { notFound } from '../../lib/errors.js'
import * as service from './shipments.service.js'

export const createShipmentSchema = z.object({
  orderItemIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
  carrierSlug: z.string().trim().min(1).max(60).optional().nullable(),
  trackingNumber: z.string().trim().max(80).optional().nullable(),
  // ISO date-time. Shown to the buyer as the delivery promise, so it is validated rather than
  // passed through — an unparseable date renders as "Invalid Date" on their tracking page.
  estimatedDeliveryAt: z.string().trim().datetime({ offset: true }).optional().nullable(),
  weightGrams: z.coerce.number().int().min(0).max(500_000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

export const updateShipmentSchema = z.object({
  status: z.enum(['in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled']),
  failureReason: z.string().trim().max(255).optional().nullable(),
  receivedBy: z.string().trim().max(150).optional().nullable(),
  proofUrl: z.string().trim().max(500).optional().nullable(),
})

export const listShipmentsSchema = z.object({
  status: z.enum(['ready', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})

export const shipmentIdSchema = z.object({ id: z.string().trim().min(1).max(36) })
export const orderIdParamSchema = z.object({ id: z.string().trim().min(1).max(36) })

export async function carriers(_req, res, next) {
  try { return ok(res, await service.listCarriers()) }
  catch (error) { return next(error) }
}

export async function listForSeller(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    const { items, total } = await service.listForSeller(req.seller.id, { page, pageSize, status })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function create(req, res, next) {
  try {
    const result = await service.createShipment(req.seller.id, req.body)
    await recordAudit(req, {
      action: AUDIT.SHIPMENT_CREATED,
      entityType: 'shipment',
      entityId: result.id,
      metadata: { carrier: req.body.carrierSlug ?? null, items: result.itemCount },
    })
    return ok(res, result, 'Shipment created and the buyer notified.', 201)
  } catch (error) { return next(error) }
}

export async function updateBySeller(req, res, next) {
  try {
    const result = await service.updateShipmentStatus({ sellerId: req.seller.id }, req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.SHIPMENT_UPDATED, entityType: 'shipment', entityId: req.params.id,
      metadata: { status: req.body.status },
    })
    return ok(res, result, 'Shipment updated.')
  } catch (error) { return next(error) }
}

export async function updateByAdmin(req, res, next) {
  try {
    const result = await service.updateShipmentStatus({}, req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.SHIPMENT_UPDATED, entityType: 'shipment', entityId: req.params.id,
      metadata: { status: req.body.status, by: 'admin' },
    })
    return ok(res, result, 'Shipment updated.')
  } catch (error) { return next(error) }
}

/** The buyer's tracking view for one order. */
export async function trackingForBuyer(req, res, next) {
  try { return ok(res, await service.listForOrder(req.user.id, req.params.id)) }
  catch (error) { return next(error) }
}

/**
 * The order timeline.
 *
 * A buyer sees what happened and when; staff also see who did it. Neither is told the name of
 * an individual on the other side — a buyer learns that "the seller" dispatched their parcel,
 * not which person at the store, because naming individuals across the divide is a privacy
 * leak no order page needs.
 */
export async function timelineForBuyer(req, res, next) {
  try {
    const order = await queryOne('SELECT id, buyer_id FROM orders WHERE public_id = ?', [req.params.id])
    if (!order || order.buyer_id !== req.user.id) throw notFound('Order not found.')
    return ok(res, await listOrderEvents(order.id, { scope: 'buyer' }))
  } catch (error) { return next(error) }
}

export async function timelineForStaff(req, res, next) {
  try {
    const order = await queryOne('SELECT id FROM orders WHERE public_id = ?', [req.params.id])
    if (!order) throw notFound('Order not found.')
    return ok(res, await listOrderEvents(order.id, { scope: 'staff' }))
  } catch (error) { return next(error) }
}
