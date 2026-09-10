import { randomUUID } from 'node:crypto'
import { query, queryOne } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { createNotification } from '../notifications/notifications.service.js'

/**
 * Who may list against a brand.
 *
 * Any seller could attach any brand to any listing. That is the primary counterfeit vector on
 * a Pakistani marketplace — it is how "Apple" and "Nike" listings from unauthorised sellers
 * reach search results — and migration 023 created `brand_authorizations` to close it while
 * nothing ever read the table.
 *
 * **Gating is per brand, not global.** Most brands on Mirwal are small and unprotected, and
 * requiring paperwork for every one of them would stop the catalogue growing for no safety
 * gain. A brand is marked `is_gated` by an admin, and only then does listing against it need
 * an authorisation. That keeps the control where the risk is.
 *
 * **A gate blocks the listing, not the seller.** Refusing a product is reversible and specific;
 * suspending an account over an unauthorised brand would punish a seller who mis-picked from a
 * dropdown the same as one selling fakes.
 */

/**
 * May this seller list against this brand?
 *
 * Returns null when allowed, or a reason when not. Called on every create and edit, so the
 * common case — an ungated brand — costs one indexed read.
 */
export async function checkBrandAccess(sellerId, brandId) {
  if (!brandId) return null

  const brand = await queryOne('SELECT id, name, is_gated, gate_note FROM brands WHERE id = ?', [brandId])
  if (!brand || !brand.is_gated) return null

  const auth = await queryOne(
    `SELECT status, valid_until FROM brand_authorizations
      WHERE brand_id = ? AND seller_id = ?`,
    [brandId, sellerId],
  )

  if (!auth || auth.status === 'rejected' || auth.status === 'revoked') {
    return {
      brand: brand.name,
      // The seller is told what to do about it, not merely that they cannot.
      message: brand.gate_note
        || `${brand.name} is a protected brand. Send Mirwal your authorisation letter or distributor agreement to list against it.`,
      code: 'BRAND_NOT_AUTHORISED',
    }
  }
  if (auth.status === 'pending') {
    return {
      brand: brand.name,
      message: `Your authorisation for ${brand.name} is still being reviewed.`,
      code: 'BRAND_AUTHORISATION_PENDING',
    }
  }
  // Distribution agreements expire, and an expired one is not an authorisation.
  if (auth.valid_until && new Date(auth.valid_until) < new Date()) {
    return {
      brand: brand.name,
      message: `Your authorisation for ${brand.name} expired. Send Mirwal a current one to keep listing.`,
      code: 'BRAND_AUTHORISATION_EXPIRED',
    }
  }
  return null
}

/** Throwing wrapper, for the product write paths. */
export async function assertBrandAccess(sellerId, brandId) {
  const problem = await checkBrandAccess(sellerId, brandId)
  if (!problem) return
  throw forbidden(problem.message, problem.code)
}

// ---------------------------------------------------------------------------
// Seller side
// ---------------------------------------------------------------------------

/** Gated brands and where this seller stands with each. */
export async function listForSeller(sellerId) {
  const rows = await query(
    `SELECT b.slug, b.name, b.gate_note,
            a.public_id, a.status, a.valid_until, a.decision_note, a.created_at
       FROM brands b
       LEFT JOIN brand_authorizations a ON a.brand_id = b.id AND a.seller_id = ?
      WHERE b.is_gated = 1 AND b.is_active = 1
      ORDER BY b.name`,
    [sellerId],
  )
  return rows.map((row) => ({
    brand: { slug: row.slug, name: row.name, note: row.gate_note },
    authorization: row.public_id
      ? {
        id: row.public_id,
        status: row.status,
        validUntil: row.valid_until,
        note: row.decision_note,
        requestedAt: row.created_at,
      }
      : null,
  }))
}

/**
 * Ask for authorisation.
 *
 * One row per seller per brand, updated rather than duplicated — `uq_brand_auth_pair` enforces
 * it. Re-applying after a rejection is allowed and expected: a seller who was refused for a
 * missing document should be able to send the document.
 */
export async function request(sellerId, brandSlug, { documentId = null } = {}) {
  const brand = await queryOne('SELECT id, name, is_gated FROM brands WHERE slug = ?', [brandSlug])
  if (!brand) throw notFound('That brand does not exist.')
  if (!brand.is_gated) {
    throw conflict(`${brand.name} does not need authorisation — you can list against it now.`, 'BRAND_NOT_GATED')
  }

  const existing = await queryOne(
    'SELECT id, status FROM brand_authorizations WHERE brand_id = ? AND seller_id = ?',
    [brand.id, sellerId],
  )
  if (existing?.status === 'approved') {
    throw conflict(`You are already authorised for ${brand.name}.`, 'ALREADY_AUTHORISED')
  }
  if (existing?.status === 'pending') {
    throw conflict('That request is already with Mirwal.', 'ALREADY_REQUESTED')
  }

  const publicId = existing ? null : randomUUID()
  if (existing) {
    await query(
      `UPDATE brand_authorizations
          SET status = 'pending', document_id = ?, decision_note = NULL,
              reviewed_by = NULL, reviewed_at = NULL, updated_at = NOW(3)
        WHERE id = ?`,
      [documentId, existing.id],
    )
  } else {
    await query(
      `INSERT INTO brand_authorizations (public_id, brand_id, seller_id, status, document_id)
       VALUES (?, ?, ?, 'pending', ?)`,
      [publicId, brand.id, sellerId, documentId],
    )
  }
  return { brand: brand.name, status: 'pending' }
}

