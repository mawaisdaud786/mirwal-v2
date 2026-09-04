import { query, queryOne } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'

/**
 * A seller's own store.
 *
 * `GET /seller/me/store` existed and returned three fields; there was no PATCH at all. The
 * seller panel carries eight store-profile routes — information, business, branding, contact,
 * policies, hours, SEO, preview — none of which could save anything, so 600 lines of form
 * were decoration.
 *
 * The interesting decisions are about what a seller may change *without* re-verification:
 *
 *   * Presentation is theirs. Description, logo, banner, support contact, policies, hours,
 *     SEO — a seller should never need to ask permission to write better copy.
 *
 *   * Identity is not. Legal name, CNIC, NTN and business registration were checked against
 *     documents; letting a seller edit them afterwards would make the verified badge mean
 *     nothing, because a verified store could be renamed into an impersonation of a brand the
 *     day after approval. Those changes go through the KYC path, not this one.
 *
 *   * The storefront slug is one-way. It is a public URL that buyers bookmark, sellers print
 *     on packaging and search engines index; silently changing it breaks all three. A rename
 *     is possible, but it is an admin action with a redirect, not a form field.
 *
 * Store name sits between the two. It is presentation, but it is also how buyers identify who
 * they are buying from, so a change is allowed and recorded — and for a store carrying the
 * verified badge it drops the badge until someone looks at the new name, because "verified"
 * attached to an unreviewed name is exactly the impersonation route above.
 */

const MAX = {
  storeName: 150,
  description: 5000,
  supportEmail: 255,
  supportPhone: 20,
  policy: 5000,
  metaTitle: 180,
  metaDescription: 320,
  url: 500,
}

/** The seller's full view of their own store. */
export async function getStore(sellerId) {
  const row = await queryOne(
    `SELECT s.*, u.full_name AS owner_name, u.email AS owner_email,
            u.email_verified_at, u.phone_verified_at
       FROM sellers s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [sellerId],
  )
  if (!row) throw notFound('Store not found.')

  const bank = await queryOne(
    `SELECT status FROM seller_bank_accounts
      WHERE seller_id = ? AND is_default = 1 AND status <> 'archived'`,
    [sellerId],
  )
  const documents = await query(
    `SELECT doc_type, status, expires_at FROM seller_documents
      WHERE seller_id = ? AND deleted_at IS NULL AND status <> 'superseded'`,
    [sellerId],
  )

  return {
    id: row.public_id,
    slug: row.slug,
    name: row.store_name,
    status: row.status,
    sellerType: row.seller_type,
    verificationLevel: row.verification_level,
    verifiedBadge: Boolean(row.verified_badge),
    description: row.description,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    support: { email: row.support_email, phone: row.support_phone },
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      province: row.province,
      postalCode: row.postal_code,
      countryCode: row.country_code,
    },
    seo: { metaTitle: row.meta_title ?? null, metaDescription: row.meta_description ?? null },
    vacation: { enabled: Boolean(row.vacation_mode), message: row.vacation_message },
    payoutHold: { active: Boolean(row.payout_hold), reason: row.payout_hold_reason },
    restriction: row.status === 'restricted'
      ? { until: row.restricted_until, reason: row.restricted_reason }
      : null,
    // Identity is shown but flagged as not editable here, so the UI can render it read-only
    // with a link to the KYC path rather than offering an input that would be rejected.
    identity: {
      legalName: row.legal_name,
      businessType: row.business_type,
      editable: false,
      changeVia: 'verification',
    },
    rating: { average: Number(row.rating_average), count: row.rating_count },
    productCount: Number(row.product_count),
    owner: { name: row.owner_name, email: row.owner_email },
    verification: {
      emailVerified: Boolean(row.email_verified_at),
      phoneVerified: Boolean(row.phone_verified_at),
      bankAccount: bank?.status ?? null,
      documents: documents.map((doc) => ({ type: doc.doc_type, status: doc.status, expiresAt: doc.expires_at })),
    },
    createdAt: row.created_at,
  }
}

/**
 * Update the presentational parts of a store.
 *
 * Only fields present in the patch are touched, so a form that posts one section cannot blank
 * out another — the same reason `updateSettings` applies a partial map rather than replacing a
 * document.
 */
export async function updateStore(sellerId, patch) {
  const seller = await queryOne(
    'SELECT id, store_name, verified_badge, status FROM sellers WHERE id = ?',
    [sellerId],
  )
  if (!seller) throw notFound('Store not found.')

  const sets = []
  const params = []
  const push = (column, value) => { sets.push(`${column} = ?`); params.push(value) }

  let badgeDropped = false

  if (patch.name !== undefined) {
    const name = String(patch.name).trim()
    if (name.length < 2) throw badRequest('A store name needs at least two characters.', 'NAME_TOO_SHORT')
    if (name.length > MAX.storeName) throw badRequest('That store name is too long.', 'NAME_TOO_LONG')

    if (name !== seller.store_name) {
      await assertStoreNameAvailable(name, sellerId)
      push('store_name', name)
      // See the module comment: a verified badge is a statement about a name that was checked.
      if (seller.verified_badge) {
        push('verified_badge', 0)
        badgeDropped = true
      }
    }
  }

  if (patch.description !== undefined) push('description', truncate(patch.description, MAX.description))
  if (patch.logoUrl !== undefined) push('logo_url', assertUrl(patch.logoUrl, 'logoUrl'))
  if (patch.bannerUrl !== undefined) push('banner_url', assertUrl(patch.bannerUrl, 'bannerUrl'))
  if (patch.supportEmail !== undefined) push('support_email', truncate(patch.supportEmail, MAX.supportEmail))
  if (patch.supportPhone !== undefined) push('support_phone', truncate(patch.supportPhone, MAX.supportPhone))

  if (patch.city !== undefined) push('city', truncate(patch.city, 100))
  if (patch.addressLine1 !== undefined) push('address_line1', truncate(patch.addressLine1, 255))
  if (patch.addressLine2 !== undefined) push('address_line2', truncate(patch.addressLine2, 255))
  if (patch.province !== undefined) push('province', truncate(patch.province, 100))
  if (patch.postalCode !== undefined) push('postal_code', truncate(patch.postalCode, 20))

  if (patch.metaTitle !== undefined) push('meta_title', truncate(patch.metaTitle, MAX.metaTitle))
  if (patch.metaDescription !== undefined) push('meta_description', truncate(patch.metaDescription, MAX.metaDescription))

  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE sellers SET ${sets.join(', ')} WHERE id = ?`, [...params, sellerId])

  return {
    updated: sets.length - 1,
    badgeDropped,
    // Said plainly rather than left for the seller to discover: losing a badge silently after
    // a rename would read as a bug or a punishment.
    notice: badgeDropped
      ? 'Your verified badge is paused while Mirwal reviews the new store name.'
      : null,
  }
}

