-- ============================================================================
-- 015 — Platform settings, integrations and webhooks
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Backs the admin panel's Platform Settings, Payment Settings, Notification Settings, Search
-- Configuration, Tax & Commission, AI Configuration, Integrations and API/Webhooks pages.
-- Every one of those was a wall of toggles that reset on reload — they wrote to component
-- state and nothing else, so an admin could "turn off" cash on delivery and nothing changed.
--
-- One key/value table rather than a column per setting. These are heterogeneous, sparse and
-- change often; a wide table would mean a migration for every new toggle. `value_json` holds
-- the typed value so a boolean stays a boolean rather than becoming the string "true".
--
-- IMPORTANT: this table is NOT for secrets. Payment provider keys, JWT secrets and database
-- credentials stay in the environment (see server/.env.example) where they are not readable
-- through any admin endpoint. `is_secret` marks settings whose *value* must be redacted when
-- listed — used for things like a public webhook signing hint, never for a real credential.
-- ============================================================================

CREATE TABLE platform_settings (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Dotted namespace, e.g. 'payments.cod.enabled', 'tax.default_rate_bps', 'ai.model'.
  -- ascii + case-insensitive so 'Payments.COD' and 'payments.cod' cannot both exist.
  `key`       VARCHAR(120) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  -- First segment of the key, denormalised so the UI can fetch one settings page cheaply.
  category    VARCHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,

  -- Always a JSON document, even for a scalar: {"v": true}, {"v": 1750}, {"v": "PKR"}.
  -- Wrapping keeps json_valid() satisfied for scalars across MariaDB versions.
  value_json  LONGTEXT NOT NULL CHECK (json_valid(value_json)),
  value_type  ENUM('boolean','number','string','json') NOT NULL DEFAULT 'string',

  label       VARCHAR(150) NULL,
  description VARCHAR(500) NULL,
  is_secret   TINYINT(1) NOT NULL DEFAULT 0,

  updated_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_settings_key (`key`),
  KEY ix_settings_category (category, `key`),

  CONSTRAINT fk_settings_updater
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Third-party integrations shown on the Integrations page. Connection state and non-secret
-- configuration only; the credential itself lives in the environment.
CREATE TABLE integrations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  provider      VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name          VARCHAR(120) NOT NULL,
  category      VARCHAR(40) NOT NULL DEFAULT 'other',
  description   VARCHAR(500) NULL,

  status        ENUM('disconnected','connected','error') NOT NULL DEFAULT 'disconnected',
  -- Non-secret settings for this integration, e.g. {"region":"ap-south-1"}.
  config_json   LONGTEXT NULL CHECK (config_json IS NULL OR json_valid(config_json)),
  -- Whether the required environment credentials are present. Written by the service after a
  -- check, never a place to store the credential itself.
  last_checked_at DATETIME(3) NULL,
  last_error    VARCHAR(255) NULL,

  connected_at  DATETIME(3) NULL,
  connected_by  BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_integrations_public (public_id),
  UNIQUE KEY uq_integrations_provider (provider),
  KEY ix_integrations_status (status),

  CONSTRAINT fk_integrations_connector
    FOREIGN KEY (connected_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Outbound webhook endpoints registered by an admin.
CREATE TABLE webhook_endpoints (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  name          VARCHAR(120) NOT NULL,
  url           VARCHAR(500) NOT NULL,
  -- JSON array of event names, e.g. ["order.paid","product.approved"].
  events_json   LONGTEXT NOT NULL CHECK (json_valid(events_json)),

  -- Only ever the LAST FOUR characters of the signing secret, for display. The secret itself
  -- is shown once at creation and never stored in readable form — storing it here would put a
  -- live credential behind a read endpoint.
  secret_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  secret_last4  CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  status        ENUM('active','paused','failing') NOT NULL DEFAULT 'active',
  last_delivery_at     DATETIME(3) NULL,
  last_delivery_status SMALLINT UNSIGNED NULL,
  consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,

  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_webhooks_public (public_id),
  KEY ix_webhooks_status (status),

  CONSTRAINT fk_webhooks_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
