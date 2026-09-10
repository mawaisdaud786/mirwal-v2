import { query, queryOne } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { parseJsonColumn } from '../../lib/json.js'
import { getNumericSetting } from '../settings/settings.service.js'

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
    about: row.about ?? null,
    // Stored as JSON and returned parsed, so the form does not have to know it was a string.
    businessHours: parseJsonColumn(row.business_hours, null),
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

  if (patch.about !== undefined) push('about', truncate(patch.about, 20000))
  // Display-only, and never filtered or reported on — the same reasoning that makes variant
  // options JSON. Shape is validated at the schema, not here.
  if (patch.businessHours !== undefined) {
    push('business_hours', patch.businessHours ? JSON.stringify(patch.businessHours) : null)
  }
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

/**
 * Store policies.
 *
 * `store_policies` (migration 022) holds what a buyer is actually promised. The distinction
 * that shaped it: a return window and a dispatch time are *enforceable* — they can be shown on
 * a product page, checked against `order_items.shipped_at`, and quoted back in a dispute —
 * whereas a free-text "cancellation policy" is a paragraph nothing acts on.
 *
 * So the numeric fields are the substance and the text fields are the explanation, rather than
 * six paragraphs pretending to be rules.
 *
 * Every numeric field is nullable, meaning "use the platform default". That is deliberate: a
 * NULL is honest about the seller not having chosen, which a copied-in default value is not —
 * and it means raising the platform minimum later lifts every store that never overrode it.
 */
export async function getPolicies(sellerId) {
  const row = await queryOne('SELECT * FROM store_policies WHERE seller_id = ?', [sellerId])

  // Read alongside the seller's own values so the form can show what a blank field will
  // actually mean, rather than an empty box the seller has to guess about.
  const [platformWindow, platformDispatch] = await Promise.all([
    getNumericSetting('orders.return_window_days', { fallback: 7, max: 365 }),
    getNumericSetting('orders.dispatch_sla_hours', { fallback: 48, max: 8760 }),
  ])

  return {
    returnsAccepted: row ? Boolean(row.returns_accepted) : true,
    returnWindowDays: row?.return_window_days ?? null,
    returnShippingPaidBy: row?.return_shipping_paid_by ?? 'buyer',
    exchangeOffered: row ? Boolean(row.exchange_offered) : false,
    dispatchDays: row?.dispatch_days ?? null,
    warrantyText: row?.warranty_text ?? null,
    returnsText: row?.returns_text ?? null,
    shippingText: row?.shipping_text ?? null,
    defaults: {
      returnWindowDays: platformWindow,
      dispatchDays: Math.ceil(platformDispatch / 24),
    },
  }
}

/**
 * Save policies.
 *
 * Upserted, because a seller who has never opened this page has no row and should not need one
 * created by a separate call.
 *
 * The one rule enforced here rather than trusted: a seller may offer a *longer* return window
 * than Mirwal requires but never a shorter one. Buyer protection is Mirwal's promise, and a
 * seller cannot opt out of it by typing 2 into a box — so a shorter value is raised to the
 * platform minimum and the caller is told that happened.
 *
 * The patch is merged onto what is already stored before the upsert. Without that merge this
 * endpoint silently destroyed data: `ON DUPLICATE KEY UPDATE` writes every column, so sending
 * only `returnWindowDays` reset the dispatch promise and the return-postage rule back to their
 * defaults. Every field is optional in the schema, so a partial patch is not merely possible
 * but the normal case.
 */
export async function updatePolicies(sellerId, patch) {
  const platformWindow = await getNumericSetting('orders.return_window_days', { fallback: 7, max: 365 })

  const existing = await queryOne('SELECT * FROM store_policies WHERE seller_id = ?', [sellerId])
  const keep = (key, column, fallback) => (
    patch[key] !== undefined ? patch[key] : (existing ? existing[column] : fallback)
  )

  let clamped = false
  let windowDays = keep('returnWindowDays', 'return_window_days', null)
  if (windowDays != null && windowDays < platformWindow) {
    windowDays = platformWindow
    clamped = true
  }

  await query(
    `INSERT INTO store_policies
       (seller_id, returns_accepted, return_window_days, return_shipping_paid_by,
        exchange_offered, dispatch_days, warranty_text, returns_text, shipping_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       returns_accepted = VALUES(returns_accepted),
       return_window_days = VALUES(return_window_days),
       return_shipping_paid_by = VALUES(return_shipping_paid_by),
       exchange_offered = VALUES(exchange_offered),
       dispatch_days = VALUES(dispatch_days),
       warranty_text = VALUES(warranty_text),
       returns_text = VALUES(returns_text),
       shipping_text = VALUES(shipping_text),
       updated_at = NOW(3)`,
    [
      sellerId,
      keep('returnsAccepted', 'returns_accepted', 1) ? 1 : 0,
      windowDays,
      keep('returnShippingPaidBy', 'return_shipping_paid_by', 'buyer'),
      keep('exchangeOffered', 'exchange_offered', 0) ? 1 : 0,
      keep('dispatchDays', 'dispatch_days', null),
      truncate(keep('warrantyText', 'warranty_text', null), 2000),
      truncate(keep('returnsText', 'returns_text', null), 2000),
      truncate(keep('shippingText', 'shipping_text', null), 2000),
    ],
  )

  return {
    saved: true,
    notice: clamped
      ? `Mirwal's minimum return window is ${platformWindow} days, so that is what buyers will see.`
      : null,
  }
}

