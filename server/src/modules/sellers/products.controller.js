import { z } from 'zod'
import { ok, okPage } from '../../lib/errors.js'
import * as service from './products.service.js'

/**
 * Seller product endpoints.
 *
 * Every call passes `req.seller.id` — resolved by requireSeller from the access token — as the
 * ownership scope. No handler reads a seller identifier from the request itself.
 */

export async function getFormOptions(req, res, next) {
  try { return ok(res, await service.getProductFormOptions()) }
  catch (error) { return next(error) }
}

export async function getProduct(req, res, next) {
  try { return ok(res, await service.getProduct(req.seller.id, req.params.id)) }
  catch (error) { return next(error) }
}

export async function createProduct(req, res, next) {
  try {
    const product = await service.createProduct(req.seller.id, req.body)
    return ok(
      res,
      product,
      product.status === 'draft'
        ? 'Draft saved.'
        : 'Submitted for review. Mirwal will publish it once approved.',
      201,
    )
  } catch (error) { return next(error) }
}

export async function updateProduct(req, res, next) {
  try {
    const { product, returnedToReview } = await service.updateProduct(req.seller.id, req.params.id, req.body)
    return ok(
      res,
      product,
      // Sellers need to be told when an edit took a live listing off the storefront, or they
      // will read "Saved" and wonder why the product disappeared.
      returnedToReview
        ? 'Saved. Because this listing was live, it has gone back for review before republishing.'
        : 'Product updated.',
    )
  } catch (error) { return next(error) }
}

export async function setProductStatus(req, res, next) {
  try {
    const result = await service.setProductStatus(req.seller.id, req.params.id, req.body.status)
    return ok(res, result, `Product moved to ${result.status.replace('_', ' ')}.`)
  } catch (error) { return next(error) }
}

export async function deleteProduct(req, res, next) {
  try {
    await service.deleteProduct(req.seller.id, req.params.id)
    return ok(res, null, 'Product deleted.')
  } catch (error) { return next(error) }
}

export async function updateInventory(req, res, next) {
  try {
    await service.updateVariantInventory(req.seller.id, req.params.id, req.body)
    return ok(res, null, 'Stock updated.')
  } catch (error) { return next(error) }
}

/**
 * Filters for a seller's own catalogue. Kept here rather than in a schemas file because these
 * three are the only query this endpoint takes.
 */
export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'delisted', 'archived']).optional(),
  search: z.string().trim().max(120).optional(),
})

export async function listProducts(req, res, next) {
  try {
    const { page, pageSize, status, search } = req.validatedQuery ?? {}
    const result = await service.listForSeller(req.seller.id, { page, pageSize, status, search })
    return okPage(res, result.items, { page, pageSize, total: result.total })
  } catch (error) { return next(error) }
}

/** Counts across the whole store, so the tabs do not describe only the page being shown. */
export async function productStatusCounts(req, res, next) {
  try { return ok(res, await service.statusCountsForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}
