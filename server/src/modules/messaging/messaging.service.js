import { query, queryOne } from '../../db/pool.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { parseJsonColumn } from '../../lib/json.js'
import { sendEmail, sendSms, renderTemplate, messagingCapabilities } from '../../lib/mailer.js'

/**
 * Transactional messaging: templates, sending, and the delivery ledger.
 *
 * `send()` is the only entry point the rest of the app uses. It resolves a template, renders
 * it, attempts delivery and records the outcome — and it never throws. A failed
 * order-confirmation email must not roll back the order it was confirming, so the caller gets
 * a result object and carries on.
 *
 * The ledger is what makes the admin Messaging page honest: every attempt is recorded with
 * its provider result, so "did that email actually go out?" has an answer rather than an
 * assumption.
 */

/**
 * Templates seeded on first read.
 *
 * Bodies are deliberately plain: Mirwal sends operational mail, and a heavy HTML shell is
 * what gets a transactional message filtered as marketing.
 */
const DEFAULTS = [
  {
    key: 'order.confirmation', channel: 'email', name: 'Order confirmation',
    description: 'Sent to the buyer when an order is placed.',
    subject: 'Your Mirwal order {{orderNumber}}',
    variables: ['customerName', 'orderNumber', 'total'],
    body: `<p>Hello {{customerName}},</p>
<p>Thank you for your order. We have received <strong>{{orderNumber}}</strong> for a total of {{total}}.</p>
<p>You can follow its progress from your Mirwal account.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'order.shipped', channel: 'email', name: 'Order shipped',
    description: 'Sent when a seller marks an item shipped.',
    subject: 'Your Mirwal order {{orderNumber}} is on its way',
    variables: ['customerName', 'orderNumber', 'productName'],
    body: `<p>Hello {{customerName}},</p>
<p><strong>{{productName}}</strong> from order {{orderNumber}} has been shipped.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'seller.approved', channel: 'email', name: 'Seller application approved',
    description: 'Sent when Mirwal approves a seller application.',
    subject: 'Your Mirwal store is approved',
    variables: ['sellerName', 'storeName'],
    body: `<p>Hello {{sellerName}},</p>
<p><strong>{{storeName}}</strong> has been approved. You can now sign in to Seller Centre and start listing.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'seller.rejected', channel: 'email', name: 'Seller application rejected',
    description: 'Sent when Mirwal declines a seller application.',
    subject: 'About your Mirwal seller application',
    variables: ['sellerName', 'storeName', 'reason'],
    body: `<p>Hello {{sellerName}},</p>
<p>We were unable to approve <strong>{{storeName}}</strong> at this time.</p>
<p><strong>Reason:</strong> {{reason}}</p>
<p>You are welcome to apply again once that has been addressed.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'product.approved', channel: 'email', name: 'Listing approved',
    description: 'Sent to the seller when a listing is published.',
    subject: '{{productName}} is now live on Mirwal',
    variables: ['sellerName', 'productName'],
    body: `<p>Hello {{sellerName}},</p>
<p><strong>{{productName}}</strong> has been approved and is live on the storefront.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'product.rejected', channel: 'email', name: 'Listing rejected',
    description: 'Sent to the seller when a listing is turned down.',
    subject: 'Changes needed to {{productName}}',
    variables: ['sellerName', 'productName', 'reason'],
    body: `<p>Hello {{sellerName}},</p>
<p><strong>{{productName}}</strong> was not approved.</p>
<p><strong>Reason:</strong> {{reason}}</p>
<p>Edit the listing and submit it again once resolved.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'document.reviewed', channel: 'email', name: 'Verification document reviewed',
    description: 'Sent when Mirwal reviews a seller verification document.',
    subject: 'Your verification document has been reviewed',
    variables: ['sellerName', 'documentType', 'outcome', 'note'],
    body: `<p>Hello {{sellerName}},</p>
<p>Your <strong>{{documentType}}</strong> was reviewed and marked <strong>{{outcome}}</strong>.</p>
<p>{{note}}</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'account.password_reset', channel: 'email', name: 'Password reset link',
    description: 'Sent when someone asks to reset the password on an account.',
    subject: 'Reset your Mirwal password',
    variables: ['name', 'resetUrl', 'minutes'],
    body: `<p>Hello {{name}},</p>
<p>Someone asked to reset the password on your Mirwal account. If that was you, use this link:</p>
<p><a href="{{resetUrl}}">Reset your password</a></p>
<p>The link works once and expires in {{minutes}} minutes.</p>
<p>If it was not you, nothing has changed and you can ignore this email — your password still works.</p>
<p>&mdash; Mirwal</p>`,
  },
  {
    key: 'account.password_changed', channel: 'email', name: 'Password changed',
    description: 'Sent after a password is reset, so an unexpected change is noticed.',
    subject: 'Your Mirwal password was changed',
    variables: ['name'],
    body: `<p>Hello {{name}},</p>
<p>Your Mirwal password has just been changed, and every device signed in to your account has been signed out.</p>
<p>If this was not you, contact Mirwal support immediately &mdash; whoever did it currently has your email address.</p>
<p>&mdash; Mirwal</p>`,
  },
  {
    key: 'order.refunded', channel: 'email', name: 'Refund paid',
    description: 'Sent when a refund that had to be paid by hand is settled.',
    subject: 'Your refund for order {{orderNumber}} has been paid',
    variables: ['name', 'orderNumber', 'amount', 'reference'],
    body: `<p>Hello {{name}},</p>
<p>We have refunded <strong>Rs. {{amount}}</strong> for order <strong>{{orderNumber}}</strong>.</p>
<p>Payment reference: {{reference}}. Depending on your bank this can take a few working days to appear.</p>
<p>— Mirwal</p>`,
  },
  {
    key: 'order.otp', channel: 'sms', name: 'Delivery confirmation code',
    description: 'Short code sent by SMS on delivery.',
    subject: null,
    variables: ['code'],
    body: 'Your Mirwal delivery code is {{code}}. Share it with the courier to confirm receipt.',
  },
]

/** Insert any missing defaults, then return everything. Same lazy pattern as settings. */
export async function listTemplates(channel) {
  const existing = await query('SELECT `key`, channel FROM message_templates')
  const have = new Set(existing.map((row) => `${row.key}:${row.channel}`))
  const missing = DEFAULTS.filter((template) => !have.has(`${template.key}:${template.channel}`))

  for (const template of missing) {
    await query(
      `INSERT IGNORE INTO message_templates
         (\`key\`, channel, name, description, subject, body, variables, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(3), NOW(3))`,
      [
        template.key, template.channel, template.name, template.description,
        template.subject, template.body, JSON.stringify(template.variables),
      ],
    )
  }

  const rows = await query(
    `SELECT t.\`key\`, t.channel, t.name, t.description, t.subject, t.body, t.variables,
            t.is_active, t.updated_at, u.full_name AS updated_by_name
       FROM message_templates t
       LEFT JOIN users u ON u.id = t.updated_by
       ${channel ? 'WHERE t.channel = ?' : ''}
      ORDER BY t.channel, t.\`key\``,
    channel ? [channel] : [],
  )

  return rows.map((row) => ({
    key: row.key,
    channel: row.channel,
    name: row.name,
    description: row.description,
    subject: row.subject,
    body: row.body,
    variables: parseJsonColumn(row.variables, []),
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name ?? null,
  }))
}

