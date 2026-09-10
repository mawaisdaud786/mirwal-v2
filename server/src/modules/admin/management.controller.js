import { ok, okPage } from '../../lib/errors.js'
import * as catalog from './catalog.service.js'
import * as sellers from './sellers.service.js'
import { AUDIT, listAuditLogs, getAuditFilters, recordAudit } from './audit.service.js'

/**
 * Admin management endpoints.
 *
 * Every handler that changes state records an audit row AFTER the change succeeds, so the log
 * only ever contains things that actually happened. `recordAudit` never throws (see
 * audit.service.js), so an audit failure cannot turn a successful approval into a 500.
 *
 * Reads use `req.validatedQuery` — `validate(..., 'query')` puts the parsed query there
 * because `req.query` is a getter in Express 5 and assigning to it throws.
 */

// --- Products ---------------------------------------------------------------

export async function listProducts(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await catalog.listProducts({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function getProductStatusCounts(req, res, next) {
  try { return ok(res, await catalog.getProductStatusCounts()) }
  catch (error) { return next(error) }
}

export async function getProduct(req, res, next) {
  try { return ok(res, await catalog.getProduct(req.params.id)) }
  catch (error) { return next(error) }
}

export async function createProduct(req, res, next) {
  try {
    const publicId = await catalog.createProduct(req.body)
    const product = await catalog.getProduct(publicId)
    await recordAudit(req, {
      action: AUDIT.PRODUCT_CREATED,
      entityType: 'product',
      entityId: publicId,
      metadata: { name: product.name, status: product.status, seller: product.seller?.slug },
    })
    return ok(res, product, 'Product created.', 201)
  } catch (error) { return next(error) }
}

export async function updateProduct(req, res, next) {
  try {
    const product = await catalog.updateProduct(req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.PRODUCT_UPDATED,
      entityType: 'product',
      entityId: req.params.id,
      // The submitted field names only — values may be long, and the current values are on
      // the entity itself anyway.
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, product, 'Product updated.')
  } catch (error) { return next(error) }
}

export async function setProductApproval(req, res, next) {
  try {
    const { approved, reason } = req.body
    const result = await catalog.setProductApproval(req.params.id, { approved, reason })
    await recordAudit(req, {
      action: approved ? AUDIT.PRODUCT_APPROVED : AUDIT.PRODUCT_REJECTED,
      entityType: 'product',
      entityId: req.params.id,
      metadata: { from: result.previousStatus, to: result.status, ...(reason ? { reason } : {}) },
    })
    return ok(res, result, approved ? 'Product approved and published.' : 'Product rejected.')
  } catch (error) { return next(error) }
}

export async function setProductStatus(req, res, next) {
  try {
    const result = await catalog.setProductStatus(req.params.id, req.body.status)
    await recordAudit(req, {
      action: AUDIT.PRODUCT_UPDATED,
      entityType: 'product',
      entityId: req.params.id,
      metadata: { from: result.previousStatus, to: result.status },
    })
    return ok(res, result, `Product moved to ${result.status}.`)
  } catch (error) { return next(error) }
}

export async function deleteProduct(req, res, next) {
  try {
    const result = await catalog.deleteProduct(req.params.id)
    await recordAudit(req, {
      action: AUDIT.PRODUCT_DELETED,
      entityType: 'product',
      entityId: req.params.id,
      metadata: { name: result.name },
    })
    return ok(res, null, 'Product deleted.')
  } catch (error) { return next(error) }
}

// --- Categories -------------------------------------------------------------

export async function listCategories(req, res, next) {
  try { return ok(res, await catalog.listCategories()) }
  catch (error) { return next(error) }
}

export async function createCategory(req, res, next) {
  try {
    const slug = await catalog.createCategory(req.body)
    await recordAudit(req, {
      action: AUDIT.CATEGORY_CREATED, entityType: 'category', entityId: slug,
      metadata: { name: req.body.name },
    })
    return ok(res, { slug }, 'Category created.', 201)
  } catch (error) { return next(error) }
}

export async function updateCategory(req, res, next) {
  try {
    const slug = await catalog.updateCategory(req.params.slug, req.body)
    await recordAudit(req, {
      action: AUDIT.CATEGORY_UPDATED, entityType: 'category', entityId: slug,
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, { slug }, 'Category updated.')
  } catch (error) { return next(error) }
}

export async function deleteCategory(req, res, next) {
  try {
    const result = await catalog.deleteCategory(req.params.slug)
    await recordAudit(req, {
      action: AUDIT.CATEGORY_DELETED, entityType: 'category', entityId: req.params.slug,
      metadata: { name: result.name },
    })
    return ok(res, null, 'Category deleted.')
  } catch (error) { return next(error) }
}

// --- Brands -----------------------------------------------------------------

export async function listBrands(req, res, next) {
  try { return ok(res, await catalog.listBrands()) }
  catch (error) { return next(error) }
}

export async function createBrand(req, res, next) {
  try {
    const slug = await catalog.createBrand(req.body)
    await recordAudit(req, {
      action: AUDIT.BRAND_CREATED, entityType: 'brand', entityId: slug,
      metadata: { name: req.body.name },
    })
    return ok(res, { slug }, 'Brand created.', 201)
  } catch (error) { return next(error) }
}

export async function updateBrand(req, res, next) {
  try {
    const slug = await catalog.updateBrand(req.params.slug, req.body)
    await recordAudit(req, {
      action: AUDIT.BRAND_UPDATED, entityType: 'brand', entityId: slug,
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, { slug }, 'Brand updated.')
  } catch (error) { return next(error) }
}

export async function deleteBrand(req, res, next) {
  try {
    const result = await catalog.deleteBrand(req.params.slug)
    await recordAudit(req, {
      action: AUDIT.BRAND_DELETED, entityType: 'brand', entityId: req.params.slug,
      metadata: { name: result.name },
    })
    return ok(res, null, 'Brand deleted.')
  } catch (error) { return next(error) }
}

// --- Inventory --------------------------------------------------------------

export async function listInventory(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await catalog.listInventory({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function updateInventory(req, res, next) {
  try {
    const result = await catalog.updateInventory(req.params.id, req.body)
    await recordAudit(req, {
      action: AUDIT.INVENTORY_UPDATED,
      entityType: 'variant',
      entityId: req.params.id,
      // Stock movements are the audit trail's most-read entries, so the before/after is
      // recorded explicitly rather than left as "quantity changed".
      metadata: {
        sku: result.sku,
        ...(req.body.quantity !== undefined ? { from: result.previousQuantity, to: req.body.quantity } : {}),
      },
    })
    return ok(res, null, 'Inventory updated.')
  } catch (error) { return next(error) }
}

// --- Sellers ----------------------------------------------------------------

export async function listSellers(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await sellers.listSellers({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function getSellerStatusCounts(req, res, next) {
  try { return ok(res, await sellers.getSellerStatusCounts()) }
  catch (error) { return next(error) }
}

export async function getSeller(req, res, next) {
  try { return ok(res, await sellers.getSeller(req.params.id)) }
  catch (error) { return next(error) }
}

export async function approveSeller(req, res, next) {
  try {
    const result = await sellers.approveSeller(req.params.id, req.user.id)
    await recordAudit(req, {
      action: AUDIT.SELLER_APPROVED, entityType: 'seller', entityId: req.params.id,
      metadata: { storeName: result.storeName, from: result.previousStatus },
    })
    return ok(res, result, `${result.storeName} approved.`)
  } catch (error) { return next(error) }
}

export async function rejectSeller(req, res, next) {
  try {
    const result = await sellers.rejectSeller(req.params.id, req.body.reason)
    await recordAudit(req, {
      action: AUDIT.SELLER_REJECTED, entityType: 'seller', entityId: req.params.id,
      metadata: { storeName: result.storeName, from: result.previousStatus, reason: req.body.reason },
    })
    return ok(res, result, `${result.storeName} rejected.`)
  } catch (error) { return next(error) }
}

export async function suspendSeller(req, res, next) {
  try {
    const result = await sellers.suspendSeller(req.params.id, req.body.reason)
    await recordAudit(req, {
      action: AUDIT.SELLER_SUSPENDED, entityType: 'seller', entityId: req.params.id,
      metadata: {
        storeName: result.storeName, reason: req.body.reason,
        productsArchived: result.productsArchived,
      },
    })
    return ok(res, result, `${result.storeName} suspended and ${result.productsArchived} product(s) delisted.`)
  } catch (error) { return next(error) }
}

export async function reinstateSeller(req, res, next) {
  try {
    const result = await sellers.reinstateSeller(req.params.id, req.user.id)
    await recordAudit(req, {
      action: AUDIT.SELLER_REINSTATED, entityType: 'seller', entityId: req.params.id,
      metadata: { storeName: result.storeName, productsRestored: result.productsRestored },
    })
    return ok(res, result, `${result.storeName} reinstated.`)
  } catch (error) { return next(error) }
}

// --- Audit ------------------------------------------------------------------

export async function listAudit(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    const { items, total } = await listAuditLogs({ page, pageSize, ...filters })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function auditFilters(req, res, next) {
  try { return ok(res, await getAuditFilters()) }
  catch (error) { return next(error) }
}
