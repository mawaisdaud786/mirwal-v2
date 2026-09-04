import { z } from 'zod'

const publicId = z.string().trim().uuid()

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}

export const idParamSchema = z.object({ id: publicId })

export const listTemplatesSchema = z.object({
  channel: z.enum(['email', 'sms']).optional(),
})

export const templateParamSchema = z.object({
  key: z.string().trim().max(80).regex(/^[a-z0-9._-]+$/i),
  channel: z.enum(['email', 'sms']),
})

/**
 * A template edit.
 *
 * The body is stored and later rendered into an email, so it is deliberately capped rather
 * than unbounded — and the service separately checks that every `{{placeholder}}` used is one
 * the sending code actually supplies.
 */
export const updateTemplateSchema = z.object({
  subject: z.string().trim().max(255).nullish(),
  body: z.string().trim().min(1).max(20000).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to update.' })

export const listDeliveriesSchema = z.object({
  ...pageQuery,
  status: z.enum(['queued', 'sent', 'failed', 'skipped']).optional(),
  channel: z.enum(['email', 'sms']).optional(),
  search: z.string().trim().max(160).optional(),
})

export const sendTestSchema = z.object({
  key: z.string().trim().max(80).regex(/^[a-z0-9._-]+$/i),
  channel: z.enum(['email', 'sms']).default('email'),
  // Not validated as an email: the SMS channel takes a phone number.
  to: z.string().trim().min(3).max(255),
})

// --- Seller documents --------------------------------------------------------

export const DOC_TYPES = [
  'cnic_front', 'cnic_back', 'business_registration', 'tax_certificate', 'bank_statement', 'other',
]

export const listDocumentsSchema = z.object({
  ...pageQuery,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
})

/**
 * The multipart form field alongside the file.
 *
 * The file itself is not described here — its type is decided by inspecting its leading
 * bytes in `storage.js`, never by anything the client declares.
 */
export const uploadDocumentSchema = z.object({
  docType: z.enum(DOC_TYPES),
})

export const reviewDocumentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
}).refine(
  // A rejected document the seller cannot act on is worse than no review at all.
  (value) => value.status !== 'rejected' || (value.note && value.note.length >= 3),
  { message: 'Say why the document was rejected — the seller sees this.', path: ['note'] },
)