/**
 * Edit a template.
 *
 * The placeholders are checked against the ones the sending code actually supplies: a
 * template referring to `{{oderNumber}}` would otherwise render that typo into a live email
 * and nobody would notice until a customer asked.
 */
export async function updateTemplate(key, channel, input, userId) {
  const template = await queryOne(
    'SELECT id, variables FROM message_templates WHERE `key` = ? AND channel = ?',
    [key, channel],
  )
  if (!template) throw notFound('Template not found.')

  const allowed = new Set(parseJsonColumn(template.variables, []))
  const used = new Set()
  for (const source of [input.subject ?? '', input.body ?? '']) {
    for (const match of String(source).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) used.add(match[1])
  }
  const unknown = [...used].filter((name) => !allowed.has(name))
  if (unknown.length) {
    throw badRequest(
      `Unknown placeholder: ${unknown.map((name) => `{{${name}}}`).join(', ')}. Available: ${[...allowed].map((name) => `{{${name}}}`).join(', ')}`,
      'UNKNOWN_PLACEHOLDER',
    )
  }

  const sets = []
  const params = []
  if (input.subject !== undefined) { sets.push('subject = ?'); params.push(input.subject) }
  if (input.body !== undefined) { sets.push('body = ?'); params.push(input.body) }
  if (input.isActive !== undefined) { sets.push('is_active = ?'); params.push(input.isActive ? 1 : 0) }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_by = ?', 'updated_at = NOW(3)')
  params.push(userId ?? null)
  await query(`UPDATE message_templates SET ${sets.join(', ')} WHERE id = ?`, [...params, template.id])
  return { key, channel }
}

/**
 * Render and deliver one message, recording the outcome.
 *
 * Never throws. Every caller is doing something more important than sending a notification,
 * and a mail failure must not take that down with it.
 *
 * @param {string} key         template key, e.g. 'order.confirmation'
 * @param {object} options
 * @param {string} options.to        email address or phone number
 * @param {number} [options.userId]  recipient, for the ledger
 * @param {object} [options.variables]
 * @param {'email'|'sms'} [options.channel]
 */
