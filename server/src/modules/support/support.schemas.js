import { z } from 'zod'

const publicId = z.string().trim().uuid()

export const ticketIdSchema = z.object({ id: publicId })

export const listTicketsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  search: z.string().trim().max(120).optional(),
})

export const createTicketSchema = z.object({
  subject: z.string().trim().min(4, 'Give the request a subject.').max(200),
  message: z.string().trim().min(10, 'Describe the problem in at least 10 characters.').max(10000),
  category: z.enum(['general', 'orders', 'payments', 'products', 'account', 'technical']).default('general'),
  // A requester may say how urgent it feels; staff can re-triage it afterwards. Deliberately
  // excludes 'urgent' — self-declared urgency on every ticket makes the queue meaningless.
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
})

/**
 * A reply.
 *
 * `isInternal` is accepted here but the service rejects it for non-staff — validation shapes
 * the request, authorization decides who may use the field.
 */
export const addMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  isInternal: z.boolean().default(false),
})

/** Staff-only triage fields. */
export const updateTicketSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedTo: publicId.nullish(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })
