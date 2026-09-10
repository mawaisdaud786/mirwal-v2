import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { parseJsonColumn } from '../../lib/json.js'

/**
 * The remaining admin operations surfaces: staff accounts, login sessions, blocked accounts,
 * notifications, seller performance, product reports, system logs, teams and attributes.
 *
 * Several of these were previously called impossible because "there is no admin
 * user-management system" or "no session tracking". Both claims were about missing endpoints,
 * not missing data: `users`, `user_roles` and `refresh_tokens` have carried all of it since
 * migration 001. Nothing new was needed for those — only somewhere to read them.
 */

// ---------------------------------------------------------------------------
// Staff accounts
// ---------------------------------------------------------------------------

const STAFF_ROLES = ['admin', 'super_admin']

/** Everyone holding a staff role, with what they hold and when they last signed in. */
export async function listStaff() {
  const rows = await query(
    `SELECT u.id, u.public_id, u.full_name, u.email, u.status, u.last_login_at, u.created_at,
            GROUP_CONCAT(r.slug ORDER BY r.id) AS roles,
            (SELECT COUNT(*) FROM refresh_tokens t
              WHERE t.user_id = u.id AND t.revoked_at IS NULL AND t.expires_at > NOW()) AS active_sessions
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id
     HAVING SUM(r.slug IN (?, ?)) > 0
      ORDER BY u.full_name`,
    STAFF_ROLES,
  )
  return rows.map((row) => ({
    id: row.public_id,
    name: row.full_name,
    email: row.email,
    status: row.status,
    roles: (row.roles ?? '').split(',').filter(Boolean),
    activeSessions: Number(row.active_sessions),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }))
}

// ---------------------------------------------------------------------------
// Login sessions
// ---------------------------------------------------------------------------

/**
 * Live refresh tokens — the real sessions.
 *
 * A revoked or expired row is history, not a session, so only current ones are listed. The
 * token itself is never returned: only its hash is stored, and even that stays server-side.
 */
export async function listSessions({ page = 1, pageSize = 50, staffOnly = false } = {}) {
  const where = ['t.revoked_at IS NULL', 't.expires_at > NOW()']
  const params = []
  if (staffOnly) {
    where.push(`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                         WHERE ur.user_id = t.user_id AND r.slug IN ('admin','super_admin'))`)
  }
  const clause = `WHERE ${where.join(' AND ')}`

  const rows = await query(
    `SELECT t.id, t.created_at, t.expires_at, t.user_agent,
            INET6_NTOA(t.ip_address) AS ip_address,
            u.public_id AS user_public_id, u.full_name, u.email
       FROM refresh_tokens t
       JOIN users u ON u.id = t.user_id
       ${clause}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM refresh_tokens t ${clause}`, params)

  return {
    items: rows.map((row) => ({
      id: String(row.id),
      user: { id: row.user_public_id, name: row.full_name, email: row.email },
      // Raw UA rather than a guessed "Chrome on Windows": parsing it here would be a guess
      // presented as fact, and the raw string is what actually identifies the client.
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
      startedAt: row.created_at,
      expiresAt: row.expires_at,
    })),
    total: Number(total),
  }
}

/** Sign a session out. The refresh token stops working immediately. */
export async function revokeSession(id) {
  const row = await queryOne('SELECT id, user_id FROM refresh_tokens WHERE id = ? AND revoked_at IS NULL', [id])
  if (!row) throw notFound('Session not found or already ended.')
  await query('UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE id = ?', [id])
  return { userId: row.user_id }
}

/** Sign out every session for one account — the "this account is compromised" action. */
export async function revokeAllSessionsFor(userPublicId) {
  const user = await queryOne('SELECT id, full_name FROM users WHERE public_id = ?', [userPublicId])
  if (!user) throw notFound('Account not found.')
  const result = await query(
    'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
    [user.id],
  )
  return { name: user.full_name, revoked: result.affectedRows ?? 0 }
}

// ---------------------------------------------------------------------------
// Accounts: suspension and the blocked list
// ---------------------------------------------------------------------------

