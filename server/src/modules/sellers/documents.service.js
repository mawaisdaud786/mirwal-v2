import { query, queryOne } from '../../db/pool.js'
import { conflict, notFound } from '../../lib/errors.js'
import { storeDocument, readDocument, deleteDocument } from '../../lib/storage.js'
import * as messaging from '../messaging/messaging.service.js'

/**
 * Seller verification documents.
 *
 * A seller uploads their CNIC, business registration, tax certificate or a bank letter;
 * Mirwal staff review each one. This was previously impossible to build honestly because
 * there was nowhere to put a file — `lib/storage.js` is that capability.
 *
 * These are identity documents, so the access rule is stricter than anywhere else in the
 * codebase: the bytes are never served statically and never returned in a list. A download
 * requires an authenticated request from either the owning seller or Mirwal staff, checked
 * per request.
 */

/** The document types Mirwal asks for, in the order the seller portal shows them. */
export const DOC_TYPES = [
  { type: 'cnic_front', label: 'CNIC — front', required: true },
  { type: 'cnic_back', label: 'CNIC — back', required: true },
  { type: 'business_registration', label: 'Business registration', required: false },
  { type: 'tax_certificate', label: 'Tax certificate (NTN)', required: false },
  { type: 'bank_statement', label: 'Bank letter or statement', required: false },
  { type: 'other', label: 'Other supporting document', required: false },
]

const LABELS = Object.fromEntries(DOC_TYPES.map((entry) => [entry.type, entry.label]))

function shape(row) {
  return {
    id: row.public_id,
    docType: row.doc_type,
    label: LABELS[row.doc_type] ?? row.doc_type,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    reviewNote: row.review_note,
    reviewedBy: row.reviewer_name ?? null,
    reviewedAt: row.reviewed_at,
    uploadedAt: row.uploaded_at,
    seller: row.store_name ? { slug: row.seller_slug, name: row.store_name } : undefined,
    // Deliberately no path, no URL and no bytes — download goes through its own authorised
    // route, which re-checks who is asking.
  }
}

const SELECT = `
  SELECT d.public_id, d.doc_type, d.original_name, d.mime_type, d.size_bytes, d.status,
         d.review_note, d.reviewed_at, d.uploaded_at, d.seller_id, d.stored_name,
         s.slug AS seller_slug, s.store_name,
         u.full_name AS reviewer_name
    FROM seller_documents d
    JOIN sellers s ON s.id = d.seller_id
    LEFT JOIN users u ON u.id = d.reviewed_by`

/** A seller's own documents, plus which required types are still missing. */
export async function listForSeller(sellerId) {
  const rows = await query(
    `${SELECT} WHERE d.seller_id = ? AND d.deleted_at IS NULL ORDER BY d.uploaded_at DESC`,
    [sellerId],
  )
  const documents = rows.map(shape)
  const present = new Set(documents.filter((doc) => doc.status !== 'rejected').map((doc) => doc.docType))

  return {
    documents,
    requirements: DOC_TYPES.map((entry) => ({
      ...entry,
      provided: present.has(entry.type),
    })),
    // "Verified" means every required type has an approved document — not merely uploaded.
    isVerified: DOC_TYPES
      .filter((entry) => entry.required)
      .every((entry) => documents.some((doc) => doc.docType === entry.type && doc.status === 'approved')),
  }
}

/** The staff review queue, newest pending first. */
export async function listForAdmin({ page = 1, pageSize = 50, status } = {}) {
  const where = ['d.deleted_at IS NULL']
  const params = []
  if (status) { where.push('d.status = ?'); params.push(status) }
  const clause = `WHERE ${where.join(' AND ')}`

  const rows = await query(
    `${SELECT} ${clause}
      ORDER BY FIELD(d.status,'pending','approved','rejected'), d.uploaded_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM seller_documents d ${clause}`, params)
  const [stats] = await query(
    `SELECT COUNT(*) AS total, SUM(status='pending') AS pending, SUM(status='approved') AS approved,
            SUM(status='rejected') AS rejected FROM seller_documents WHERE deleted_at IS NULL`,
  )

  return {
    items: rows.map(shape),
    total: Number(total),
    stats: {
      total: Number(stats.total),
      pending: Number(stats.pending ?? 0),
      approved: Number(stats.approved ?? 0),
      rejected: Number(stats.rejected ?? 0),
    },
  }
}

