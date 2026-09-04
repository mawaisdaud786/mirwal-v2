import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { forbidden, notFound } from '../../lib/errors.js'

/**
 * A buyer's saved address book. Entirely separate from `orders.shipping_*` (migration 003),
 * which is an immutable snapshot of where a specific order shipped — editing or deleting a
 * saved address here never rewrites a past order's own address columns.
 *
 * Every query filters on `user_id`, and no route ever accepts a user id as a parameter — the
 * same ownership pattern as seller-scoped and buyer-scoped orders.
 */

function shapeAddress(row) {
  return {
    id: row.public_id,
    fullName: row.full_name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    isDefault: Boolean(row.is_default),
  }
}

export async function listAddresses(userId) {
  const rows = await query(
    `SELECT * FROM addresses WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY is_default DESC, created_at DESC`,
    [userId],
  )
  return rows.map(shapeAddress)
}

/** Only one address may be the default at a time — enforced here, not left to the client. */
export async function createAddress(userId, input) {
  const publicId = randomUUID()
  await withTransaction(async (connection) => {
    if (input.isDefault) {
      await connection.execute('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId])
    }
    // A user's first saved address becomes the default automatically — there is otherwise
    // no default to fall back to at checkout.
    const [existing] = await connection.execute(
      'SELECT COUNT(*) AS count FROM addresses WHERE user_id = ? AND deleted_at IS NULL',
      [userId],
    )
    const isDefault = input.isDefault || existing[0].count === 0
    await connection.execute(
      `INSERT INTO addresses (public_id, user_id, full_name, phone, line1, line2, city, region, postal_code, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [publicId, userId, input.fullName, input.phone, input.line1, input.line2 ?? '', input.city, input.region ?? '', input.postalCode ?? '', isDefault ? 1 : 0],
    )
  })
  return shapeAddress(await queryOne('SELECT * FROM addresses WHERE public_id = ?', [publicId]))
}

async function findOwned(userId, publicId) {
  const row = await queryOne('SELECT * FROM addresses WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!row) throw notFound('Address not found.', 'ADDRESS_NOT_FOUND')
  if (row.user_id !== userId) throw forbidden('This address does not belong to you.')
  return row
}

export async function updateAddress(userId, publicId, input) {
  const existing = await findOwned(userId, publicId)
  await withTransaction(async (connection) => {
    if (input.isDefault) {
      await connection.execute('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId])
    }
    await connection.execute(
      `UPDATE addresses SET full_name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, region = ?, postal_code = ?, is_default = ?
        WHERE id = ?`,
      [input.fullName, input.phone, input.line1, input.line2 ?? '', input.city, input.region ?? '', input.postalCode ?? '', input.isDefault ? 1 : 0, existing.id],
    )
  })
  return shapeAddress(await queryOne('SELECT * FROM addresses WHERE public_id = ?', [publicId]))
}

export async function deleteAddress(userId, publicId) {
  const existing = await findOwned(userId, publicId)
  await query('UPDATE addresses SET deleted_at = NOW(3) WHERE id = ?', [existing.id])
  // If the deleted address was the default, promote the next-most-recent one so there's
  // always a default to fall back to at checkout, as long as any address remains.
  if (existing.is_default) {
    const next = await queryOne(
      'SELECT id FROM addresses WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [userId],
    )
    if (next) await query('UPDATE addresses SET is_default = 1 WHERE id = ?', [next.id])
  }
}
