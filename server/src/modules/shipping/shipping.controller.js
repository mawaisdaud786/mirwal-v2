import { ok } from '../../lib/errors.js'
import * as shipping from './shipping.service.js'
import { AUDIT, recordAudit } from '../admin/audit.service.js'

/**
 * Shipping endpoints.
 *
 * Every write is audited: a rate change is a pricing change, and "who made delivery free
 * last Tuesday" needs an answer.
 */

export async function overview(req, res, next) {
  try {
    const [zones, warehouses, stats] = await Promise.all([
      shipping.listZones(), shipping.listWarehouses(), shipping.stats(),
    ])
    return ok(res, { zones, warehouses, stats })
  } catch (error) { return next(error) }
}

// --- Zones ------------------------------------------------------------------

export async function createZone(req, res, next) {
  try {
    const zone = await shipping.createZone(req.body)
    await recordAudit(req, { action: AUDIT.ZONE_CREATED, entityType: 'shipping_zone', entityId: zone.id, metadata: { name: zone.name } })
    return ok(res, zone, `Zone "${zone.name}" created.`, 201)
  } catch (error) { return next(error) }
}

export async function updateZone(req, res, next) {
  try {
    const zone = await shipping.updateZone(req.params.id, req.body)
    await recordAudit(req, { action: AUDIT.ZONE_UPDATED, entityType: 'shipping_zone', entityId: zone.id, metadata: { name: zone.name } })
    return ok(res, zone, 'Zone saved.')
  } catch (error) { return next(error) }
}

export async function deleteZone(req, res, next) {
  try {
    const { name } = await shipping.deleteZone(req.params.id)
    await recordAudit(req, { action: AUDIT.ZONE_DELETED, entityType: 'shipping_zone', entityId: req.params.id, metadata: { name } })
    return ok(res, null, `Zone "${name}" and its methods were removed.`)
  } catch (error) { return next(error) }
}

// --- Methods ----------------------------------------------------------------

export async function createMethod(req, res, next) {
  try {
    const method = await shipping.createMethod(req.params.id, req.body)
    await recordAudit(req, { action: AUDIT.METHOD_CREATED, entityType: 'shipping_method', entityId: method.id, metadata: { name: method.name } })
    return ok(res, method, `"${method.name}" added.`, 201)
  } catch (error) { return next(error) }
}

export async function updateMethod(req, res, next) {
  try {
    const method = await shipping.updateMethod(req.params.id, req.body)
    await recordAudit(req, { action: AUDIT.METHOD_UPDATED, entityType: 'shipping_method', entityId: method.id, metadata: { name: method.name } })
    return ok(res, method, 'Method saved.')
  } catch (error) { return next(error) }
}

export async function deleteMethod(req, res, next) {
  try {
    const { name } = await shipping.deleteMethod(req.params.id)
    await recordAudit(req, { action: AUDIT.METHOD_DELETED, entityType: 'shipping_method', entityId: req.params.id, metadata: { name } })
    return ok(res, null, `"${name}" removed.`)
  } catch (error) { return next(error) }
}

// --- Warehouses -------------------------------------------------------------

export async function createWarehouse(req, res, next) {
  try {
    const warehouse = await shipping.createWarehouse(req.body)
    await recordAudit(req, { action: AUDIT.WAREHOUSE_CREATED, entityType: 'warehouse', entityId: warehouse.id, metadata: { code: warehouse.code } })
    return ok(res, warehouse, `${warehouse.name} added.`, 201)
  } catch (error) { return next(error) }
}

export async function updateWarehouse(req, res, next) {
  try {
    const warehouse = await shipping.updateWarehouse(req.params.id, req.body)
    await recordAudit(req, { action: AUDIT.WAREHOUSE_UPDATED, entityType: 'warehouse', entityId: warehouse.id, metadata: { code: warehouse.code } })
    return ok(res, warehouse, 'Warehouse saved.')
  } catch (error) { return next(error) }
}

export async function deleteWarehouse(req, res, next) {
  try {
    const { name } = await shipping.deleteWarehouse(req.params.id)
    await recordAudit(req, { action: AUDIT.WAREHOUSE_DELETED, entityType: 'warehouse', entityId: req.params.id, metadata: { name } })
    return ok(res, null, `${name} removed.`)
  } catch (error) { return next(error) }
}

// --- Public quote -----------------------------------------------------------

/**
 * What delivery costs to one address. Public, like the rest of the catalogue: a shopper has
 * to see a delivery price before signing in, and nothing here reveals anything but the
 * marketplace's own published rates.
 */
export async function quote(req, res, next) {
  try {
    return ok(res, await shipping.quote(req.validatedQuery))
  } catch (error) { return next(error) }
}

/**
 * Active zones and their active methods, for the storefront and the seller portal.
 *
 * Read-only and unauthenticated. Sellers do not set delivery rates on Mirwal — the
 * marketplace does — so this is what a seller's shipping page shows them rather than a form
 * that pretends otherwise.
 */
export async function publicZones(req, res, next) {
  try {
    const zones = await shipping.listZones({ includeInactive: false })
    return ok(res, zones.map((zone) => ({
      ...zone,
      methods: zone.methods.filter((method) => method.isActive),
    })))
  } catch (error) { return next(error) }
}