// ---------------------------------------------------------------------------
// Reviewer side
// ---------------------------------------------------------------------------

export async function listForAdmin({ status = 'pending', page = 1, pageSize = 25 } = {}) {
  const rows = await query(
    `SELECT a.public_id, a.status, a.valid_from, a.valid_until, a.decision_note, a.created_at,
            b.name AS brand_name, b.slug AS brand_slug,
            s.public_id AS seller_id, s.store_name, s.verification_level,
            d.public_id AS document_id, d.original_name AS document_name
       FROM brand_authorizations a
       JOIN brands b ON b.id = a.brand_id
       JOIN sellers s ON s.id = a.seller_id
       LEFT JOIN seller_documents d ON d.id = a.document_id
      WHERE a.status = ?
      ORDER BY a.created_at ASC
      LIMIT ? OFFSET ?`,
    [status, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    'SELECT COUNT(*) AS total FROM brand_authorizations WHERE status = ?',
    [status],
  )
  return {
    items: rows.map((row) => ({
      id: row.public_id,
      status: row.status,
      brand: { slug: row.brand_slug, name: row.brand_name },
      seller: { id: row.seller_id, storeName: row.store_name, verificationLevel: row.verification_level },
      document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      note: row.decision_note,
      requestedAt: row.created_at,
    })),
    total: Number(total),
  }
}

/**
 * Decide a request.
 *
 * Approving without an expiry is allowed but discouraged: distribution agreements end, and an
 * authorisation that never expires outlives the paperwork behind it. The reviewer is not
 * forced, because some brands genuinely grant open-ended permission.
 */
export async function decide(publicId, { approved, note, validUntil }, reviewerId) {
  const row = await queryOne(
    `SELECT a.id, a.seller_id, a.status, b.name AS brand_name, s.user_id
       FROM brand_authorizations a
       JOIN brands b ON b.id = a.brand_id
       JOIN sellers s ON s.id = a.seller_id
      WHERE a.public_id = ?`,
    [publicId],
  )
  if (!row) throw notFound('Authorisation request not found.')
  if (row.status !== 'pending') {
    throw conflict(`This request has already been ${row.status}.`, 'ALREADY_DECIDED')
  }

  await query(
    `UPDATE brand_authorizations
        SET status = ?, decision_note = ?, valid_until = ?,
            valid_from = CASE WHEN ? = 'approved' THEN CURDATE() ELSE valid_from END,
            reviewed_by = ?, reviewed_at = NOW(3), updated_at = NOW(3)
      WHERE id = ?`,
    [
      approved ? 'approved' : 'rejected', note ?? null, validUntil ?? null,
      approved ? 'approved' : 'rejected', reviewerId, row.id,
    ],
  )

  await createNotification(row.user_id, {
    type: approved ? 'brand_authorised' : 'brand_authorisation_rejected',
    title: approved ? `You can now list ${row.brand_name}` : `${row.brand_name} authorisation refused`,
    body: approved
      ? `Mirwal accepted your authorisation for ${row.brand_name}.`
      : (note || `Mirwal could not accept your authorisation for ${row.brand_name}.`),
    link: '/brands',
  })

  return { brand: row.brand_name, status: approved ? 'approved' : 'rejected' }
}

/** Gate or ungate a brand. The switch that decides where the control applies at all. */
export async function setGated(brandSlug, { gated, note }) {
  const brand = await queryOne('SELECT id, name FROM brands WHERE slug = ?', [brandSlug])
  if (!brand) throw notFound('Brand not found.')
  await query(
    'UPDATE brands SET is_gated = ?, gate_note = ?, updated_at = NOW(3) WHERE id = ?',
    [gated ? 1 : 0, gated ? (note ?? null) : null, brand.id],
  )
  return { brand: brand.name, gated: Boolean(gated) }
}

/**
 * Expire authorisations whose validity has run out.
 *
 * Run from the background sweep. Without it an expired agreement keeps granting access, which
 * is the same failure as never having checked.
 */
export async function expireAuthorisations() {
  const result = await query(
    `UPDATE brand_authorizations
        SET status = 'expired', updated_at = NOW(3)
      WHERE status = 'approved' AND valid_until IS NOT NULL AND valid_until < CURDATE()`,
  )
  return { expired: result.affectedRows ?? 0 }
}
