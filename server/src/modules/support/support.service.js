import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'

/**
 * Support tickets — the seller/customer side and the admin queue are the same threads read
 * from opposite ends.
 *
 * Previously the seller panel's "Create Ticket" form showed a success toast and discarded
 * the input entirely, so a seller could report a problem that nobody would ever see. Every
 * function here writes.
 *
 * Two access rules run through the module:
 *
 *   - A requester (seller or customer) sees only their own tickets, enforced in the WHERE
 *     clause via `requesterId`/`sellerId`, never by filtering after the fetch.
 *   - Internal staff notes (`is_internal = 1`) are stripped from every requester read path.
 *     That flag is the only thing separating a private triage note from a message the
 *     customer reads, so it is applied in SQL rather than left to the caller to remember.
 */

const REQUESTER_VISIBLE = 'AND m.is_internal = 0'

/** `MW-T-000142` — a short human reference a requester can quote back. */
async function nextReference(connection) {
  const [[row]] = await connection.execute('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM support_tickets')
  return `MW-T-${String(row.next).padStart(6, '0')}`
}

function shapeTicket(row) {
  return {
    id: row.public_id,
    reference: row.reference,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    // The count the caller can actually open. `message_count` includes staff internal notes,
    // so showing it to a requester both contradicts the thread they are shown and reveals
    // that a hidden message exists.
    messageCount: Number(row.visible_message_count ?? row.message_count),
    lastMessageAt: row.last_message_at,
    requester: row.requester_name
      ? { name: row.requester_name, email: row.requester_email }
      : null,
    store: row.seller_slug ? { slug: row.seller_slug, name: row.seller_store_name } : null,
    assignedTo: row.assignee_name ?? null,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}

/**
 * `visible_message_count` is parameterised on whether the caller is staff: staff see every
 * message, a requester sees only the non-internal ones, and the count must match the thread.
 */
const ticketSelect = (isStaff) => `
  SELECT t.id, t.public_id, t.reference, t.subject, t.category, t.priority, t.status,
         t.message_count, t.last_message_at, t.resolved_at, t.created_at,
         t.requester_id, t.seller_id,
         ${isStaff
           ? 't.message_count AS visible_message_count'
           : `(SELECT COUNT(*) FROM support_messages m
                WHERE m.ticket_id = t.id AND m.is_internal = 0) AS visible_message_count`},
         u.full_name AS requester_name, u.email AS requester_email,
         s.slug AS seller_slug, s.store_name AS seller_store_name,
         a.full_name AS assignee_name
    FROM support_tickets t
    JOIN users u ON u.id = t.requester_id
    LEFT JOIN sellers s ON s.id = t.seller_id
    LEFT JOIN users a ON a.id = t.assigned_to`

/**
 * List tickets.
 *
 * @param {{requesterId?: number, sellerId?: number, isStaff?: boolean}} scope
 */
export async function listTickets(scope, { page = 1, pageSize = 25, status, priority, search } = {}) {
  const where = []
  const params = []

  if (!scope.isStaff) {
    // A requester's own tickets only. Seller-opened tickets are scoped by store so that a
    // store's tickets stay visible to its owner even if opened by a different staff account.
    if (scope.sellerId != null) { where.push('t.seller_id = ?'); params.push(scope.sellerId) }
    else if (scope.requesterId != null) { where.push('t.requester_id = ?'); params.push(scope.requesterId) }
    else throw forbidden()
  }
  if (status) { where.push('t.status = ?'); params.push(status) }
  if (priority) { where.push('t.priority = ?'); params.push(priority) }
  if (search) { where.push('(t.subject LIKE ? OR t.reference LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = await query(
    `${ticketSelect(scope.isStaff)} ${clause}
      ORDER BY FIELD(t.status,'open','pending','resolved','closed'),
               FIELD(t.priority,'urgent','high','normal','low'),
               COALESCE(t.last_message_at, t.created_at) DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM support_tickets t ${clause}`,
    params,
  )
  return { items: rows.map(shapeTicket), total: Number(total) }
}

export async function getTicketStats(scope) {
  const where = []
  const params = []
  if (!scope.isStaff) {
    if (scope.sellerId != null) { where.push('seller_id = ?'); params.push(scope.sellerId) }
    else if (scope.requesterId != null) { where.push('requester_id = ?'); params.push(scope.requesterId) }
    else throw forbidden()
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [row] = await query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'open') AS open,
            SUM(status = 'pending') AS pending,
            SUM(status = 'resolved') AS resolved,
            SUM(status = 'closed') AS closed
       FROM support_tickets ${clause}`,
    params,
  )
  return {
    total: Number(row.total),
    open: Number(row.open ?? 0),
    pending: Number(row.pending ?? 0),
    resolved: Number(row.resolved ?? 0),
    closed: Number(row.closed ?? 0),
  }
}

/** Fetch a ticket the caller is allowed to see, or 404 identically for missing/forbidden. */
async function accessibleTicket(scope, publicId) {
  const row = await queryOne(
    'SELECT id, requester_id, seller_id, reference, status FROM support_tickets WHERE public_id = ?',
    [publicId],
  )
  if (!row) throw notFound('Ticket not found.')
  if (!scope.isStaff) {
    const ownsBySeller = scope.sellerId != null && row.seller_id === scope.sellerId
    const ownsByUser = scope.requesterId != null && row.requester_id === scope.requesterId
    if (!ownsBySeller && !ownsByUser) throw notFound('Ticket not found.')
  }
  return row
}

export async function getTicket(scope, publicId) {
  const ticket = await accessibleTicket(scope, publicId)
  const row = await queryOne(`${ticketSelect(scope.isStaff)} WHERE t.public_id = ?`, [publicId])

  const messages = await query(
    `SELECT m.id, m.author_side, m.body, m.is_internal, m.created_at,
            u.full_name AS author_name
       FROM support_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = ? ${scope.isStaff ? '' : REQUESTER_VISIBLE}
      ORDER BY m.created_at, m.id`,
    [ticket.id],
  )

  return {
    ...shapeTicket(row),
    messages: messages.map((message) => ({
      id: String(message.id),
      side: message.author_side,
      author: message.author_name ?? 'Mirwal',
      body: message.body,
      isInternal: Boolean(message.is_internal),
      createdAt: message.created_at,
    })),
  }
}

/**
 * Open a ticket, with its first message, atomically.
 *
 * A ticket with no message is unactionable — staff would see a subject and nothing else — so
 * the two writes share a transaction rather than being two calls the client must remember to
 * make in order.
 */
export async function createTicket({ requesterId, sellerId = null }, input) {
  const publicId = await withTransaction(async (connection) => {
    const reference = await nextReference(connection)
    const [result] = await connection.execute(
      `INSERT INTO support_tickets
         (public_id, reference, requester_id, seller_id, subject, category, priority, status,
          last_message_at, message_count, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'open', NOW(3), 1, NOW(3), NOW(3))`,
      [reference, requesterId, sellerId, input.subject, input.category ?? 'general', input.priority ?? 'normal'],
    )
    await connection.execute(
      `INSERT INTO support_messages (ticket_id, author_id, author_side, body, is_internal, created_at)
       VALUES (?, ?, 'requester', ?, 0, NOW(3))`,
      [result.insertId, requesterId, input.message],
    )
    const [[row]] = await connection.execute('SELECT public_id FROM support_tickets WHERE id = ?', [result.insertId])
    return row.public_id
  })

  return getTicket({ requesterId, sellerId, isStaff: false }, publicId)
}

/**
 * Post a reply.
 *
 * Replying re-opens a resolved ticket: a requester who answers a "resolved" thread has, by
 * definition, not had their problem solved, and leaving it resolved buries it.
 */
export async function addMessage(scope, publicId, { body, isInternal = false }, authorId) {
  const ticket = await accessibleTicket(scope, publicId)
  if (ticket.status === 'closed') {
    throw badRequest('This ticket is closed. Open a new one to continue.', 'TICKET_CLOSED')
  }
  if (isInternal && !scope.isStaff) throw forbidden('Only Mirwal staff can add internal notes.')

  const side = scope.isStaff ? 'staff' : 'requester'
  await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO support_messages (ticket_id, author_id, author_side, body, is_internal, created_at)
       VALUES (?, ?, ?, ?, ?, NOW(3))`,
      [ticket.id, authorId, side, body, isInternal ? 1 : 0],
    )
    // An internal note is not activity the requester caused, but it is still activity — the
    // counters track the thread, and only a non-internal message reopens it.
    await connection.execute(
      `UPDATE support_tickets
          SET message_count = message_count + 1,
              last_message_at = NOW(3),
              status = CASE WHEN ? = 0 AND status = 'resolved' THEN 'open' ELSE status END,
              updated_at = NOW(3)
        WHERE id = ?`,
      [isInternal ? 1 : 0, ticket.id],
    )
  })

  return getTicket(scope, publicId)
}

