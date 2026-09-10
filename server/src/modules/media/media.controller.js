import multer from 'multer'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { ok, okPage, badRequest } from '../../lib/errors.js'
import * as service from './media.service.js'

/**
 * Image upload endpoints.
 *
 * Buffered in memory for the same reason document uploads are: the type is decided from the
 * file's own leading bytes, and that decision has to happen before anything is written. Saving
 * to disk first would mean writing a file we have not yet agreed to accept.
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.media.maxBytes, files: 1 },
}).single('file')

export const uploadQuerySchema = z.object({
  purpose: z.enum(['product', 'store_logo', 'store_banner', 'category', 'banner', 'other'])
    .optional().default('other'),
})

export const listMediaSchema = z.object({
  purpose: z.enum(['product', 'store_logo', 'store_banner', 'category', 'banner', 'other']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const setProductImagesSchema = z.object({
  images: z.array(z.object({
    assetId: z.string().trim().min(1).max(36),
    // Required for accessibility and image SEO. An empty string is allowed and means
    // "decorative" — the same convention `product_images.alt_text` already documents.
    altText: z.string().trim().max(255).optional().default(''),
  })).max(service.MAX_IMAGES_PER_PRODUCT),
})

export async function upload(req, res, next) {
  try {
    if (!req.file) {
      throw badRequest('Attach an image to upload.', 'FILE_REQUIRED')
    }
    const result = await service.upload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      purpose: req.validatedQuery?.purpose ?? 'other',
      sellerId: req.seller?.id ?? null,
      userId: req.user?.id ?? null,
    })
    return ok(
      res,
      result,
      result.reused ? 'You had already uploaded this image — reusing it.' : 'Image uploaded.',
      result.reused ? 200 : 201,
    )
  } catch (error) { return next(error) }
}

export async function list(req, res, next) {
  try {
    const { page, pageSize, purpose } = req.validatedQuery
    const { items, total } = await service.listForSeller(req.seller.id, { page, pageSize, purpose })
    return okPage(res, items, { page, pageSize, total })
  } catch (error) { return next(error) }
}

export async function setProductImages(req, res, next) {
  try {
    const result = await service.setProductImages(req.seller.id, req.params.id, req.body.images)
    return ok(res, result, 'Product images saved.')
  } catch (error) { return next(error) }
}

export async function remove(req, res, next) {
  try { return ok(res, await service.remove(req.seller.id, req.params.id), 'Image deleted.') }
  catch (error) { return next(error) }
}

/**
 * Translate multer's own errors into the API's error shape.
 *
 * Without this a file over the limit surfaces as an unhandled 500 with a stack trace, when the
 * honest answer is a 400 telling the seller their photo is too big.
 */
export function uploadErrorHandler(error, _req, _res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(env.media.maxBytes / (1024 * 1024))
      return next(badRequest(`Images must be ${mb}MB or smaller.`, 'FILE_TOO_LARGE'))
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(badRequest('Upload one image at a time.', 'TOO_MANY_FILES'))
    }
    return next(badRequest(error.message, 'UPLOAD_FAILED'))
  }
  return next(error)
}
