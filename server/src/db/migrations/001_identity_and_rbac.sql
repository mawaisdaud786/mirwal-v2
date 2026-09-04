-- ============================================================================
-- 001 — Identity, RBAC, sessions and audit
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Conventions used throughout every Mirwal migration:
--   * lowercase snake_case names — production is Linux (lower_case_table_names=0,
--     case-sensitive) while Windows development is 1. Lowercase everywhere is the only
--     spelling that behaves identically on both.
--   * utf8mb4 / utf8mb4_unicode_520_ci declared explicitly on every table and text column.
--     The production server default is latin1; nothing here may inherit it.
--     utf8mb4_uca1400_* collations are 11.5+ and deliberately NOT used.
--   * utf8mb4_bin for identifiers (email, slug, sku, token hashes) so comparison is
--     deterministic and case/accent folding cannot merge two distinct values.
--   * DATETIME(3) storing UTC, never TIMESTAMP — MariaDB 10.11's TIMESTAMP is 32-bit and
--     overflows in 2038. Orders and audit records must outlive that.
--   * ROW_FORMAT=DYNAMIC — a utf8mb4 VARCHAR(255) index key is 1020 bytes, over the
--     767-byte limit of COMPACT/REDUNDANT.
--   * BIGINT UNSIGNED surrogate keys, never exposed externally. Public references use the
--     separate public_id column, because MariaDB does not persist AUTO_INCREMENT across
--     restart and ids can be reused.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- Stored already lower-cased by the application; utf8mb4_bin makes the unique index
  -- exact, so accent folding can never merge two different addresses.
  email             VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  email_verified_at DATETIME(3)  NULL DEFAULT NULL,

  -- Pakistan-focused: E.164, nullable because email-only signup is allowed.
  phone             VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  phone_verified_at DATETIME(3)  NULL DEFAULT NULL,

  -- scrypt output, self-describing: scrypt$N$r$p$salt$hash. No native crypto dependency,
  -- which keeps the app installable on cPanel without a compiler.
  password_hash     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_set_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  full_name         VARCHAR(150) NOT NULL,

  status            ENUM('active','pending','suspended','deleted') NOT NULL DEFAULT 'pending',

  failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until      DATETIME(3)  NULL DEFAULT NULL,
  last_login_at     DATETIME(3)  NULL DEFAULT NULL,

  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)  NULL DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY ix_users_status (status),
  KEY ix_users_created_at (created_at),

  CONSTRAINT ck_users_email_lower CHECK (email = LOWER(email))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- roles
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  -- System roles cannot be renamed or deleted through the admin UI.
  is_system   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_slug (slug)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- permissions — granular capability strings, e.g. product.create, order.refund
