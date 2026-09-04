import { ok, okPage } from '../../lib/errors.js'
import * as service from './catalog.service.js'
import { recordSearch, recordSearchClick } from './searchLog.js'

export async function listProducts(req, res, next) {
  try {
    const startedAt = Date.now()
    const { items, page, pageSize, total } = await service.listProducts(req.validatedQuery)

    /**
     * Record the search behind this listing, but only on the first page: paging through
     * results is one search, and counting each page would make a browsing shopper look like
     * a dozen. The insert is not awaited — the shopper is waiting for products, not for a
     * reporting table.
     */
    const term = req.validatedQuery?.q
    let searchId = null
    if (term && page === 1) {
      searchId = await recordSearch({
        term,
        userId: req.user?.id ?? null,
        resultCount: total,
        durationMs: Date.now() - startedAt,
      })
    }

    // Handed back so the storefront can attribute a product open to this search. It is an
    // opaque row id and reveals nothing about the shopper.
    if (searchId) res.setHeader('X-Search-Id', searchId)
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function getProduct(req, res, next) {
  try {
    const product = await service.getProductBySlug(req.params.slug)
    // Fire-and-forget: a click attribution must never delay or fail a product page.
    const searchId = req.get('X-Search-Id')
    if (searchId) recordSearchClick(searchId, product.id)
    return ok(res, product)
  } catch (error) { return next(error) }
}

export async function listCategories(req, res, next) {
  try { return ok(res, await service.listCategories()) }
  catch (error) { return next(error) }
}

export async function getCategory(req, res, next) {
  try { return ok(res, await service.getCategoryBySlug(req.params.slug)) }
  catch (error) { return next(error) }
}

export async function listBrands(req, res, next) {
  try { return ok(res, await service.listBrands()) }
  catch (error) { return next(error) }
}

export async function listSellers(req, res, next) {
  try { return ok(res, await service.listSellers()) }
  catch (error) { return next(error) }
}

export async function getSeller(req, res, next) {
  try { return ok(res, await service.getSellerBySlug(req.params.slug)) }
  catch (error) { return next(error) }
}

export async function getFacets(req, res, next) {
  try { return ok(res, await service.getFacets()) }
  catch (error) { return next(error) }
}
