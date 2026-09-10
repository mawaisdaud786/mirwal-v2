import { z } from 'zod'
import { ok } from '../../lib/errors.js'
import * as service from './customers.service.js'

export async function getCustomers(req, res, next) {
  try {
    const params = req.validatedQuery ?? {}
    const result = await service.getCustomers(req.seller.id, params)
    return ok(res, { customers: result.customers, summary: result.summary, pagination: {
      page: params.page ?? 1, pageSize: params.pageSize ?? 25, total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / (params.pageSize ?? 25))),
    } })
  }
  catch (error) { return next(error) }
}

export const listCustomersSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().trim().max(120).optional().default(''),
})
