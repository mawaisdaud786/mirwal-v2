import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'

/**
 * Roles & permissions.
 *
 * `roles`, `permissions`, `role_permissions` and `user_roles` have existed since migration
 * 001 and are what `requireRole`/`requirePermission` actually enforce on every request — but
 * nothing ever exposed them, so the admin panel's Roles and Access Control pages showed a
 * hard-coded matrix of checkmarks that had no relationship to what the server would allow.
 * This reads the real grants.
 *
 * Writes are deliberately narrow. Granting and revoking a permission on a role is supported;
 * creating or deleting roles is not. The four roles are referenced by name throughout the
 * codebase (`requireRole('admin', 'super_admin')`, the seller login guard, the storefront's
 * self-registration path), so a role invented in the UI would carry no authority anywhere,
 * and deleting one would silently strip access from everyone holding it.
 */

/** Roles whose permission set must not be edited through the UI. */
const LOCKED_ROLES = {
  // Removing a permission from super_admin is the one change that can lock every
  // administrator out of the panel with no way back in through the product.
  super_admin: 'The super administrator role always holds every permission.',
  // customer is granted by self-registration; giving it a permission would hand that
  // permission to anyone who signs up.
  customer: 'The customer role is granted automatically at sign-up and must stay unprivileged.',
}

export async function listRoles() {
  const rows = await query(
    `SELECT r.id, r.slug, r.name, r.description, r.is_system,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
            (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS member_count
       FROM roles r
      ORDER BY r.id`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: Boolean(row.is_system),
    permissionCount: Number(row.permission_count),
    memberCount: Number(row.member_count),
    editable: !(row.slug in LOCKED_ROLES),
    lockedReason: LOCKED_ROLES[row.slug] ?? null,
  }))
}

/** Every permission, grouped by the `area` column the seed already assigns. */
export async function listPermissions() {
  const rows = await query('SELECT id, slug, area, description FROM permissions ORDER BY area, slug')
  const areas = new Map()
  for (const row of rows) {
    if (!areas.has(row.area)) areas.set(row.area, [])
    areas.get(row.area).push({
      id: String(row.id),
      slug: row.slug,
      description: row.description,
    })
  }
  return [...areas].map(([area, permissions]) => ({ area, permissions }))
}

/**
 * The access-control matrix: which role holds which permission.
 *
 * Returned as a `{ [roleSlug]: string[] }` map of permission slugs rather than a dense grid
 * of booleans, so adding a permission does not change the shape of the response and the UI
 * builds its own grid from the two lists above.
 */
export async function getAccessMatrix() {
  const rows = await query(
    `SELECT r.slug AS role_slug, p.slug AS permission_slug
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      ORDER BY r.id, p.slug`,
  )
  const matrix = {}
  for (const row of rows) {
    (matrix[row.role_slug] ??= []).push(row.permission_slug)
  }
  // Roles with no grants still need a key, or the UI reads "missing" as "not loaded".
  for (const role of await query('SELECT slug FROM roles')) matrix[role.slug] ??= []
  return matrix
}

/** One role with its full grant list and the accounts holding it. */
export async function getRole(slug) {
  const role = await queryOne(
    `SELECT r.id, r.slug, r.name, r.description, r.is_system FROM roles r WHERE r.slug = ?`,
    [slug],
  )
  if (!role) throw notFound('Role not found.')

  const [permissions, members] = await Promise.all([
    query(
      `SELECT p.slug, p.area, p.description
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ? ORDER BY p.area, p.slug`,
      [role.id],
    ),
    query(
      `SELECT u.public_id, u.full_name, u.email, u.status, ur.created_at AS granted_at
         FROM user_roles ur JOIN users u ON u.id = ur.user_id
        WHERE ur.role_id = ? AND u.deleted_at IS NULL
        ORDER BY ur.created_at DESC
        LIMIT 50`,
      [role.id],
    ),
  ])

  return {
    id: String(role.id),
    slug: role.slug,
    name: role.name,
    description: role.description,
    isSystem: Boolean(role.is_system),
    editable: !(role.slug in LOCKED_ROLES),
    lockedReason: LOCKED_ROLES[role.slug] ?? null,
    permissions: permissions.map((row) => ({ slug: row.slug, area: row.area, description: row.description })),
    members: members.map((row) => ({
      id: row.public_id,
      name: row.full_name,
      email: row.email,
      status: row.status,
      grantedAt: row.granted_at,
    })),
  }
}

/**
 * Replace a role's permission set.
 *
 * Takes the full desired list rather than add/remove deltas: the UI is a matrix of
 * checkboxes, and sending the resulting state avoids the lost-update problem where two admins
 * each toggle one box and the second overwrites the first's read of "current permissions".
 */
export async function setRolePermissions(slug, permissionSlugs) {
  const role = await queryOne('SELECT id, slug, name FROM roles WHERE slug = ?', [slug])
  if (!role) throw notFound('Role not found.')
  if (role.slug in LOCKED_ROLES) throw conflict(LOCKED_ROLES[role.slug], 'ROLE_LOCKED')

  const unique = [...new Set(permissionSlugs)]
  let permissionIds = []
  if (unique.length) {
    const rows = await query(
      `SELECT id, slug FROM permissions WHERE slug IN (${unique.map(() => '?').join(',')})`,
      unique,
    )
    if (rows.length !== unique.length) {
      const found = new Set(rows.map((row) => row.slug))
      const missing = unique.filter((value) => !found.has(value))
      throw badRequest(`Unknown permission: ${missing.join(', ')}`, 'UNKNOWN_PERMISSION')
    }
    permissionIds = rows.map((row) => row.id)
  }

  const previous = await query(
    `SELECT p.slug FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?`,
    [role.id],
  )

  await withTransaction(async (connection) => {
    await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [role.id])
    for (const permissionId of permissionIds) {
      await connection.execute(
        'INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, NOW(3))',
        [role.id, permissionId],
      )
    }
  })

  const before = new Set(previous.map((row) => row.slug))
  const after = new Set(unique)
  return {
    roleName: role.name,
    granted: unique.filter((value) => !before.has(value)),
    revoked: [...before].filter((value) => !after.has(value)),
    // A permission change only reaches a user when their access token is next reissued: the
    // token carries `perms`, so an admin signed in right now keeps the old set until refresh.
    total: unique.length,
  }
}
