import { randomUUID } from 'node:crypto'

/**
 * Assign every request a stable id, echoed in the response header and in every error body.
 * This is what makes a user-visible error traceable to a server log line without exposing
 * anything internal in the response itself.
 */
export function requestId(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID()
  res.set('x-request-id', req.id)
  next()
}
