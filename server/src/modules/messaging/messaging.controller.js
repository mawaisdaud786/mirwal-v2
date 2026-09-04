import multer from 'multer'
import { ok } from '../../lib/errors.js'
import { env } from '../../config/env.js'
import * as messaging from './messaging.service.js'
import * as documents from '../sellers/documents.service.js'
import { verifyMailTransport } from '../../lib/mailer.js'
import { storageInfo } from '../../lib/storage.js'
import { AUDIT, recordAudit } from '../admin/audit.service.js'

/**
 * Messaging and seller-document endpoints.
 *
 * Uploads are buffered in memory rather than streamed to a temp file: the cap is 5MB, and a
 * buffer is what `storage.js` needs in order to inspect the leading bytes and reject a file
 * whose contents do not match any allowed type. Writing to disk first would mean writing
 * something we have not yet decided to accept.
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxBytes, files: 1 },
}).single('file')

// --- Templates ---------------------------------------------------------------

export async function listTemplates(req, res, next) {
  try { return ok(res, await messaging.listTemplates(req.validatedQuery?.channel)) }
  catch (error) { return next(error) }
}

export async function updateTemplate(req, res, next) {
  try {
    const result = await messaging.updateTemplate(req.params.key, req.params.channel, req.body, req.user.id)
    await recordAudit(req, {
      action: AUDIT.TEMPLATE_UPDATED, entityType: 'message_template', entityId: `${result.channel}:${result.key}`,
      metadata: { fields: Object.keys(req.body) },
    })
    return ok(res, result, 'Template saved.')
  } catch (error) { return next(error) }
}

// --- Capability and delivery log ---------------------------------------------

/** What this deployment can actually send, and where uploads land. */
export async function capabilities(req, res, next) {
  try { return ok(res, { messaging: messaging.messagingCapabilities(), storage: storageInfo() }) }
  catch (error) { return next(error) }
}

/** Prove the SMTP settings connect, rather than discovering it on the first real send. */
export async function testConnection(req, res, next) {
  try {
    const result = await verifyMailTransport()
    return ok(res, result, result.ok ? `Connected to ${result.host}:${result.port}.` : result.reason)
  } catch (error) { return next(error) }
}

export async function listDeliveries(req, res, next) {
  try {
    const { page, pageSize, ...filters } = req.validatedQuery
    return ok(res, await messaging.listDeliveries({ page, pageSize, ...filters }))
  } catch (error) { return next(error) }
}

/** Send a template to one address, to check it renders and arrives. */
export async function sendTest(req, res, next) {
  try {
    const outcome = await messaging.send(req.body.key, {
      to: req.body.to,
      channel: req.body.channel ?? 'email',
      // Placeholder values so the operator sees the shape, clearly marked as a sample.
      variables: {
        customerName: 'Sample Customer', sellerName: 'Sample Seller', storeName: 'Sample Store',
        orderNumber: 'MW-000000', total: 'Rs. 0', productName: 'Sample Product',
        reason: 'Sample reason', documentType: 'CNIC — front', outcome: 'approved',
        note: 'This is a test message.', code: '000000',
      },
    })
    await recordAudit(req, {
      action: AUDIT.TEST_MESSAGE_SENT, entityType: 'message_template', entityId: req.body.key,
      metadata: { to: req.body.to, status: outcome.status },
    })
    const message = outcome.status === 'sent'
      ? `Test message sent to ${req.body.to}.`
      : outcome.status === 'skipped'
        ? `Nothing was sent: ${outcome.error}`
        : `Delivery failed: ${outcome.error}`
    return ok(res, outcome, message)
  } catch (error) { return next(error) }
}

// --- Seller documents: admin side --------------------------------------------

export async function listDocumentsAdmin(req, res, next) {
  try {
    const { page, pageSize, status } = req.validatedQuery
    return ok(res, await documents.listForAdmin({ page, pageSize, status }))
  } catch (error) { return next(error) }
}

export async function reviewDocument(req, res, next) {
  try {
    const result = await documents.review(req.params.id, req.body, req.user.id)
    await recordAudit(req, {
      action: result.status === 'approved' ? AUDIT.DOCUMENT_APPROVED : AUDIT.DOCUMENT_REJECTED,
      entityType: 'seller_document', entityId: req.params.id,
      metadata: { store: result.storeName, from: result.previousStatus, to: result.status },
    })
    return ok(res, result, `Document ${result.status}. The seller has been emailed.`)
  } catch (error) { return next(error) }
}

/** Staff download. Streamed inline; never a redirect to a static path. */
export async function downloadDocumentAdmin(req, res, next) {
  try {
    const file = await documents.download(req.params.id)
    return streamDocument(res, file)
  } catch (error) { return next(error) }
}

// --- Seller documents: seller side -------------------------------------------

export async function listDocumentsSeller(req, res, next) {
  try { return ok(res, await documents.listForSeller(req.seller.id)) }
  catch (error) { return next(error) }
}

export async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      return next(Object.assign(new Error('Choose a file to upload.'), { status: 400, code: 'NO_FILE', expose: true }))
    }
    const result = await documents.upload(req.seller.id, {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      docType: req.body.docType,
    })
    return ok(
      res,
      result,
      result.replaced
        ? 'Uploaded. It replaces the document you previously sent for this type and is awaiting review.'
        : 'Uploaded and awaiting review by Mirwal.',
      201,
    )
  } catch (error) { return next(error) }
}

export async function downloadDocumentSeller(req, res, next) {
  try {
    const file = await documents.download(req.params.id, { sellerId: req.seller.id })
    return streamDocument(res, file)
  } catch (error) { return next(error) }
}

export async function deleteDocument(req, res, next) {
  try {
    await documents.remove(req.seller.id, req.params.id)
    return ok(res, null, 'Document removed.')
  } catch (error) { return next(error) }
}

/**
 * Stream a document back.
 *
 * `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` together stop a
 * browser rendering an uploaded file inline in Mirwal's own origin — which is how an
 * uploaded HTML or SVG file becomes stored XSS.
 */
function streamDocument(res, file) {
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Length', file.size)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`)
  // Identity documents must never sit in a shared or browser cache.
  res.setHeader('Cache-Control', 'private, no-store')
  return file.stream.pipe(res)
}
