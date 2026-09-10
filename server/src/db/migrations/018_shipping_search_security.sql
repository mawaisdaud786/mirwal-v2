-- ============================================================================
-- 018 — Shipping, search telemetry, two-factor authentication and backups
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- The last group of admin pages that had no table behind them. Each block below exists
-- because a page could not be made honest without it — not to make a screen look busy.
--
--  * shipping_zones / shipping_methods / warehouses
--      Shipping was a wall of invented couriers and rates. `orders.shipping_fee` has always
--      existed but nothing decided it; these tables are what a quote is computed from, so
--      the admin page configures a number checkout actually charges.
--
--  * search_queries
--      Every "AI analytics" screen claimed to rank shopper queries while nothing recorded
--      one. This is the record: what was typed, how many results came back, and whether a
--      product was opened afterwards. It is deliberately thin — no profile is built from it.
--
--  * users.totp_* / user_backup_codes
--      Two-factor was a toggle that saved nowhere. Real TOTP (RFC 6238) needs a per-user
--      secret and single-use recovery codes; both are stored here, the codes hashed.
--
--  * backup_runs
--      A record of database exports actually taken by the server, replacing an invented
--      "285.6 GB across Google Drive/S3/Dropbox" storage breakdown.
--
-- Additive only: no table is dropped and no existing column changes meaning.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shipping
-- ---------------------------------------------------------------------------

