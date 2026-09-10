-- ============================================================================
-- 004 — Saved addresses
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- `orders.shipping_*` (migration 003) stays exactly as it is — an immutable snapshot of
-- where an order shipped, independent of the buyer's address book. This table is a separate
-- concern: a reusable list a buyer picks from at checkout, so they don't retype the same
-- address on every order. Deleting or editing a saved address here never touches a past
-- order's own shipping columns.
-- ============================================================================

CREATE TABLE addresses (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,

  full_name       VARCHAR(150) NOT NULL,
  phone           VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  line1           VARCHAR(255) NOT NULL,
  line2           VARCHAR(255) NOT NULL DEFAULT '',
  city            VARCHAR(100) NOT NULL,
  region          VARCHAR(100) NOT NULL DEFAULT '',
  postal_code     VARCHAR(20)  NOT NULL DEFAULT '',
  country_code    CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PK',

  is_default      TINYINT(1) NOT NULL DEFAULT 0,

  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3) NULL DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_addresses_public_id (public_id),
  KEY ix_addresses_user (user_id, deleted_at),

  CONSTRAINT fk_addresses_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