/** Staff-only: change status, priority or assignee. */
export async function updateTicket(scope, publicId, input) {
  if (!scope.isStaff) throw forbidden()
  const ticket = await accessibleTicket(scope, publicId)

  const sets = []
  const params = []
  if (input.status !== undefined) {
    sets.push('status = ?', "resolved_at = CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, NOW(3)) ELSE NULL END")
    params.push(input.status, input.status)
  }
  if (input.priority !== undefined) { sets.push('priority = ?'); params.push(input.priority) }
  if (input.assignedTo !== undefined) {
    if (input.assignedTo === null) { sets.push('assigned_to = NULL') }
    else {
      const staff = await queryOne('SELECT id FROM users WHERE public_id = ?', [input.assignedTo])
      if (!staff) throw badRequest('That staff account was not found.', 'INVALID_ASSIGNEE')
      sets.push('assigned_to = ?'); params.push(staff.id)
    }
  }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`, [...params, ticket.id])
  return getTicket(scope, publicId)
}

/** A requester may close their own ticket; nothing else about it is theirs to change. */
export async function closeTicket(scope, publicId) {
  const ticket = await accessibleTicket(scope, publicId)
  await query(
    `UPDATE support_tickets
        SET status = 'closed', resolved_at = COALESCE(resolved_at, NOW(3)), updated_at = NOW(3)
      WHERE id = ?`,
    [ticket.id],
  )
  return { reference: ticket.reference }
}