export async function listAccounts({ page = 1, pageSize = 50, status, search } = {}) {
  const where = ['u.deleted_at IS NULL']
  const params = []
  if (status) { where.push('u.status = ?'); params.push(status) }
  if (search) { where.push('(u.full_name LIKE ? OR u.email LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
  const clause = `WHERE ${where.join(' AND ')}`

  const rows = await query(
    `SELECT u.public_id, u.full_name, u.email, u.status, u.created_at, u.last_login_at,
            GROUP_CONCAT(DISTINCT r.slug) AS roles,
            (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) AS order_count
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       ${clause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users u ${clause}`, params)

  return {
    items: rows.map((row) => ({
      id: row.public_id,
      name: row.full_name,
      email: row.email,
      status: row.status,
      roles: (row.roles ?? '').split(',').filter(Boolean),
      orderCount: Number(row.order_count),
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    })),
    total: Number(total),
  }
}

/**
 * Suspend or restore an account.
 *
 * Suspending also revokes every live session: leaving them signed in would mean a blocked
 * account keeps working until its access token happens to expire.
 */
export async function setAccountStatus(publicId, status, actingUserId) {
  const user = await queryOne('SELECT id, full_name, status FROM users WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!user) throw notFound('Account not found.')
  if (user.status === status) throw conflict(`This account is already ${status}.`, 'NO_STATUS_CHANGE')
  if (user.id === actingUserId) throw badRequest('You cannot change your own account status.', 'SELF_ACTION')

  const revoked = await withTransaction(async (connection) => {
    await connection.execute('UPDATE users SET status = ?, updated_at = NOW(3) WHERE id = ?', [status, user.id])
    if (status !== 'active') {
      const [result] = await connection.execute(
        'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
        [user.id],
      )
      return result.affectedRows
    }
    return 0
  })

  return { name: user.full_name, previousStatus: user.status, status, sessionsRevoked: revoked }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function listNotifications({ page = 1, pageSize = 50 } = {}) {
  const rows = await query(
    `SELECT n.public_id, n.type, n.title, n.body, n.link, n.read_at, n.created_at,
            u.full_name, u.email
       FROM notifications n
       JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM notifications')
  const [stats] = await query(
    'SELECT COUNT(*) AS total, SUM(read_at IS NULL) AS unread FROM notifications',
  )
  return {
    items: rows.map((row) => ({
      id: row.public_id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      isRead: Boolean(row.read_at),
      recipient: { name: row.full_name, email: row.email },
      createdAt: row.created_at,
    })),
    total: Number(total),
    stats: { total: Number(stats.total), unread: Number(stats.unread ?? 0) },
  }
}

// ---------------------------------------------------------------------------
// Seller performance
// ---------------------------------------------------------------------------

/**
 * Per-seller fulfilment metrics, computed from real order items.
 *
 * Every figure is a ratio of counts this database actually holds. There is no invented
 * "seller score": a weighted index would be a number Mirwal made up, and the underlying rates
 * are what an admin can act on.
 */
export async function getSellerPerformance() {
  const rows = await query(
    `SELECT s.public_id, s.slug, s.store_name, s.rating_average, s.rating_count, s.status,
            COUNT(oi.id) AS total_items,
            SUM(oi.status = 'delivered') AS delivered,
            SUM(oi.status = 'cancelled') AS cancelled,
            SUM(oi.status IN ('pending','processing')) AS in_progress,
            COALESCE(SUM(CASE WHEN oi.status <> 'cancelled' THEN oi.line_total ELSE 0 END), 0) AS revenue,
            (SELECT COUNT(*) FROM return_requests rr WHERE rr.seller_id = s.id) AS returns
       FROM sellers s
       LEFT JOIN order_items oi ON oi.seller_id = s.id
      WHERE s.deleted_at IS NULL
      GROUP BY s.id
      ORDER BY revenue DESC`,
  )

  return rows.map((row) => {
    const total = Number(row.total_items)
    const delivered = Number(row.delivered ?? 0)
    const cancelled = Number(row.cancelled ?? 0)
    const returns = Number(row.returns)
    const rate = (value) => (total === 0 ? null : Math.round((value / total) * 1000) / 10)
    return {
      id: row.public_id,
      slug: row.slug,
      storeName: row.store_name,
      status: row.status,
      rating: { average: Number(row.rating_average), count: row.rating_count },
      orderItems: total,
      delivered,
      cancelled,
      inProgress: Number(row.in_progress ?? 0),
      returns,
      // Null rather than 0 when there is nothing to divide by — a store with no orders has no
      // fulfilment rate, and showing 0% would read as failure.
      fulfilmentRate: rate(delivered),
      cancellationRate: rate(cancelled),
      returnRate: rate(returns),
      revenue: formatMoney(row.revenue, 'PKR'),
    }
  })
}

// ---------------------------------------------------------------------------
// Product reports
// ---------------------------------------------------------------------------

export async function listProductReports({ page = 1, pageSize = 50, status } = {}) {
  const where = []
  const params = []
  if (status) { where.push('pr.status = ?'); params.push(status) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT pr.public_id, pr.reason, pr.details, pr.status, pr.resolution, pr.created_at, pr.reviewed_at,
            p.public_id AS product_public_id, p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
            s.store_name AS seller_name,
            u.full_name AS reporter_name, u.email AS reporter_email,
            a.full_name AS reviewer_name
       FROM product_reports pr
       JOIN products p ON p.id = pr.product_id
       JOIN sellers s ON s.id = p.seller_id
       LEFT JOIN users u ON u.id = pr.reporter_id
       LEFT JOIN users a ON a.id = pr.reviewed_by
       ${clause}
      ORDER BY FIELD(pr.status,'open','reviewing','upheld','dismissed'), pr.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM product_reports pr ${clause}`, params)
  const [stats] = await query(
    `SELECT COUNT(*) AS total, SUM(status='open') AS open, SUM(status='upheld') AS upheld,
            SUM(status='dismissed') AS dismissed FROM product_reports`,
  )

  return {
    items: rows.map((row) => ({
      id: row.public_id,
      reason: row.reason,
      details: row.details,
      status: row.status,
      resolution: row.resolution,
      product: { id: row.product_public_id, name: row.product_name, slug: row.product_slug, status: row.product_status },
      seller: row.seller_name,
      reporter: row.reporter_name ? { name: row.reporter_name, email: row.reporter_email } : null,
      reviewedBy: row.reviewer_name ?? null,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
    })),
    total: Number(total),
    stats: {
      total: Number(stats.total),
      open: Number(stats.open ?? 0),
      upheld: Number(stats.upheld ?? 0),
      dismissed: Number(stats.dismissed ?? 0),
    },
  }
}

/** Create a report. Called from the storefront by a shopper. */
export async function createProductReport({ productSlug, reporterId, reason, details }) {
  const product = await queryOne(
    "SELECT id FROM products WHERE slug = ? AND deleted_at IS NULL AND status = 'active'",
    [productSlug],
  )
  if (!product) throw notFound('Product not found.')

  try {
    const [row] = await query(
      `INSERT INTO product_reports (public_id, product_id, reporter_id, reason, details, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, NOW(3), NOW(3)) RETURNING public_id`,
      [product.id, reporterId ?? null, reason, details ?? null],
    )
    return { id: row.public_id }
  } catch (error) {
    // The unique key stops one person filing the same open report repeatedly.
    if (error.code === 'ER_DUP_ENTRY') {
      throw conflict('You have already reported this listing. Mirwal is reviewing it.', 'ALREADY_REPORTED')
    }
    throw error
  }
}

/** Resolve a report. `upheld` means the complaint was justified. */
export async function resolveProductReport(publicId, { status, resolution }, adminUserId) {
  const report = await queryOne('SELECT id, status FROM product_reports WHERE public_id = ?', [publicId])
  if (!report) throw notFound('Report not found.')
  if (!resolution && status !== 'reviewing') {
    throw badRequest('Say what was decided — it is the record of why this listing was or was not actioned.', 'RESOLUTION_REQUIRED')
  }
  await query(
    `UPDATE product_reports
        SET status = ?, resolution = ?, reviewed_by = ?, reviewed_at = NOW(3), updated_at = NOW(3)
      WHERE id = ?`,
    [status, resolution ?? null, adminUserId, report.id],
  )
  return { previousStatus: report.status, status }
}

// ---------------------------------------------------------------------------
// System logs
// ---------------------------------------------------------------------------

/**
 * Record a failure. Called from the error handler; never throws.
 *
 * Failing to log must not turn a handled 500 into an unhandled one, so every error here is
 * swallowed to the console — the same rule as the audit trail.
 */
export async function recordSystemLog({ level = 'error', code, message, method, path, statusCode, userId, requestId, ip, context }) {
  try {
    await query(
      `INSERT INTO system_logs
         (level, code, message, method, path, status_code, user_id, request_id, ip_address, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, INET6_ATON(?), ?, NOW(3))`,
      [
        level, String(code ?? 'UNKNOWN').slice(0, 60), String(message ?? '').slice(0, 500),
        method ?? null, path ? String(path).slice(0, 255) : null, statusCode ?? null,
        userId ?? null,
        /^[A-Za-z0-9-]{36}$/.test(requestId ?? '') ? requestId : null,
        ip ?? null,
        context ? JSON.stringify(context) : null,
      ],
    )
  } catch (error) {
    console.error('[system-log] could not record %s: %s', code, error.message)
  }
}

export async function listSystemLogs({ page = 1, pageSize = 50, level, code, search } = {}) {
  const where = []
  const params = []
  if (level) { where.push('l.level = ?'); params.push(level) }
  if (code) { where.push('l.code = ?'); params.push(code) }
  if (search) { where.push('(l.message LIKE ? OR l.path LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT l.id, l.level, l.code, l.message, l.method, l.path, l.status_code,
            l.request_id, l.created_at, INET6_NTOA(l.ip_address) AS ip_address, l.context,
            u.full_name AS user_name
       FROM system_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ${clause}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM system_logs l ${clause}`, params)
  const [stats] = await query(
    `SELECT SUM(level='error') AS errors, SUM(level='warn') AS warnings,
            SUM(created_at > NOW() - INTERVAL 24 HOUR) AS last24h FROM system_logs`,
  )

  return {
    items: rows.map((row) => ({
      id: String(row.id),
      level: row.level,
      code: row.code,
      message: row.message,
      method: row.method,
      path: row.path,
      statusCode: row.status_code,
      requestId: row.request_id,
      ipAddress: row.ip_address,
      user: row.user_name ?? null,
      context: parseJsonColumn(row.context),
      createdAt: row.created_at,
    })),
    total: Number(total),
    stats: {
      errors: Number(stats.errors ?? 0),
      warnings: Number(stats.warnings ?? 0),
      last24h: Number(stats.last24h ?? 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function listTeams() {
  const rows = await query(
    `SELECT t.id, t.slug, t.name, t.description, t.created_at,
            (SELECT COUNT(*) FROM admin_team_members m WHERE m.team_id = t.id) AS member_count
       FROM admin_teams t ORDER BY t.name`,
  )
  const members = await query(
    `SELECT m.team_id, u.public_id, u.full_name, u.email
       FROM admin_team_members m JOIN users u ON u.id = m.user_id
      ORDER BY u.full_name`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    memberCount: Number(row.member_count),
    members: members
      .filter((member) => member.team_id === row.id)
      .map((member) => ({ id: member.public_id, name: member.full_name, email: member.email })),
    createdAt: row.created_at,
  }))
}

const slugify = (name) => String(name).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'team'

export async function createTeam({ name, description }) {
  const slug = slugify(name)
  if (await queryOne('SELECT id FROM admin_teams WHERE slug = ?', [slug])) {
    throw conflict('A team with that name already exists.', 'TEAM_EXISTS')
  }
  await query(
    'INSERT INTO admin_teams (slug, name, description, created_at, updated_at) VALUES (?, ?, ?, NOW(3), NOW(3))',
    [slug, name.trim(), description?.trim() || null],
  )
  return { slug }
}

export async function deleteTeam(slug) {
  const team = await queryOne('SELECT id, name FROM admin_teams WHERE slug = ?', [slug])
  if (!team) throw notFound('Team not found.')
  await query('DELETE FROM admin_teams WHERE id = ?', [team.id])
  return { name: team.name }
}

/** Add or remove a staff account. Membership is a label, never a grant of authority. */
export async function setTeamMembership(slug, userPublicId, isMember) {
  const team = await queryOne('SELECT id, name FROM admin_teams WHERE slug = ?', [slug])
  if (!team) throw notFound('Team not found.')
  const user = await queryOne('SELECT id, full_name FROM users WHERE public_id = ? AND deleted_at IS NULL', [userPublicId])
  if (!user) throw notFound('Account not found.')

  if (isMember) {
    await query(
      'INSERT IGNORE INTO admin_team_members (team_id, user_id, created_at) VALUES (?, ?, NOW(3))',
      [team.id, user.id],
    )
  } else {
    await query('DELETE FROM admin_team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id])
  }
  return { team: team.name, name: user.full_name, isMember }
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export async function listAttributes() {
  const rows = await query(
    `SELECT a.id, a.slug, a.name, a.input_type, a.unit, a.options, a.is_required, a.position,
            c.slug AS category_slug, c.name AS category_name,
            (SELECT COUNT(*) FROM product_attribute_values v WHERE v.attribute_id = a.id) AS usage_count
       FROM product_attributes a
       LEFT JOIN categories c ON c.id = a.category_id
      ORDER BY c.name, a.position, a.name`,
  )
  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    inputType: row.input_type,
    unit: row.unit,
    options: parseJsonColumn(row.options, []),
    isRequired: Boolean(row.is_required),
    position: Number(row.position),
    category: row.category_slug ? { slug: row.category_slug, name: row.category_name } : null,
    usageCount: Number(row.usage_count),
  }))
}

export async function createAttribute(input) {
  const slug = slugify(input.name)
  if (await queryOne('SELECT id FROM product_attributes WHERE slug = ?', [slug])) {
    throw conflict('An attribute with that name already exists.', 'ATTRIBUTE_EXISTS')
  }
  let categoryId = null
  if (input.categorySlug) {
    const category = await queryOne('SELECT id FROM categories WHERE slug = ?', [input.categorySlug])
    if (!category) throw badRequest('That category does not exist.', 'INVALID_CATEGORY')
    categoryId = category.id
  }
  if (input.inputType === 'select' && !(input.options?.length)) {
    throw badRequest('A select attribute needs at least one option.', 'OPTIONS_REQUIRED')
  }

  await query(
    `INSERT INTO product_attributes
       (slug, name, input_type, unit, options, category_id, is_required, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      slug, input.name.trim(), input.inputType ?? 'text', input.unit?.trim() || null,
      input.options?.length ? JSON.stringify(input.options) : null,
      categoryId, input.isRequired ? 1 : 0, input.position ?? 0,
    ],
  )
  return { slug }
}

export async function deleteAttribute(slug) {
  const attribute = await queryOne('SELECT id, name FROM product_attributes WHERE slug = ?', [slug])
  if (!attribute) throw notFound('Attribute not found.')
  const [{ used }] = await query(
    'SELECT COUNT(*) AS used FROM product_attribute_values WHERE attribute_id = ?',
    [attribute.id],
  )
  if (Number(used) > 0) {
    throw conflict(`${attribute.name} is set on ${used} product(s). Clear those values first.`, 'ATTRIBUTE_IN_USE')
  }
  await query('DELETE FROM product_attributes WHERE id = ?', [attribute.id])
  return { name: attribute.name }
}