/**
 * Store an uploaded document against a seller.
 *
 * Re-uploading the same type replaces the previous one: a seller correcting a blurry scan
 * should not leave the old file in the review queue competing with the new one.
 */
export async function upload(sellerId, { buffer, originalName, docType }) {
  const stored = await storeDocument(buffer, originalName)

  const duplicate = await queryOne(
    'SELECT id FROM seller_documents WHERE seller_id = ? AND checksum = ? AND deleted_at IS NULL',
    [sellerId, stored.checksum],
  )
  if (duplicate) {
    // The bytes are already on disk under the new name; drop it rather than orphaning it.
    await deleteDocument(stored.storedName)
    throw conflict('That exact file has already been uploaded.', 'DUPLICATE_DOCUMENT')
  }

  // Supersede the previous document of this type.
  const previous = await query(
    'SELECT id, stored_name FROM seller_documents WHERE seller_id = ? AND doc_type = ? AND deleted_at IS NULL',
    [sellerId, docType],
  )
  for (const row of previous) {
    await query('UPDATE seller_documents SET deleted_at = NOW(3) WHERE id = ?', [row.id])
    await deleteDocument(row.stored_name)
  }

  const [row] = await query(
    `INSERT INTO seller_documents
       (public_id, seller_id, doc_type, original_name, stored_name, mime_type, size_bytes, checksum, uploaded_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW(3))
     RETURNING public_id`,
    [sellerId, docType, stored.safeOriginalName, stored.storedName, stored.mimeType, stored.size, stored.checksum],
  )
  return { id: row.public_id, replaced: previous.length > 0 }
}

/**
 * Fetch a document's bytes.
 *
 * `sellerId` is null for staff. For a seller it must match the owning store — a missing
 * document and someone else's document are both reported as not found, so this cannot be
 * used to discover which ids exist.
 */
export async function download(publicId, { sellerId = null } = {}) {
  const row = await queryOne(
    'SELECT stored_name, original_name, mime_type, seller_id FROM seller_documents WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!row) throw notFound('Document not found.')
  if (sellerId != null && row.seller_id !== sellerId) throw notFound('Document not found.')

  const file = await readDocument(row.stored_name)
  return { ...file, mimeType: row.mime_type, filename: row.original_name }
}

/** A seller withdrawing a document they uploaded by mistake. */
export async function remove(sellerId, publicId) {
  const row = await queryOne(
    'SELECT id, seller_id, stored_name, status FROM seller_documents WHERE public_id = ? AND deleted_at IS NULL',
    [publicId],
  )
  if (!row || row.seller_id !== sellerId) throw notFound('Document not found.')
  if (row.status === 'approved') {
    throw conflict('An approved document cannot be removed. Contact Mirwal support if it is wrong.', 'DOCUMENT_APPROVED')
  }
  await query('UPDATE seller_documents SET deleted_at = NOW(3) WHERE id = ?', [row.id])
  await deleteDocument(row.stored_name)
  return { ok: true }
}

/**
 * Staff decision on one document.
 *
 * The seller is emailed the outcome — a rejected document the seller never hears about is
 * indistinguishable to them from one still waiting.
 */
export async function review(publicId, { status, note }, adminUserId) {
  const row = await queryOne(
    `SELECT d.id, d.doc_type, d.status, s.store_name, u.id AS owner_id, u.full_name AS owner_name, u.email AS owner_email
       FROM seller_documents d
       JOIN sellers s ON s.id = d.seller_id
       JOIN users u ON u.id = s.user_id
      WHERE d.public_id = ? AND d.deleted_at IS NULL`,
    [publicId],
  )
  if (!row) throw notFound('Document not found.')
  if (row.status === status) throw conflict(`This document is already ${status}.`, 'NO_STATUS_CHANGE')

  await query(
    `UPDATE seller_documents
        SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW(3)
      WHERE id = ?`,
    [status, note ?? null, adminUserId, row.id],
  )

  // Fire and forget: send() never throws, and a mail problem must not fail the review.
  await messaging.send('document.reviewed', {
    to: row.owner_email,
    userId: row.owner_id,
    variables: {
      sellerName: row.owner_name,
      documentType: LABELS[row.doc_type] ?? row.doc_type,
      outcome: status,
      note: note ?? '',
    },
  })

  return { previousStatus: row.status, status, storeName: row.store_name }
}