-- ----------------------------------------------------------------------------
CREATE TABLE permissions (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  -- Grouping label for the admin permissions matrix (catalog, orders, sellers, ...).
  area        VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_slug (slug),
  KEY ix_permissions_area (area)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- role_permissions
-- ----------------------------------------------------------------------------
CREATE TABLE role_permissions (
  role_id       SMALLINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (role_id, permission_id),
  KEY ix_role_permissions_permission (permission_id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- user_roles — a user may legitimately hold several roles (a seller who also buys).
-- ----------------------------------------------------------------------------
CREATE TABLE user_roles (
  user_id     BIGINT UNSIGNED   NOT NULL,
  role_id     SMALLINT UNSIGNED NOT NULL,
  granted_by  BIGINT UNSIGNED   NULL DEFAULT NULL,
  created_at  DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  KEY ix_user_roles_role (role_id),
  KEY ix_user_roles_granted_by (granted_by),
  CONSTRAINT fk_user_roles_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_roles_role
    FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Keep the audit trail if the granting admin is later removed.
  CONSTRAINT fk_user_roles_granted_by
    FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- refresh_tokens
--
-- Only a SHA-256 hash of the token is stored, so a database leak does not hand an
-- attacker usable sessions. Rotation: issuing a new token sets replaced_by_id on the old
-- one, which makes token reuse after rotation detectable.
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  token_hash     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at     DATETIME(3)  NOT NULL,
  revoked_at     DATETIME(3)  NULL DEFAULT NULL,
  replaced_by_id BIGINT UNSIGNED NULL DEFAULT NULL,
  user_agent     VARCHAR(255) NOT NULL DEFAULT '',
  ip_address     VARBINARY(16) NULL DEFAULT NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_user (user_id),
  KEY ix_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_refresh_tokens_replaced_by
    FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- audit_logs
--
-- `metadata` is JSON, which in MariaDB is an alias for LONGTEXT with no validation and no
-- -> / ->> operators. Validity is enforced with an explicit CHECK; anything that needs to
-- be filtered or reported on gets a real column instead.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id  BIGINT UNSIGNED NULL DEFAULT NULL,
  actor_role     VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  action         VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  entity_type    VARCHAR(60)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  entity_id      VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL,
  metadata       JSON         NULL DEFAULT NULL,
  ip_address     VARBINARY(16) NULL DEFAULT NULL,
  request_id     CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_logs_actor (actor_user_id, created_at),
  KEY ix_audit_logs_entity (entity_type, entity_id),
  KEY ix_audit_logs_action (action, created_at),
  KEY ix_audit_logs_created_at (created_at),
  CONSTRAINT fk_audit_logs_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_audit_logs_metadata CHECK (metadata IS NULL OR JSON_VALID(metadata))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- Seed the system roles and the baseline permission set.
-- These are structural, not business data — the application depends on these slugs.
-- ----------------------------------------------------------------------------
INSERT INTO roles (slug, name, description, is_system) VALUES
  ('customer',    'Customer',    'Shops on Mirwal: browse, cart, orders, reviews.', 1),
  ('seller',      'Seller',      'Manages one store: products, orders, payouts.',   1),
  ('admin',       'Admin',       'Operates the marketplace.',                        1),
  ('super_admin', 'Super Admin', 'Full control including roles and settings.',       1);

INSERT INTO permissions (slug, area, description) VALUES
  ('catalog.product.read',    'catalog',  'View products'),
  ('catalog.product.write',   'catalog',  'Create and edit products'),
  ('catalog.product.delete',  'catalog',  'Delete products'),
  ('catalog.product.approve', 'catalog',  'Approve products for publication'),
  ('catalog.category.read',   'catalog',  'View categories'),
  ('catalog.category.write',  'catalog',  'Create and edit categories'),
  ('catalog.brand.read',      'catalog',  'View brands'),
  ('catalog.brand.write',     'catalog',  'Create and edit brands'),
  ('inventory.read',          'catalog',  'View stock levels'),
  ('inventory.write',         'catalog',  'Adjust stock levels'),
  ('store.read',              'sellers',  'View own store'),
  ('store.write',             'sellers',  'Edit own store'),
  ('seller.read',             'sellers',  'View sellers'),
  ('seller.approve',          'sellers',  'Approve seller applications'),
  ('seller.suspend',          'sellers',  'Suspend a seller'),
  ('user.read',               'users',    'View users'),
  ('user.write',              'users',    'Create and edit users'),
  ('user.suspend',            'users',    'Suspend a user'),
  ('role.manage',             'users',    'Assign roles and permissions'),
  ('audit.read',              'system',   'View audit logs'),
  ('settings.manage',         'system',   'Change platform settings');

-- customer: no management permissions at all.

-- seller: scoped to their own store. Ownership is enforced in the query layer as well —
-- holding catalog.product.write never means "any product", only "products of my store".
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'seller' AND p.slug IN (
  'catalog.product.read','catalog.product.write','catalog.product.delete',
  'catalog.category.read','catalog.brand.read',
  'inventory.read','inventory.write',
  'store.read','store.write'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'admin' AND p.slug IN (
  'catalog.product.read','catalog.product.write','catalog.product.delete','catalog.product.approve',
  'catalog.category.read','catalog.category.write','catalog.brand.read','catalog.brand.write',
  'inventory.read','inventory.write',
  'seller.read','seller.approve','seller.suspend',
  'user.read','user.write','user.suspend',
  'audit.read'
);

-- super_admin: everything, including future permissions added by later migrations.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p WHERE r.slug = 'super_admin';
