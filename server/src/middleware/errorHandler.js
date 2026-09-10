import { AppError } from '../lib/errors.js'
import { env } from '../config/env.js'
import { recordSystemLog } from '../modules/admin/operations.service.js'

/**
 * The only place an error becomes an HTTP response.
 *
 * Rule: an error is surfaced to the client ONLY if it was deliberately thrown as an
 * AppError. Everything else — driver errors, programming mistakes, anything with a SQL
 * message or a file path in it — is logged in full server-side and replaced with a generic
 * 500. Users get a requestId they can quote; they never get a stack trace, a table name,
 * or a query.
 */

/** MariaDB driver errors that map cleanly onto a user-safe response. */
function fromDatabaseError(error) {
  switch (error.code) {
    case 'ER_DUP_ENTRY':
      return new AppError('ALREADY_EXISTS', 'That value is already in use.', 409)
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return new AppError('INVALID_REFERENCE', 'A referenced record does not exist.', 400)
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new AppError('IN_USE', 'This record is still referenced by other data.', 409)
    case 'ER_CONSTRAINT_FAILED':
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return new AppError('CONSTRAINT_FAILED', 'That change is not allowed by the data rules.', 400)
    case 'ER_DATA_TOO_LONG':
      return new AppError('VALUE_TOO_LONG', 'One of the values is too long.', 400)
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ER_CON_COUNT_ERROR':
      return new AppError('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.', 503)
    default:
      return null
  }
}

export function errorHandler(error, req, res, _next) {
  let appError = error instanceof AppError ? error : null

  if (!appError && error?.code) appError = fromDatabaseError(error)

  if (!appError && error?.name === 'TokenExpiredError') {
    appError = new AppError('TOKEN_EXPIRED', 'Your session has expired. Please sign in again.', 401)
  }
  if (!appError && error?.name === 'JsonWebTokenError') {
    appError = new AppError('TOKEN_INVALID', 'Your session is not valid. Please sign in again.', 401)
  }
  if (!appError && error?.type === 'entity.too.large') {
    appError = new AppError('PAYLOAD_TOO_LARGE', 'That request was too large.', 413)
  }
  if (!appError && error?.type === 'entity.parse.failed') {
    appError = new AppError('INVALID_JSON', 'The request body was not valid JSON.', 400)
  }

  // Log everything unexpected in full, with the request id for correlation.
  if (!appError || appError.status >= 500) {
    console.error(
      `[${new Date().toISOString()}] requestId=${req.id} ${req.method} ${req.originalUrl}\n`,
      error,
    )
    // Also persist it, so the admin panel's Error Logs page reports what actually broke
    // rather than nothing. Deliberately 5xx only: recording every 400 would bury real
    // failures under ordinary validation noise. Not awaited and never throws — a logging
    // problem must not stop this handler returning the response.
    recordSystemLog({
      level: 'error',
      code: appError?.code ?? error?.code ?? 'INTERNAL_ERROR',
      message: appError?.message ?? error?.message ?? 'Unhandled error',
      method: req.method,
      path: req.originalUrl,
      statusCode: appError?.status ?? 500,
      userId: req.user?.id ?? null,
      requestId: req.id,
      ip: req.ip,
      // The stack only — never the request body, which carries addresses and, on the auth
      // routes, passwords.
      context: error?.stack ? { stack: String(error.stack).split('\n').slice(0, 12) } : null,
    })
  } else if (env.logLevel === 'debug') {
    console.warn(`[${req.id}] ${appError.code}: ${appError.message}`)
  }

  const status = appError?.status ?? 500
  const body = {
    success: false,
    error: {
      code: appError?.code ?? 'INTERNAL_ERROR',
      message: appError?.message ?? 'Something went wrong on our side. Please try again.',
      ...(appError?.details ? { details: appError.details } : {}),
    },
    requestId: req.id,
  }

  res.status(status).json(body)
}
