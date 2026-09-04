import { ok } from '../../lib/errors.js'
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
  try { return ok(res, await service.listOrdersForAdmin()) }
  catch (error) { return next(error) }
}

export async function getOrderAdmin(req, res, next) {
  try { return ok(res, await service.getOrderForAdmin(req.params.id)) }
  catch (error) { return next(error) }
}

export async function listSellerOrderItems(req, res, next) {
  try { return ok(res, await service.listOrderItemsForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function updateSellerOrderItemStatus(req, res, next) {
  try {
    const updated = await service.updateOrderItemStatusForSeller(req.seller.id, req.params.id, req.body.status)
    return ok(res, updated, 'Order item updated.')
  } catch (error) { return next(error) }
}

export async function cancelOrderItem(req, res, next) {
  try { return ok(res, await service.cancelOrderItemForBuyer(req.user.id, req.params.id), 'Order item cancelled.') }
  catch (error) { return next(error) }
}

export async function createReturnRequest(req, res, next) {
  try { return ok(res, await service.createReturnRequestForBuyer(req.user.id, req.params.id, req.body), 'Return requested.', 201) }
  catch (error) { return next(error) }
}

export async function listSellerReturnRequests(req, res, next) {
  try { return ok(res, await service.listReturnRequestsForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function resolveSellerReturnRequest(req, res, next) {
  try { return ok(res, await service.resolveReturnRequestForSeller(req.seller.id, req.params.id, req.body), 'Return request resolved.') }
  catch (error) { return next(error) }
}
