import { z } from 'zod'
import { env } from '../../config/env.js'
import { ok } from '../../lib/errors.js'
import * as service from './verification.service.js'

/**
 * Email and phone verification endpoints.
 *
 * The confirm-by-link route is deliberately unauthenticated. A verification link is clicked
 * from an inbox, which is very often not the browser the account was created in; requiring a
 * session there would make the link fail for exactly the people most likely to use it. The
 * token is the proof — unguessable, single-use, short-lived — so a session adds nothing.
 */

export const purposeSchema = z.object({
  purpose: z.enum(['email', 'phone']),
})

export const confirmSchema = z.object({
  purpose: z.enum(['email', 'phone']),
  code: z.string().trim().min(4).max(200),
})

export const confirmLinkSchema = z.object({
  token: z.string().trim().min(10).max(200),
})

export async function status(req, res, next) {
  try { return ok(res, await service.verificationStatus(req.user.id)) }
  catch (error) { return next(error) }
}

export async function request(req, res, next) {
  try {
    const result = await service.requestVerification(req.user.id, req.body.purpose, {
      // Where the link points. Taken from configuration, never from the request — a
      // caller-supplied base URL turns a verification email into a phishing link that
      // Mirwal sends on the attacker's behalf.
      appUrl: env.corsOrigins[0] ?? '',
    })
    return ok(res, result, result.purpose === 'email'
      ? 'Check your inbox for a confirmation link.'
      : 'We sent you a code by SMS.')
  } catch (error) { return next(error) }
}

export async function confirm(req, res, next) {
  try {
    const result = await service.confirmVerification(req.user.id, req.body.purpose, req.body.code)
    return ok(res, result, result.purpose === 'email'
      ? 'Your email address is confirmed.'
      : 'Your mobile number is confirmed.')
  } catch (error) { return next(error) }
}

export async function confirmLink(req, res, next) {
  try {
    const result = await service.confirmEmailByToken(req.body.token)
    return ok(res, result, 'Your email address is confirmed.')
  } catch (error) { return next(error) }
}