/**
 * Vacation mode.
 *
 * Separate from `updateStore` because it has a real consequence — checkout refuses new orders
 * for this seller — and burying a switch with that effect among branding fields is how it gets
 * toggled by accident.
 */
export async function setVacationMode(sellerId, { enabled, message }) {
  await query(
    'UPDATE sellers SET vacation_mode = ?, vacation_message = ?, updated_at = NOW(3) WHERE id = ?',
    [enabled ? 1 : 0, enabled ? truncate(message, 255) : null, sellerId],
  )
  return {
    vacationMode: Boolean(enabled),
    // Existing orders are unaffected, and saying so is what makes a seller willing to use this
    // instead of quietly cancelling.
    notice: enabled
      ? 'Your store is paused. Existing orders still need to be fulfilled.'
      : 'Your store is accepting orders again.',
  }
}

/**
 * Store name uniqueness.
 *
 * Not a database constraint, on purpose: two shops genuinely called "Al Madina Traders" is an
 * ordinary situation in Pakistan and refusing the second outright would be wrong. What is not
 * ordinary is two stores with the *same* name, which makes them indistinguishable to buyers
 * and is the shape an impersonation takes.
 */
async function assertStoreNameAvailable(name, sellerId) {
  const clash = await queryOne(
    `SELECT id FROM sellers
      WHERE store_name = ? AND id <> ? AND deleted_at IS NULL
        AND status IN ('approved','restricted','suspended')`,
    [name, sellerId],
  )
  if (clash) {
    throw conflict(
      'Another Mirwal store already uses that name. Please choose a different one.',
      'STORE_NAME_TAKEN',
    )
  }
}

/**
 * Only accept a URL this server produced.
 *
 * A logo field that accepts any URL is a way to make Mirwal's pages load — and therefore vouch
 * for — content from somewhere else entirely, and to leak every viewer's IP to a third party.
 * Uploads go through the media endpoint and come back as a relative path; that is what this
 * accepts.
 */
function assertUrl(value, field) {
  if (value === null || value === '') return null
  const url = String(value).trim()
  if (url.length > MAX.url) throw badRequest('That image reference is too long.', 'URL_TOO_LONG')
  if (!url.startsWith('/')) {
    throw badRequest(
      'Images must be uploaded to Mirwal rather than linked from another site.',
      'EXTERNAL_URL_REFUSED',
      [{ field, message: 'Upload the image instead of pasting a link.' }],
    )
  }
  return url
}

const truncate = (value, max) => (value == null ? null : String(value).trim().slice(0, max) || null)