export async function send(key, { to, userId = null, variables = {}, channel = 'email', rawVariables = [] } = {}) {
  // Every path below either returns early or assigns this, and the catch covers a throw.
  let outcome
  let subject = null

  try {
    if (!to) return recordDelivery({ key, channel, to: '', userId, subject, variables, outcome: { status: 'skipped', error: 'No recipient address.' } })

    /**
     * The stored template, or the built-in default when nobody has opened the templates page
     * yet.
     *
     * Templates are seeded lazily by `listTemplates()`, so without this fallback a message
     * added in a release would silently fail until an admin happened to visit a settings
     * screen — a password reset that depends on that is a password reset that does not work.
     * Only a key with no default at all is a real failure.
     */
    const template = await queryOne(
      'SELECT subject, body, is_active FROM message_templates WHERE `key` = ? AND channel = ?',
      [key, channel],
    ) ?? (() => {
      const fallback = DEFAULTS.find((entry) => entry.key === key && entry.channel === channel)
      // A default carries no is_active column; an un-seeded template is on, not switched off.
      return fallback ? { ...fallback, is_active: 1 } : null
    })()

    if (!template) {
      return recordDelivery({ key, channel, to, userId, subject, variables, outcome: { status: 'failed', error: `No template for "${key}".` } })
    }
    // A deactivated template means an operator deliberately turned this message off.
    if (!template.is_active) {
      return recordDelivery({ key, channel, to, userId, subject, variables, outcome: { status: 'skipped', error: 'Template is switched off.' } })
    }

    if (channel === 'sms') {
      // No HTML escaping for SMS — there is no markup, and escaping would put &amp; in a text.
      const body = renderTemplate(template.body, variables, { escape: false })
      outcome = await sendSms({ to, body })
    } else {
      subject = renderTemplate(template.subject ?? '', variables)
      // `rawVariables` names the values that must NOT be HTML-escaped — a link Mirwal built,
      // where escaping "&" would break it. Everything else stays escaped.
      const html = renderTemplate(template.body, variables, { raw: rawVariables })
      outcome = await sendEmail({ to, subject, html })
    }
  } catch (error) {
    outcome = { status: 'failed', error: error.message }
  }

  return recordDelivery({ key, channel, to, userId, subject, variables, outcome })
}

async function recordDelivery({ key, channel, to, userId, subject, variables, outcome }) {
  try {
    await query(
      `INSERT INTO message_deliveries
         (public_id, template_key, channel, recipient, user_id, subject, status,
          provider, provider_ref, error_message, context, sent_at, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        key, channel, String(to).slice(0, 255), userId, subject ? subject.slice(0, 255) : null,
        outcome.status, outcome.provider ?? null,
        outcome.ref ? String(outcome.ref).slice(0, 255) : null,
        outcome.error ? String(outcome.error).slice(0, 500) : null,
        // The variables, not the rendered body: reproducing what was sent without copying
        // order and address detail into a long-lived log.
        Object.keys(variables ?? {}).length ? JSON.stringify(variables) : null,
        outcome.status === 'sent' ? new Date() : null,
      ],
    )
  } catch (error) {
    console.error('[messaging] could not record delivery of %s: %s', key, error.message)
  }
  return outcome
}

export async function listDeliveries({ page = 1, pageSize = 50, status, channel, search } = {}) {
  const where = []
  const params = []
  if (status) { where.push('d.status = ?'); params.push(status) }
  if (channel) { where.push('d.channel = ?'); params.push(channel) }
  if (search) { where.push('(d.recipient LIKE ? OR d.subject LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT d.public_id, d.template_key, d.channel, d.recipient, d.subject, d.status,
            d.provider, d.error_message, d.sent_at, d.created_at, u.full_name AS user_name
       FROM message_deliveries d
       LEFT JOIN users u ON u.id = d.user_id
       ${clause}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM message_deliveries d ${clause}`, params)
  const [stats] = await query(
    `SELECT COUNT(*) AS total, SUM(status='sent') AS sent, SUM(status='failed') AS failed,
            SUM(status='skipped') AS skipped FROM message_deliveries`,
  )

  return {
    items: rows.map((row) => ({
      id: row.public_id,
      templateKey: row.template_key,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      status: row.status,
      provider: row.provider,
      error: row.error_message,
      user: row.user_name ?? null,
      sentAt: row.sent_at,
      createdAt: row.created_at,
    })),
    total: Number(total),
    stats: {
      total: Number(stats.total),
      sent: Number(stats.sent ?? 0),
      failed: Number(stats.failed ?? 0),
      skipped: Number(stats.skipped ?? 0),
    },
  }
}

export { messagingCapabilities }
