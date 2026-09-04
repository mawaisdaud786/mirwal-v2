import { z } from 'zod'
import { DECISION_CODES } from './applications.service.js'

/**
 * Seller application input.
 *
 * The shape is permissive about *which* fields are present and strict about their contents.
 * Which fields are required depends on the seller type, and that rule lives in
 * `assertTypeRequirements` in the service rather than in a Zod refinement — the service is
 * also reached by resubmission, and a rule expressed once cannot drift between the two paths.
 *
 * CNIC and NTN are normalised here rather than validated as typed. A Pakistani applicant will
 * type their CNIC as 12345-6789012-3, because that is how it is printed on the card; refusing
 * that and demanding 13 bare digits is a form nobody can fill in. Stripping the separators is
 * the whole difference.
 */

const digitsOnly = (value) => (typeof value === 'string' ? value.replace(/\D/g, '') : value)
const trimmed = (max) => z.string().trim().max(max)

export const PROVINCES = [
  'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan',
  'Gilgit-Baltistan', 'Azad Jammu & Kashmir', 'Islamabad Capital Territory',
]

const applicationBody = z.object({
  sellerType: z.enum(['individual', 'business']),

  applicantName: z.string().trim().min(2, 'Enter your full name.').max(150),
  applicantEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(255),
  // E.164 or the local 03XX form; normalised to digits so two spellings of one number cannot
  // both be stored.
  applicantPhone: z.string().trim().min(10, 'Enter a valid mobile number.').max(20),

  cnic: z.preprocess(digitsOnly, z.string().regex(/^\d{13}$/, 'A CNIC is 13 digits.').optional().nullable()).optional().nullable(),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional().nullable(),

  storeName: z.string().trim().min(2, 'Enter a store name.').max(150),
  legalName: trimmed(200).optional().default(''),
  businessType: z.enum(['sole_proprietor', 'partnership', 'private_limited', 'other']).optional().nullable(),
  businessRegNo: trimmed(60).optional().nullable(),
  ntn: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s/g, '') : value),
    trimmed(20).optional().nullable(),
  ).optional().nullable(),
  strn: trimmed(30).optional().nullable(),

  addressLine1: z.string().trim().min(3, 'Enter your address.').max(255),
  addressLine2: trimmed(255).optional().default(''),
  city: z.string().trim().min(2, 'Enter your city.').max(100),
  province: z.string().trim().min(2, 'Select your province.').max(100),
  postalCode: trimmed(20).optional().default(''),
  countryCode: z.string().trim().length(2).toUpperCase().optional().default('PK'),

  categories: trimmed(255).optional().default(''),
  website: trimmed(255).optional().default(''),
  notes: trimmed(2000).optional().default(''),
  heardFrom: trimmed(60).optional().default(''),

  // Acceptance is recorded with the agreement version, so which terms were accepted is
  // provable later. A submission that does not accept them is not an application.
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the seller agreement.' }) }),
})

export const submitApplicationSchema = applicationBody
export const resubmitApplicationSchema = applicationBody

export const applicationIdSchema = z.object({
  id: z.string().trim().min(1).max(36),
})

export const listApplicationsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  status: z.enum(['draft', 'submitted', 'in_review', 'more_info_required', 'approved', 'rejected', 'withdrawn', 'expired']).optional(),
  sellerType: z.enum(['individual', 'business']).optional(),
  search: z.string().trim().max(120).optional(),
})

export const requestInfoSchema = z.object({
  message: z.string().trim().min(10, 'Say what the applicant needs to supply.').max(1000),
  code: z.enum(Object.keys(DECISION_CODES)).optional(),
})

export const rejectApplicationSchema = z.object({
  code: z.enum(Object.keys(DECISION_CODES)),
  note: z.string().trim().max(1000).optional().nullable(),
})

export const approveApplicationSchema = z.object({
  note: z.string().trim().max(1000).optional().nullable(),
})