/**
 * A seller's identity details.
 *
 * These columns are filled when an application is approved and, until now, could never be
 * touched again: `updateStore` deliberately refuses them, because letting a seller rewrite a
 * legal name or a CNIC after verification would make the verified badge meaningless — a
 * verified store could be renamed into an impersonation the day after approval.
 *
 * But "never editable" is also wrong. A seller created before applications existed has none of
 * these. A CNIC gets mistyped. A sole trader registers a company and acquires an NTN. So the
 * rule is narrower than "no": **a blank field may be filled in freely; a field that has already
 * been verified may be changed, and doing so costs the verification it was carrying.**
 *
 * That trade is stated to the seller rather than applied silently — someone correcting a typo
 * needs to know it sends them back through review.
 */
export async function getKyc(sellerId) {
  const row = await queryOne(
    `SELECT seller_type, verification_level, verified_at, legal_name, cnic, date_of_birth,
            ntn, strn, business_reg_no, business_type
       FROM sellers WHERE id = ?`,
    [sellerId],
  )
  if (!row) throw notFound('Store not found.')

  const isBusiness = row.seller_type === 'business'
  const verified = row.verification_level !== 'none' && row.verification_level !== 'basic'

  return {
    sellerType: row.seller_type,
    verificationLevel: row.verification_level,
    verifiedAt: row.verified_at,
    // Masked, like every other identifier Mirwal shows back. A seller knows their own CNIC;
    // rendering it in full only creates something to be shoulder-surfed or screenshotted.
    cnic: row.cnic ? `${row.cnic.slice(0, 5)}•••••••${row.cnic.slice(-1)}` : null,
    dateOfBirth: row.date_of_birth,
    legalName: row.legal_name || null,
    ntn: row.ntn,
    strn: row.strn,
    businessRegNo: row.business_reg_no,
    businessType: row.business_type,
    // What is still outstanding for this seller type, so the panel can show a checklist rather
    // than a wall of optional boxes.
    missing: [
      !row.cnic && 'cnic',
      !row.date_of_birth && 'dateOfBirth',
      isBusiness && !row.legal_name && 'legalName',
      isBusiness && !row.ntn && 'ntn',
      isBusiness && row.business_type === 'private_limited' && !row.business_reg_no && 'businessRegNo',
    ].filter(Boolean),
    // Changing any of these once verified sends the store back through review.
    locked: verified,
  }
}

/** Fields whose change costs verification, mapped to their column. */
const IDENTITY_COLUMNS = {
  cnic: 'cnic',
  dateOfBirth: 'date_of_birth',
  legalName: 'legal_name',
  ntn: 'ntn',
  strn: 'strn',
  businessRegNo: 'business_reg_no',
  businessType: 'business_type',
}

export async function updateKyc(sellerId, patch) {
  const current = await queryOne(
    `SELECT verification_level, verified_badge, cnic, date_of_birth, legal_name, ntn, strn,
            business_reg_no, business_type
       FROM sellers WHERE id = ?`,
    [sellerId],
  )
  if (!current) throw notFound('Store not found.')

  const sets = []
  const params = []
  const changedVerified = []

  for (const [field, column] of Object.entries(IDENTITY_COLUMNS)) {
    if (patch[field] === undefined) continue

    const next = field === 'cnic'
      // Accepted as printed on the card — 12345-6789012-3 — because demanding thirteen bare
      // digits is a form nobody can fill in.
      ? String(patch[field] ?? '').replace(/\D/g, '')
      : patch[field]

    if (field === 'cnic' && next && !/^\d{13}$/.test(next)) {
      throw badRequest('A CNIC is 13 digits.', 'INVALID_CNIC', [{ field: 'cnic', message: 'Check the number on your card.' }])
    }

    const before = current[column]
    if (String(before ?? '') === String(next ?? '')) continue

    // Filling a blank is free. Changing something that was checked is not.
    if (before) changedVerified.push(field)

    sets.push(`${column} = ?`)
    params.push(next || null)
  }

  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  /**
   * A changed identity is an unverified identity.
   *
   * Dropping the level and the badge together is the whole point: a badge that survives a
   * change of legal name is a badge that says nothing. Documents are not invalidated — the
   * reviewer decides whether the ones on file still support the new details.
   */
  const wasVerified = current.verification_level !== 'none' && current.verification_level !== 'basic'
  const downgrade = wasVerified && changedVerified.length > 0

  if (downgrade) {
    sets.push("verification_level = 'basic'", 'verified_badge = 0', 'verified_at = NULL')
  }

  sets.push('updated_at = NOW(3)')

  try {
    await query(`UPDATE sellers SET ${sets.join(', ')} WHERE id = ?`, [...params, sellerId])
  } catch (error) {
    // `uq_sellers_cnic` / `uq_sellers_ntn`: one identity, one store. The constraint is what
    // actually wins the race; this turns it into a sentence a seller can act on.
    if (error.code === 'ER_DUP_ENTRY') {
      throw conflict(
        'Another Mirwal store is already registered to those details. Contact support if that is wrong.',
        'IDENTITY_ALREADY_REGISTERED',
      )
    }
    throw error
  }

  return {
    updated: changedVerified.length || sets.length - 1,
    downgraded: downgrade,
    notice: downgrade
      ? 'Your details changed, so your store is back in review. Your documents are still on file.'
      : null,
  }
}
