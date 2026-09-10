import { createHash, randomBytes } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { parseJsonColumn } from '../../lib/json.js'
import { env } from '../../config/env.js'

/**
 * Platform settings, integrations and webhooks.
 *
 * Backs the admin panel's settings pages, which previously wrote to component state only —
 * every toggle reset on reload, so "disable cash on delivery" changed nothing.
 *
 * The hard rule here: **no secrets in the database.** Payment keys, JWT secrets and database
 * credentials live in the environment and are never readable through an admin endpoint. The
 * integrations surface reports whether the required environment variables are *present*, which
 * is what an admin actually needs to know, without ever returning their values.
 *
 * Webhook signing secrets are generated, shown once, and stored only as a SHA-256 hash plus
 * the last four characters — the same shape as a password, because that is what it is.
 */

/** Values every settings page expects to exist, with the defaults the code already assumes. */
const DEFAULTS = [
  ['payments.cod.enabled', 'boolean', true, 'Cash on delivery', 'Allow shoppers to pay on delivery.'],
  ['payments.card.enabled', 'boolean', true, 'Card payments', 'Requires Stripe keys in the environment.'],
  ['payments.wallet.enabled', 'boolean', true, 'Wallets (JazzCash / EasyPaisa)', 'Requires provider credentials in the environment.'],
  ['finance.commission_bps', 'number', 1000, 'Marketplace commission', 'Basis points retained per sale (1000 = 10%).'],
  ['finance.payout_minimum', 'number', 1000, 'Minimum withdrawal', 'Smallest payout Mirwal will process, in PKR.'],
  ['tax.default_rate_bps', 'number', 0, 'Default tax rate', 'Basis points applied when a product has no specific rate.'],
  ['catalog.require_approval', 'boolean', true, 'Review new listings', 'Seller listings wait for admin approval before going live.'],
  ['search.results_per_page', 'number', 24, 'Results per page', 'How many products a search page returns.'],
  ['notifications.order_email', 'boolean', true, 'Order emails', 'Email shoppers when an order changes state.'],
  ['ai.enabled', 'boolean', true, 'AI shopping assistant', 'Show the assistant on the storefront.'],
  ['ai.max_results', 'number', 8, 'Assistant results', 'How many products the assistant may recommend at once.'],

  // --- Seller onboarding (migration 020) ------------------------------------
  ['sellers.require_email_verification', 'boolean', true, 'Verified email before applying', 'An applicant must confirm their email address before a seller application can be submitted.'],
  ['sellers.require_phone_verification', 'boolean', true, 'Verified phone before applying', 'An applicant must confirm their mobile number by OTP before a seller application can be submitted.'],
  ['sellers.application_expiry_days', 'number', 30, 'Application expiry (days)', 'How long an application may sit awaiting more information before it expires.'],
  ['sellers.require_bank_before_payout', 'boolean', true, 'Verified payout account before withdrawal', 'Sellers may list and sell without bank details, but cannot withdraw until an account is verified.'],
  ['sellers.bank_change_hold_hours', 'number', 72, 'Payout hold after a bank change (hours)', 'Withdrawals are held for this long after a seller changes their payout destination.'],
  ['sellers.agreement_version', 'string', '1.0', 'Seller agreement version', 'Recorded against each application so it is provable which terms were accepted.'],

  // --- Fulfilment and money (migration 021) ---------------------------------
  // Note the existing keys these deliberately do NOT duplicate: the minimum withdrawal is
  // `finance.payout_minimum` above, and the tax rate is `tax.default_rate_bps`.
  ['finance.payout_hold_days', 'number', 7, 'Payout hold (days after delivery)', 'Earnings become withdrawable this many days after an item is delivered, so a return filed inside the window is still recoverable.'],
  ['finance.withholding_tax_bps', 'number', 0, 'Withholding tax on payouts', 'Deducted from each payout and recorded as a tax_withheld ledger entry. 100 = 1.00%.'],
  ['orders.return_window_days', 'number', 7, 'Return window (days after delivery)', 'How long a buyer has to file a return once an item is delivered.'],
  ['orders.dispatch_sla_hours', 'number', 48, 'Dispatch promise (hours)', 'How long a seller has to hand an order to a courier before it counts as late.'],
  ['tax.prices_include_tax', 'boolean', true, 'Displayed prices include tax', 'When on, the listed price is tax-inclusive and tax is shown as a breakdown rather than added at checkout.'],
  // Printed at the top of every tax invoice. Blank is allowed — a marketplace that is not yet
  // sales-tax registered still issues invoices, it simply has no STRN to quote.
  ['company.legal_name', 'string', 'Mirwal', 'Registered business name', 'The name Mirwal invoices under.'],
  ['company.ntn', 'string', '', 'NTN', 'Mirwal’s tax number, shown on invoices.'],
  ['company.strn', 'string', '', 'Sales tax number (STRN)', 'Shown on invoices when Mirwal is registered for sales tax.'],
  ['company.address', 'string', '', 'Registered address', 'The address printed on invoices.'],
  ['tax.invoice_prefix', 'string', 'MIR', 'Invoice number prefix', 'Invoices are numbered <prefix>-<year>-<sequence>, gapless within a year.'],
]

