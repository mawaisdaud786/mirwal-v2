import 'dotenv/config'

/**
 * Environment configuration.
 *
 * Every value comes from the environment — nothing secret is ever committed. The process
 * refuses to start if a required secret is missing or left at a placeholder, because a
 * silently-defaulted JWT secret is indistinguishable from no authentication at all.
 */

const required = (name) => {
  const value = process.env[name]
  if (!value || value.trim() === '' || value.startsWith('change-me')) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
      `Copy server/.env.example to server/.env and set a real value.`,
    )
  }
  return value
}

const optional = (name, fallback) => process.env[name] ?? fallback
const int = (name, fallback) => Number.parseInt(process.env[name] ?? String(fallback), 10)
const bool = (name, fallback) => (process.env[name] ?? String(fallback)).toLowerCase() === 'true'

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  get isProduction() { return this.nodeEnv === 'production' },
  /**
   * True while the integration suite is running.
   *
   * Used only to relax the global rate limiter (see app.js). Nothing else branches on it —
   * a test environment that behaves differently from production is a test environment that
   * proves less than it appears to.
   */
  get isTest() { return this.nodeEnv === 'test' || process.env.MIRWAL_TEST === '1' },

  port: int('PORT', 4000),
  apiPrefix: optional('API_PREFIX', '/api/v1'),

  // Comma-separated allowlist — never a wildcard, because these endpoints run with
  // `credentials: true` and a wildcard origin plus credentials is how a third-party page
  // gets to make authenticated calls on a signed-in user's behalf.
  //
  // Mirwal serves three separate frontend applications, so three origins are expected in
  // every environment: the storefront, the admin panel and the seller portal. The dev
  // default lists the three Vite ports; production sets mirwal.pk, admin.mirwal.pk and
  // seller.mirwal.pk via CORS_ORIGINS.
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
    .split(',').map((origin) => origin.trim()).filter(Boolean),

  /**
   * Where the storefront is served from, for links in outgoing email.
   *
   * Read from the environment rather than from the request's Host or Origin header. A password
   * reset link built from a header an attacker controls is a link that points wherever they
   * choose, and the recipient has no way to tell.
   */
  storefrontUrl: optional('STOREFRONT_URL', 'http://localhost:5173').replace(/\/+$/, ''),

  db: {
    host: optional('DB_HOST', '127.0.0.1'),
    port: int('DB_PORT', 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: required('DB_NAME'),
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
    // cPanel/CloudLinux caps concurrent connections per account, so the pool stays small
    // and queries are expected to be short. See docs/DATABASE.md.
    connectTimeout: int('DB_CONNECT_TIMEOUT', 10000),
  },

  auth: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: optional('JWT_ACCESS_TTL', '15m'),
    refreshTtlDays: int('JWT_REFRESH_TTL_DAYS', 30),
    cookieName: optional('REFRESH_COOKIE_NAME', 'mirwal_rt'),
    cookieSecure: bool('REFRESH_COOKIE_SECURE', false),
    cookieSameSite: optional('REFRESH_COOKIE_SAMESITE', 'lax'),
    cookieDomain: process.env.REFRESH_COOKIE_DOMAIN || undefined,
  },

  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    max: int('RATE_LIMIT_MAX', 300),
    authMax: int('RATE_LIMIT_AUTH_MAX', 10),
  },

  /**
   * Payments. Each provider is optional and independently enabled: a provider whose secrets
   * are absent is reported as unavailable by GET /payments/methods and is rejected at
   * checkout, rather than half-working or silently falling back to another method.
   *
   * `required()` is deliberately NOT used here. An unconfigured gateway must not stop the
   * whole server from booting — Cash on Delivery has always worked without any of this, and
   * a developer running locally should not need live payment credentials to start the app.
   */
  payments: {
    // Where the provider sends the shopper back after an off-site redirect (wallets) or a
    // 3-D Secure challenge (card). The frontend origin, not the API's.
    returnUrlBase: optional('PAYMENT_RETURN_URL_BASE', 'http://localhost:5173'),

    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      get enabled() { return Boolean(this.secretKey && this.publishableKey) },
    },

    easypaisa: {
      storeId: process.env.EASYPAISA_STORE_ID || '',
      hashKey: process.env.EASYPAISA_HASH_KEY || '',
      // Sandbox and production have different hosts; kept configurable so switching does not
      // require a code change.
      baseUrl: optional('EASYPAISA_BASE_URL', 'https://easypaystg.easypaisa.com.pk'),
      get enabled() { return Boolean(this.storeId && this.hashKey) },
    },

    jazzcash: {
      merchantId: process.env.JAZZCASH_MERCHANT_ID || '',
      password: process.env.JAZZCASH_PASSWORD || '',
      integritySalt: process.env.JAZZCASH_INTEGRITY_SALT || '',
      baseUrl: optional('JAZZCASH_BASE_URL', 'https://sandbox.jazzcash.com.pk'),
      get enabled() { return Boolean(this.merchantId && this.password && this.integritySalt) },
    },
  },

  /**
   * Transactional messaging.
   *
   * Both channels follow the same rule as the payment providers above: a channel whose
   * credentials are absent is reported as unavailable and nothing is attempted, rather than
   * silently doing nothing while the UI claims a message was sent.
   */
  mail: {
    host: optional('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    // Implicit TLS on 465; STARTTLS on 587.
    secure: bool('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: optional('MAIL_FROM', 'Mirwal <no-reply@mirwal.pk>'),
    replyTo: optional('MAIL_REPLY_TO', ''),
    get enabled() { return Boolean(this.host) },
  },

  sms: {
    // Generic HTTP gateway: most Pakistani providers accept a GET/POST with these fields,
    // so this stays provider-agnostic rather than hard-coding one vendor's SDK.
    apiUrl: optional('SMS_API_URL', ''),
    apiKey: process.env.SMS_API_KEY || '',
    sender: optional('SMS_SENDER', 'Mirwal'),
    // How the gateway wants the request. See lib/media.js's sibling note in mailer.js: the
    // local providers do not agree, and this keeps switching between them a config change.
    style: optional('SMS_API_STYLE', 'json'),
    // What the gateway calls each field. Defaults suit a modern JSON API; the older reseller
    // panels typically want mobile/message/mask/key.
    params: {
      to: optional('SMS_PARAM_TO', 'to'),
      message: optional('SMS_PARAM_MESSAGE', 'message'),
      from: optional('SMS_PARAM_FROM', 'from'),
      key: optional('SMS_PARAM_KEY', 'key'),
    },
    get enabled() { return Boolean(this.apiUrl && this.apiKey) },
  },

  uploads: {
    // Where seller verification documents are written. Outside the web root by design —
    // nothing here is ever served statically.
    dir: optional('UPLOAD_DIR', './storage/uploads'),
    maxBytes: int('UPLOAD_MAX_BYTES', 5 * 1024 * 1024),
  },

  media: {
    // Public images: product photos, store logos and banners. Served statically, which is
    // exactly why it is a different directory from `uploads` — see lib/media.js. A single
    // shared root would mean one misconfigured static handler exposes CNICs.
    dir: optional('MEDIA_DIR', './storage/media'),
    maxBytes: int('MEDIA_MAX_BYTES', 5 * 1024 * 1024),
  },

  backups: {
    // Database exports. Separate from uploads so a misconfigured upload directory can never
    // put a full database dump somewhere seller documents are served from.
    dir: optional('BACKUP_DIR', './storage/backups'),
    // Older runs are pruned once this many exist, so a scheduled backup cannot fill a disk.
    keep: int('BACKUP_KEEP', 10),
  },

  logLevel: optional('LOG_LEVEL', 'info'),
}
