-- ============================================================================
-- 016 — Operations: product reports, system logs, admin teams, attributes
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- The last group of admin surfaces that could be made real. Each table here backs a page
-- that previously showed invented data.
--
-- Deliberately NOT in this migration:
--
--   * Email/SMS templates and delivery logs. Mirwal has no mail or SMS provider wired, so a
--     templates table would let the Messaging page look connected while nothing is ever sent.
--     That is the exact failure this whole effort has been removing, and a schema cannot fix
--     it — an provider integration can.
--   * Seller verification documents. Mirwal has no file storage, so there is nowhere for a
--     CNIC or tax certificate to go. A documents table would imply an upload that cannot work.
-- ============================================================================

-- Shoppers reporting a listing (counterfeit, wrong category, offensive imagery, …).
CREATE TABLE product_reports (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  product_id     BIGINT UNSIGNED NOT NULL,
  -- NULL for a report from a signed-out visitor; the report still matters.
  reporter_id    BIGINT UNSIGNED NULL,

  reason         ENUM('counterfeit','prohibited','misleading','offensive','wrong_category','price','other')
                   NOT NULL DEFAULT 'other',
  details        VARCHAR(2000) NULL,

  status         ENUM('open','reviewing','upheld','dismissed') NOT NULL DEFAULT 'open',
  -- What the admin did about it, shown in the queue so a decision is explainable later.
  resolution     VARCHAR(500) NULL,
  reviewed_by    BIGINT UNSIGNED NULL,
  reviewed_at    DATETIME(3) NULL,

  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_product_reports_public (public_id),
  -- One open report per person per product: re-submitting must not inflate a listing's
  -- report count into a false signal that many people complained.
  UNIQUE KEY uq_product_reports_once (product_id, reporter_id, status),
  KEY ix_product_reports_queue (status, created_at),
  KEY ix_product_reports_product (product_id),

  CONSTRAINT fk_product_reports_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_product_reports_reporter
    FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_product_reports_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Application errors and notable events.
--
-- The Error Logs page was fabricated because logs went only to the console/log stream with
-- nothing queryable behind them. This gives `errorHandler.js` somewhere to record a failure,
-- so the page reports what actually broke rather than invented incidents.
--
-- Deliberately narrow: 5xx failures and explicit operational events only. Writing every
-- request here would turn a diagnostic table into a traffic log nobody reads and the disk
-- cannot hold.
CREATE TABLE system_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  level         ENUM('error','warn','info') NOT NULL DEFAULT 'error',
  -- Machine-readable, e.g. 'INTERNAL_ERROR', 'DB_UNAVAILABLE'.
  code          VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  message       VARCHAR(500) NOT NULL,

  method        VARCHAR(10) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  path          VARCHAR(255) NULL,
  status_code   SMALLINT UNSIGNED NULL,

  user_id       BIGINT UNSIGNED NULL,
  request_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip_address    VARBINARY(16) NULL,
  -- Stack trace or structured context. Never request bodies: they carry addresses and,
  -- on the auth routes, passwords.
  context       LONGTEXT NULL CHECK (context IS NULL OR json_valid(context)),

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_system_logs_time (created_at),
  KEY ix_system_logs_level (level, created_at),
  KEY ix_system_logs_code (code),

  CONSTRAINT fk_system_logs_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Grouping for staff accounts. A team is an organisational label, NOT a permission boundary:
-- authority comes from roles, and putting it in two places would let them disagree.
CREATE TABLE admin_teams (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(80) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(500) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_teams_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE admin_team_members (
  team_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (team_id, user_id),
  KEY ix_admin_team_members_user (user_id),

  CONSTRAINT fk_admin_team_members_team
    FOREIGN KEY (team_id) REFERENCES admin_teams (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_admin_team_members_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Catalogue attributes: the specification fields a category's products should carry
-- ("Screen size", "Material"). Managed centrally so two sellers in one category describe
-- their products the same way.
CREATE TABLE product_attributes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(80) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name          VARCHAR(120) NOT NULL,
  -- 'select' constrains input to `options`; the others are free entry.
  input_type    ENUM('text','number','boolean','select') NOT NULL DEFAULT 'text',
  unit          VARCHAR(20) NULL,
  -- JSON array of allowed values, for input_type = 'select'.
  options       LONGTEXT NULL CHECK (options IS NULL OR json_valid(options)),
  -- NULL = applies to every category.
  category_id   BIGINT UNSIGNED NULL,
  is_required   TINYINT(1) NOT NULL DEFAULT 0,
  position      SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_product_attributes_slug (slug),
  KEY ix_product_attributes_category (category_id, position),

  CONSTRAINT ck_product_attributes_select CHECK (input_type <> 'select' OR options IS NOT NULL),
  CONSTRAINT fk_product_attributes_category
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE product_attribute_values (
  product_id    BIGINT UNSIGNED NOT NULL,
  attribute_id  BIGINT UNSIGNED NOT NULL,
  value         VARCHAR(500) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (product_id, attribute_id),
  KEY ix_attribute_values_attribute (attribute_id),

  CONSTRAINT fk_attribute_values_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_attribute_values_attribute
    FOREIGN KEY (attribute_id) REFERENCES product_attributes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
