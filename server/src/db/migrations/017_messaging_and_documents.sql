-- ============================================================================
-- 017 — Transactional messaging and seller verification documents
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- These two were previously left unbuilt on purpose: a templates table without a mail
-- provider, or a documents table without file storage, would have made the pages look
-- connected while nothing sent or stored. Both capabilities now exist —
-- `lib/mailer.js` (nodemailer/SMTP) and `lib/storage.js` (local disk) — so the schema has
-- something real behind it.
--
-- The delivery ledger is the important half. Without it "email sent" is an assumption; with
-- it, every attempt is recorded with its provider result, so an admin can answer "did that
-- order confirmation actually go out?" rather than guessing.
-- ============================================================================

CREATE TABLE message_templates (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Stable identifier the code sends by, e.g. 'order.confirmation'. Renaming the human
  -- title must never change which template an event uses.
  `key`         VARCHAR(80) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  channel       ENUM('email','sms') NOT NULL DEFAULT 'email',
  name          VARCHAR(150) NOT NULL,
  description   VARCHAR(500) NULL,

  -- Unused for SMS.
  subject       VARCHAR(255) NULL,
  body          MEDIUMTEXT NOT NULL,

  -- JSON array of placeholder names this template accepts, e.g. ["orderNumber","total"].
  -- Used to validate a template on save rather than discovering a typo at send time.
  variables     LONGTEXT NULL CHECK (variables IS NULL OR json_valid(variables)),

  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  updated_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_message_templates_key (`key`, channel),
  KEY ix_message_templates_channel (channel, is_active),

  CONSTRAINT fk_message_templates_updater
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Every send attempt, whether it succeeded or not.
CREATE TABLE message_deliveries (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  template_key   VARCHAR(80) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  channel        ENUM('email','sms') NOT NULL DEFAULT 'email',

  -- The address actually used. Kept so a bounce can be traced to what was tried, even after
  -- the user later changes their email.
  recipient      VARCHAR(255) NOT NULL,
  user_id        BIGINT UNSIGNED NULL,
  subject        VARCHAR(255) NULL,

  -- queued: accepted for sending. skipped: no provider configured, so nothing was attempted —
  -- deliberately distinct from `failed`, which means a provider tried and refused.
  status         ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  provider       VARCHAR(40) NULL,
  provider_ref   VARCHAR(255) NULL,
  error_message  VARCHAR(500) NULL,

  -- The rendered variables, for reproducing what the recipient saw. Never the rendered body:
  -- that would duplicate order and address details into a long-lived log.
  context        LONGTEXT NULL CHECK (context IS NULL OR json_valid(context)),

  sent_at        DATETIME(3) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_message_deliveries_public (public_id),
  KEY ix_message_deliveries_time (created_at),
  KEY ix_message_deliveries_status (status, created_at),
  KEY ix_message_deliveries_recipient (recipient),

  CONSTRAINT fk_message_deliveries_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Seller verification documents.
--
-- The file itself is written to disk under the API's upload root and is NEVER served
-- statically: these are CNICs, bank letters and tax certificates. The bytes come back only
-- through an authenticated endpoint that checks the caller owns the document or is staff.
CREATE TABLE seller_documents (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  seller_id      BIGINT UNSIGNED NOT NULL,
  doc_type       ENUM('cnic_front','cnic_back','business_registration','tax_certificate','bank_statement','other')
                   NOT NULL DEFAULT 'other',

  -- What the seller called it, sanitised. Never used to build a filesystem path.
  original_name  VARCHAR(255) NOT NULL,
  -- The generated name on disk. Random, so a stored name can never traverse or collide.
  stored_name    VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime_type      VARCHAR(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  -- SHA-256 of the bytes: detects a re-upload of the same file and proves integrity.
  checksum       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_note    VARCHAR(500) NULL,
  reviewed_by    BIGINT UNSIGNED NULL,
  reviewed_at    DATETIME(3) NULL,

  uploaded_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_documents_public (public_id),
  UNIQUE KEY uq_seller_documents_stored (stored_name),
  KEY ix_seller_documents_seller (seller_id, status),
  KEY ix_seller_documents_queue (status, uploaded_at),

  CONSTRAINT fk_seller_documents_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_seller_documents_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