/** Wrapped as {"v": …} so json_valid() accepts scalars on every MariaDB build. */
const wrap = (value) => JSON.stringify({ v: value })
const unwrap = (column) => parseJsonColumn(column, { v: null })?.v ?? null

/**
 * Insert any default that has no row yet.
 *
 * Seeding lazily means a fresh database and an upgraded one behave identically, and a new
 * setting added to DEFAULTS appears without a migration.
 *
 * Every entry point that touches a setting calls this first — not just the read path. It used
 * to run only in `listSettings`, which made a declared default that nobody had viewed yet
 * behave as if it did not exist: saving `payments.cod.enabled` on a fresh install was rejected
 * as an unknown key until an admin happened to open the settings page first.
 */
async function ensureDefaults() {
  const existing = await query('SELECT `key` FROM platform_settings')
  const have = new Set(existing.map((row) => row.key))
  const missing = DEFAULTS.filter(([key]) => !have.has(key))
  if (!missing.length) return

  await withTransaction(async (connection) => {
    for (const [key, type, value, label, description] of missing) {
      await connection.execute(
        `INSERT IGNORE INTO platform_settings
           (\`key\`, category, value_json, value_type, label, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [key, key.split('.')[0], wrap(value), type, label, description],
      )
    }
  })
}

/** Insert any missing defaults, then return everything. */
export async function listSettings(category) {
  await ensureDefaults()

  const where = category ? 'WHERE category = ?' : ''
  const rows = await query(
    `SELECT s.\`key\`, s.category, s.value_json, s.value_type, s.label, s.description,
            s.is_secret, s.updated_at, u.full_name AS updated_by_name
       FROM platform_settings s
       LEFT JOIN users u ON u.id = s.updated_by
       ${where}
      ORDER BY s.category, s.\`key\``,
    category ? [category] : [],
  )

  return rows.map((row) => ({
    key: row.key,
    category: row.category,
    // A setting marked secret reports only that it is set, never what to.
    value: row.is_secret ? null : unwrap(row.value_json),
    isSecret: Boolean(row.is_secret),
    type: row.value_type,
    label: row.label,
    description: row.description,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name ?? null,
  }))
}

const TYPE_CHECK = {
  boolean: (value) => typeof value === 'boolean',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  string: (value) => typeof value === 'string',
  json: () => true,
}

/**
 * Update settings in one call.
 *
 * Batched because a settings page is a form: saving eleven toggles as eleven requests means a
 * partial save is visible if one fails halfway. This applies all of them or none.
 */
export async function updateSettings(updates, userId) {
  const keys = Object.keys(updates)
  if (!keys.length) throw badRequest('No settings were supplied.', 'NOTHING_TO_UPDATE')

  // A declared default is a known key whether or not anything has read it yet.
  await ensureDefaults()

  const rows = await query(
    `SELECT \`key\`, value_type FROM platform_settings WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
    keys,
  )
  const known = new Map(rows.map((row) => [row.key, row.value_type]))
  const unknown = keys.filter((key) => !known.has(key))
  if (unknown.length) throw badRequest(`Unknown setting: ${unknown.join(', ')}`, 'UNKNOWN_SETTING')

  for (const key of keys) {
    const type = known.get(key)
    if (!TYPE_CHECK[type](updates[key])) {
      throw badRequest(`"${key}" expects a ${type}.`, 'INVALID_SETTING_TYPE')
    }
  }

  await withTransaction(async (connection) => {
    for (const key of keys) {
      await connection.execute(
        'UPDATE platform_settings SET value_json = ?, updated_by = ?, updated_at = NOW(3) WHERE `key` = ?',
        [wrap(updates[key]), userId ?? null, key],
      )
    }
  })

  return { updated: keys.length, keys }
}

/**
 * Read one setting's value, for other services.
 *
 * Falls back to the DEFAULTS registry before the caller's own `fallback`, so a declared
 * default is honoured on a database where nobody has opened the settings page yet. Without
 * that, each caller carries its own private idea of the default and the two can silently
 * disagree — which is exactly how a commission rate ends up depending on whether an admin
 * happened to visit a screen.
 */
export async function getSetting(key, fallback = null) {
  const row = await queryOne('SELECT value_json FROM platform_settings WHERE `key` = ?', [key])
  if (row) return unwrap(row.value_json)
  const declared = DEFAULTS.find(([name]) => name === key)
  return declared ? declared[2] : fallback
}

/** Read one setting as a number, clamped to a range. Used by the money and SLA paths. */
export async function getNumericSetting(key, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER }) {
  const raw = await getSetting(key, fallback)
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/**
 * The integrations Mirwal knows about, and which environment credentials each needs.
 *
 * `configured` is computed from the environment at read time — never stored, never returned as
 * a value. An admin learns "Stripe is configured" without the endpoint being able to leak the
 * key itself.
 */
const KNOWN_INTEGRATIONS = [
  // `enabled` is env.js's own getter for "every credential this provider needs is present",
  // so this cannot drift from what the payment code actually requires to run.
  { provider: 'stripe', name: 'Stripe', category: 'payments', description: 'Card payments.' },
  { provider: 'jazzcash', name: 'JazzCash', category: 'payments', description: 'Mobile wallet payments.' },
  { provider: 'easypaisa', name: 'EasyPaisa', category: 'payments', description: 'Mobile wallet payments.' },
]

/** Whether this provider's credentials are present in the environment. Never their values. */
const credentialsPresent = (provider) => Boolean(env.payments?.[provider]?.enabled)

export async function listIntegrations() {
  const stored = await query('SELECT provider, status, config_json, last_checked_at, last_error, connected_at FROM integrations')
  const byProvider = new Map(stored.map((row) => [row.provider, row]))

  return KNOWN_INTEGRATIONS.map((integration) => {
    const row = byProvider.get(integration.provider)
    const configured = credentialsPresent(integration.provider)
    return {
      provider: integration.provider,
      name: integration.name,
      category: integration.category,
      description: integration.description,
      // Environment presence is the truth; the stored status is only what an admin last set.
      credentialsPresent: configured,
      status: !configured ? 'disconnected' : (row?.status ?? 'connected'),
      config: row ? parseJsonColumn(row.config_json, {}) : {},
      lastCheckedAt: row?.last_checked_at ?? null,
      lastError: row?.last_error ?? null,
      connectedAt: row?.connected_at ?? null,
    }
  })
}

export async function updateIntegration(provider, { status, config }, userId) {
  const known = KNOWN_INTEGRATIONS.find((integration) => integration.provider === provider)
  if (!known) throw notFound('Integration not found.')

  await query(
    `INSERT INTO integrations
       (public_id, provider, name, category, description, status, config_json,
        connected_at, connected_by, last_checked_at, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3), NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       config_json = COALESCE(VALUES(config_json), config_json),
       last_checked_at = NOW(3),
       updated_at = NOW(3)`,
    [
      provider, known.name, known.category, known.description,
      status ?? 'connected', config ? JSON.stringify(config) : null, userId ?? null,
    ],
  )
  return listIntegrations().then((all) => all.find((item) => item.provider === provider))
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Events an endpoint may subscribe to. Anything outside this list is rejected. */
export const WEBHOOK_EVENTS = [
  'order.created', 'order.paid', 'order.shipped', 'order.delivered', 'order.cancelled',
  'product.approved', 'product.rejected',
  'seller.approved', 'seller.suspended',
  'payout.paid', 'refund.created',
]

const hashSecret = (secret) => createHash('sha256').update(secret).digest('hex')

function shapeWebhook(row) {
  return {
    id: row.public_id,
    name: row.name,
    url: row.url,
    events: parseJsonColumn(row.events_json, []),
    // Never the secret — only enough to recognise which one this is.
    secretHint: `••••${row.secret_last4}`,
    status: row.status,
    lastDeliveryAt: row.last_delivery_at,
    lastDeliveryStatus: row.last_delivery_status,
    consecutiveFailures: Number(row.consecutive_failures),
    createdAt: row.created_at,
  }
}

export async function listWebhooks() {
  const rows = await query('SELECT * FROM webhook_endpoints WHERE deleted_at IS NULL ORDER BY created_at DESC')
  return rows.map(shapeWebhook)
}

export async function createWebhook(input, userId) {
  const unknown = input.events.filter((event) => !WEBHOOK_EVENTS.includes(event))
  if (unknown.length) throw badRequest(`Unknown event: ${unknown.join(', ')}`, 'UNKNOWN_EVENT')
  // http:// would send Mirwal's signed payloads, including order and customer data, in clear
  // text across the network.
  if (!/^https:\/\//i.test(input.url)) {
    throw badRequest('Webhook URLs must use https.', 'INSECURE_WEBHOOK_URL')
  }

  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  const [row] = await query(
    `INSERT INTO webhook_endpoints
       (public_id, name, url, events_json, secret_hash, secret_last4, status, created_by, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, 'active', ?, NOW(3), NOW(3))
     RETURNING public_id`,
    [input.name, input.url, JSON.stringify(input.events), hashSecret(secret), secret.slice(-4), userId ?? null],
  )

  // The only time the secret is ever returned. It is not recoverable afterwards.
  return { id: row.public_id, secret }
}

export async function updateWebhook(publicId, input) {
  const webhook = await queryOne('SELECT id FROM webhook_endpoints WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!webhook) throw notFound('Webhook not found.')

  const sets = []
  const params = []
  if (input.name !== undefined) { sets.push('name = ?'); params.push(input.name) }
  if (input.url !== undefined) {
    if (!/^https:\/\//i.test(input.url)) throw badRequest('Webhook URLs must use https.', 'INSECURE_WEBHOOK_URL')
    sets.push('url = ?'); params.push(input.url)
  }
  if (input.events !== undefined) {
    const unknown = input.events.filter((event) => !WEBHOOK_EVENTS.includes(event))
    if (unknown.length) throw badRequest(`Unknown event: ${unknown.join(', ')}`, 'UNKNOWN_EVENT')
    sets.push('events_json = ?'); params.push(JSON.stringify(input.events))
  }
  if (input.status !== undefined) { sets.push('status = ?'); params.push(input.status) }
  if (!sets.length) throw badRequest('No changes were supplied.', 'NOTHING_TO_UPDATE')

  sets.push('updated_at = NOW(3)')
  await query(`UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE id = ?`, [...params, webhook.id])
  return publicId
}

export async function deleteWebhook(publicId) {
  const webhook = await queryOne('SELECT id, name FROM webhook_endpoints WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!webhook) throw notFound('Webhook not found.')
  await query('UPDATE webhook_endpoints SET deleted_at = NOW(3), updated_at = NOW(3) WHERE id = ?', [webhook.id])
  return { name: webhook.name }
}

/** Rotate a secret, returning the new one once. The old one stops working immediately. */
export async function rotateWebhookSecret(publicId) {
  const webhook = await queryOne('SELECT id FROM webhook_endpoints WHERE public_id = ? AND deleted_at IS NULL', [publicId])
  if (!webhook) throw notFound('Webhook not found.')
  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  await query(
    'UPDATE webhook_endpoints SET secret_hash = ?, secret_last4 = ?, updated_at = NOW(3) WHERE id = ?',
    [hashSecret(secret), secret.slice(-4), webhook.id],
  )
  return { secret }
}
