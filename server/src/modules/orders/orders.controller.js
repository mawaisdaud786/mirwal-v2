import { ok, okPage } from '../../lib/errors.js'
import * as service from './orders.service.js'

export async function createOrder(req, res, next) {
  try { return ok(res, await service.createOrder(req.user.id, req.body), 'Order placed.', 201) }
  catch (error) { return next(error) }
}

export async function listOrders(req, res, next) {
  try { return ok(res, await service.listOrdersForBuyer(req.user.id)) }
  catch (error) { return next(error) }
}

export async function getOrder(req, res, next) {
  try { return ok(res, await service.getOrderForBuyer(req.user.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function listOrdersAdmin(req, res, next) {
  try {
    const { page, pageSize, search, status, paymentStatus } = req.validatedQuery ?? {}
    const result = await service.listOrdersForAdmin({ page, pageSize, search, status, paymentStatus })
    return okPage(res, result.items, { page, pageSize, total: result.total })
  } catch (error) { return next(error) }
}

/** Headline counts over every order, so the tabs do not describe only the visible page. */
export async function orderCountsAdmin(req, res, next) {
  try { return ok(res, await service.orderCountsForAdmin()) }
  catch (error) { return next(error) }
}

export async function getOrderAdmin(req, res, next) {
  try { return ok(res, await service.getOrderForAdmin(req.params.id)) }
  catch (error) { return next(error) }
}

export async function listSellerOrderItems(req, res, next) {
  try {
    const { page, pageSize, status, search } = req.validatedQuery ?? {}
    const result = await service.listOrderItemsForSeller(req.seller.id, { page, pageSize, status, search })
    return okPage(res, result.items, { page, pageSize, total: result.total })
  } catch (error) { return next(error) }
}

/** Counts across the whole store, so the tabs do not describe only the page being shown. */
export async function sellerOrderItemCounts(req, res, next) {
  try { return ok(res, await service.orderItemCountsForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function updateSellerOrderItemStatus(req, res, next) {
  try {
    const updated = await service.updateOrderItemStatusForSeller(
      req.seller.id, req.params.id, req.body.status, { reason: req.body.reason },
    )
    return ok(res, updated, 'Order item updated.')
  } catch (error) { return next(error) }
}

/*
 * Returns used to live here as three handlers over three states. The lifecycle they could
 * express — requested, approved, rejected — was narrower than the one the schema has had since
 * migration 021, so the status shown to a buyer was routinely untrue. They now live in
 * `returns.controller.js`, which covers the whole of it plus escalation to Mirwal.
 */