-- A destination grouping. Pakistan ships domestically by city tier far more often than by
-- country, so a zone matches on city names as well as country codes.
CREATE TABLE shipping_zones (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  name          VARCHAR(120) NOT NULL,
  slug          VARCHAR(140) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  description   VARCHAR(500) NULL,

  -- ISO-3166-1 alpha-2 codes, e.g. ["PK"]. An empty array means "any country".
  country_codes LONGTEXT NOT NULL DEFAULT '[]' CHECK (json_valid(country_codes)),
  -- Lower-cased city names, e.g. ["karachi","lahore"]. Empty means "any city in those
  -- countries", which is how a catch-all rest-of-country zone is expressed.
  cities        LONGTEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cities)),

  -- Lowest priority wins when several zones match, so a specific city zone can sit in front
  -- of a nationwide fallback without deleting the fallback.
  priority      INT NOT NULL DEFAULT 100,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_shipping_zones_public (public_id),
  UNIQUE KEY uq_shipping_zones_slug (slug),
  KEY ix_shipping_zones_match (is_active, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- What a shopper can choose within a zone, and what it costs.
CREATE TABLE shipping_methods (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  zone_id           BIGINT UNSIGNED NOT NULL,

  name              VARCHAR(120) NOT NULL,
  -- Shown to the shopper at checkout, e.g. "Delivered in 2-4 working days".
  description       VARCHAR(300) NULL,
  carrier           VARCHAR(80) NULL,

  -- flat        : base_amount, whatever the basket is worth
  -- free_over   : base_amount, but free once the subtotal reaches free_over_amount
  -- percentage  : rate_bps of the subtotal, clamped to [min_amount, max_amount]
  rate_type         ENUM('flat','free_over','percentage') NOT NULL DEFAULT 'flat',
  base_amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  free_over_amount  DECIMAL(12,2) NULL,
  -- Basis points, so 250 = 2.5%. Percentages are never stored as floats.
  rate_bps          INT UNSIGNED NULL,
  min_amount        DECIMAL(12,2) NULL,
  max_amount        DECIMAL(12,2) NULL,

  min_days          SMALLINT UNSIGNED NULL,
  max_days          SMALLINT UNSIGNED NULL,

  sort_order        INT NOT NULL DEFAULT 100,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_shipping_methods_public (public_id),
  KEY ix_shipping_methods_zone (zone_id, is_active, sort_order),

  CONSTRAINT fk_shipping_methods_zone
    FOREIGN KEY (zone_id) REFERENCES shipping_zones (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Where stock is dispatched from. Referenced by inventory reporting rather than owning
-- stock levels, which stay on `inventory` so no existing behaviour changes.
CREATE TABLE warehouses (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  name          VARCHAR(120) NOT NULL,
  code          VARCHAR(30) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,

  address_line  VARCHAR(255) NOT NULL DEFAULT '',
  city          VARCHAR(100) NOT NULL,
  region        VARCHAR(100) NOT NULL DEFAULT '',
  postal_code   VARCHAR(20) NOT NULL DEFAULT '',
  country_code  CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PK',
  contact_phone VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',

  is_default    TINYINT(1) NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouses_public (public_id),
  UNIQUE KEY uq_warehouses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ---------------------------------------------------------------------------
-- Search telemetry
-- ---------------------------------------------------------------------------

-- One row per search. `user_id` is nullable and set only for a signed-in shopper; nothing
-- here identifies an anonymous visitor, and no IP address or user agent is kept.
CREATE TABLE search_queries (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- As typed, trimmed and length-capped.
  term           VARCHAR(200) NOT NULL,
  -- Lower-cased and whitespace-collapsed, so "Blue  LAMP" and "blue lamp" group together.
  normalised     VARCHAR(200) NOT NULL,

  -- 'search' = the catalogue search box, 'assistant' = a sentence sent to the AI assistant.
  source         ENUM('search','assistant') NOT NULL DEFAULT 'search',
  user_id        BIGINT UNSIGNED NULL,

  result_count   INT UNSIGNED NOT NULL DEFAULT 0,
  -- Set when the shopper opens a product from these results: the click-through signal that
  -- makes a zero-result or bad-result query visible rather than merely popular.
  clicked_product_id BIGINT UNSIGNED NULL,
  clicked_at     DATETIME(3) NULL,

  -- How long the search itself took, so a slow query shows up as a performance issue.
  duration_ms    INT UNSIGNED NOT NULL DEFAULT 0,

  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_search_queries_public (public_id),
  KEY ix_search_queries_term (normalised, created_at),
  KEY ix_search_queries_recent (created_at),
  -- Supports "queries that returned nothing", the most actionable report of the set.
  KEY ix_search_queries_empty (result_count, created_at),

  CONSTRAINT fk_search_queries_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_search_queries_product
    FOREIGN KEY (clicked_product_id) REFERENCES products (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ---------------------------------------------------------------------------
-- Two-factor authentication
-- ---------------------------------------------------------------------------

-- The shared secret is base32, generated server-side and shown to the user exactly once
-- during enrolment. `totp_enabled_at` being NULL means enrolment was started but never
-- confirmed with a working code, which must not lock anyone out.
ALTER TABLE users
  ADD COLUMN totp_secret     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER password_hash,
  ADD COLUMN totp_enabled_at DATETIME(3) NULL AFTER totp_secret;

-- Recovery codes, stored as hashes for the same reason passwords are: a database copy must
-- not hand over a second factor. One row per code; `used_at` makes each single-use.
CREATE TABLE user_backup_codes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  code_hash  CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  used_at    DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_backup_codes_hash (user_id, code_hash),
  KEY ix_backup_codes_user (user_id, used_at),

  CONSTRAINT fk_backup_codes_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ---------------------------------------------------------------------------
-- Database backups
-- ---------------------------------------------------------------------------

-- A record of exports the server actually wrote. The file lives outside the web root and is
-- only ever readable through an authenticated download, exactly like a seller document.
CREATE TABLE backup_runs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- Generated, never client-supplied.
  stored_name  VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status       ENUM('running','completed','failed') NOT NULL DEFAULT 'running',

  table_count  INT UNSIGNED NOT NULL DEFAULT 0,
  row_count    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  size_bytes   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  checksum     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  error        VARCHAR(500) NULL,

  duration_ms  INT UNSIGNED NOT NULL DEFAULT 0,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_backup_runs_public (public_id),
  UNIQUE KEY uq_backup_runs_stored (stored_name),
  KEY ix_backup_runs_recent (created_at),

  CONSTRAINT fk_backup_runs_user
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ---------------------------------------------------------------------------
-- Settings this migration makes real
-- ---------------------------------------------------------------------------
--
-- Maintenance mode was a screen with a toggle that changed nothing. These keys are read by
-- `middleware/maintenance.js` on every request, so switching it on genuinely closes the
-- storefront while leaving the admin panel reachable — otherwise an admin would lock
-- themselves out of the only control that turns it off again.

INSERT INTO platform_settings (`key`, category, value_json, value_type, label, description) VALUES
  ('maintenance.enabled', 'maintenance', '{"v": false}', 'boolean',
   'Maintenance mode',
   'Closes the storefront and seller portal. The admin panel and sign-in stay reachable so it can be switched off again.'),
  ('maintenance.message', 'maintenance', '{"v": "Mirwal is briefly down for maintenance. We will be back shortly."}', 'string',
   'Message shown to visitors',
   'Returned with every blocked request so the storefront can explain the outage.'),
  ('maintenance.allow_ips', 'maintenance', '{"v": []}', 'json',
   'Always allowed IP addresses',
   'Requests from these addresses bypass maintenance mode. Leave empty to rely on staff sign-in alone.'),
  ('security.require_2fa_for_staff', 'security', '{"v": false}', 'boolean',
   'Require two-factor for staff',
   'Staff without two-factor enrolled are asked to set it up before the admin panel will load.'),
  ('shipping.default_fee', 'shipping', '{"v": 0}', 'number',
   'Fallback shipping fee',
   'Charged when no shipping zone matches the delivery address.')
ON DUPLICATE KEY UPDATE `key` = `key`;
