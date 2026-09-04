/**
 * Application errors and the single response envelope used by every endpoint.
 *
 * The contract matches the one drafted in the project brief:
 *   success: { success: true,  data, message? }
 *   failure: { success: false, error: { code, message }, requestId }
 *
 * `code` is a stable machine-readable string the frontend can branch on. `message` is safe
 * to show a user. Nothing internal — SQL text, stack traces, file paths, driver errors —
 * ever reaches the client; see middleware/errorHandler.js.
 */

export class AppError extends Error {
  /**
   * @param {string} code    stable identifier, e.g. PRODUCT_NOT_FOUND
   * @param {string} message user-safe text
   * @param {number} status  HTTP status
   * @param {object} [details] optional field-level detail, only used for validation
   */
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
    // Marks this as deliberately thrown, so the handler knows it is safe to surface.
    this.expose = true
  }
}

export const badRequest   = (message, code = 'BAD_REQUEST', details) => new AppError(code, message, 400, details)
export const unauthorized = (message = 'Authentication is required.', code = 'UNAUTHENTICATED') => new AppError(code, message, 401)
export const forbidden    = (message = 'You do not have access to this resource.', code = 'FORBIDDEN') => new AppError(code, message, 403)
export const notFound     = (message = 'Resource not found.', code = 'NOT_FOUND') => new AppError(code, message, 404)
export const conflict     = (message, code = 'CONFLICT') => new AppError(code, message, 409)
export const tooMany      = (message = 'Too many requests. Please try again shortly.', code = 'RATE_LIMITED') => new AppError(code, message, 429)

/** Success envelope. */
export function ok(res, data, message, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    ...(message ? { message } : {}),
  })
}

/**
 * Success envelope for a paginated collection.
 *
 * `extra` merges alongside `items` for the summary a list page needs with its first request —
 * queue counts, totals — so a table and its KPI row are one round trip rather than two that
 * can disagree with each other.
 */
export function okPage(res, items, { page, pageSize, total }, message, extra) {
  return res.status(200).json({
    success: true,
    data: {
      items,
      ...(extra ?? {}),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        hasNext: page * pageSize < total,
      },
    },
    ...(message ? { message } : {}),
  })
}
