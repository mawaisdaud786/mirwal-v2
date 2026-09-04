import { z } from 'zod'

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(255)

// Length beats composition rules for real-world strength; 8 is the floor the existing
// signup form already advertises.
const password = z.string().min(8, 'Password must be at least 8 characters.').max(200)

// Pakistan mobile numbers, accepted as 03xxxxxxxxx or +923xxxxxxxxx.
const phone = z.string().trim()
  .regex(/^(\+92|0)3\d{9}$/, 'Enter a valid Pakistani mobile number, e.g. 03001234567.')
  .transform((value) => (value.startsWith('0') ? `+92${value.slice(1)}` : value))

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name.').max(150),
  email,
  password,
  phone: phone.optional(),
})

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(200),
  /**
   * The second factor, when the account has one.
   *
   * Optional on purpose: the first attempt is made without it, and the API replies
   * TWO_FACTOR_REQUIRED so the form knows to ask. Sending a code speculatively would tell an
   * attacker which accounts are enrolled.
   *
   * Longer than six characters is allowed because a recovery code is accepted here too.
   */
  totpCode: z.string().trim().max(20).optional(),
})

/** Name and phone only — email, status and roles are deliberately not editable here. */
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  phone: z.string().trim().max(20).optional().default(''),
})

/**
 * Changing a password.
 *
 * The current password is required even though the caller is signed in: a live session is
 * not proof of identity when the screen may simply have been left unlocked.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(200),
  newPassword: password,
}).refine(
  (value) => value.currentPassword !== value.newPassword,
  { message: 'Choose a password you have not used here before.', path: ['newPassword'] },
)

export const sessionIdSchema = z.object({ id: z.coerce.number().int().positive() })

// --- Password reset ---------------------------------------------------------

export const requestResetSchema = z.object({ email })

export const resetPasswordSchema = z.object({
  // The raw token from the emailed link. Length-bounded so a huge body cannot be used to
  // make the hash comparison expensive.
  token: z.string().trim().min(20).max(200),
  password,
})
