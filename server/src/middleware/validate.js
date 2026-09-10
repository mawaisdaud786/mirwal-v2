import { badRequest } from '../lib/errors.js'

/**
 * Validate and REPLACE the named request property with the parsed result.
 *
 * Replacing rather than merging matters: the handler then sees only fields the schema
 * declared, so an attacker cannot smuggle extra keys (`role`, `seller_id`, `price`)
 * through into an update.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }))
      return next(badRequest('Some fields need attention.', 'VALIDATION_FAILED', details))
    }
    // req.query is a getter in Express 5; assign to a shadow property instead of throwing.
    if (source === 'query') req.validatedQuery = result.data
    else req[source] = result.data
    return next()
  }
}
