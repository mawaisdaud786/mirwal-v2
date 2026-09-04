-- ============================================================================
-- 020 — Seller onboarding, KYC, and a permission model that can hold them
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Until now there was no way to become a seller. `INSERT INTO sellers` appeared exactly once
-- in the codebase — in db/seed.js — so the admin "Applications" and "Verification" queues
-- reviewed a queue that nothing in production could fill, and the storefront application form
-- was a submit handler that set a boolean and sent nothing.
--
-- This migration adds the four things that were missing underneath that:
--
--   1. `seller_applications` — the thing an admin actually reviews. Deliberately separate
--      from `sellers`: an application is a submission with a decision history, while a seller
--      is a trading entity. Merging them means a rejected applicant is a half-built store row,
--      and a re-application overwrites the record of why the first one was refused.
--
--   2. KYC columns on `sellers`, plus `seller_type`. Documents could already be uploaded
--      (migration 017) but there was nothing to check them *against*: approving a photo of a
--      CNIC is not the same as confirming the CNIC number matches the name on the account.
--
--   3. `seller_bank_accounts` — where money goes. `payouts.destination_hint` was free text
--      typed by staff, so a seller had no way to say where to send their earnings, and a
--      changed account had no verification or hold. Bank-account change is the primary
--      account-takeover cash-out path, so the change itself is a first-class, audited event.
--
--   4. A finer permission set. `settings.manage` gated coupons, banners, shipping,
--      integrations, webhooks AND payouts together, so a marketing operator could approve a
--      withdrawal. Viewing a CNIC needed only `seller.approve`, the same grant as deciding an
--      application. Those are now separate keys, and the seven operational roles the business
--      actually has are seeded with the ones they need and nothing else.
--
-- Two deliberate non-choices:
--
--   * `sellers.status` gains new values rather than moving to a separate state table. The
--     existing transition guard in admin/sellers.service.js is already the single place that
--     enforces legality, and a second table would give two answers to "can this store trade".
--
--   * Bank details are stored as account title + IBAN + bank name only. No full account
--     numbers beyond the IBAN a transfer needs, and nothing that would make this table worth
--     stealing beyond what a payout file already contains.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- sellers — identity, lifecycle and standing
-- ---------------------------------------------------------------------------

-- `seller_type` decides which KYC fields apply. Nullable with no default on purpose: a row
-- seeded before this migration has no answer, and inventing 'individual' for it would assert
-- something nobody checked.
ALTER TABLE sellers
  ADD COLUMN seller_type ENUM('individual','business') NULL DEFAULT NULL AFTER user_id,
  ADD COLUMN verification_level ENUM('none','basic','identity_verified','business_verified')
      NOT NULL DEFAULT 'none' AFTER seller_type;

-- Status and standing are different questions. `status` is "may this store trade"; the
-- columns below are "what do we know" and "what have we done about it", and conflating them
-- is why a marketplace ends up unable to answer either.
ALTER TABLE sellers
  MODIFY COLUMN status ENUM(
    'draft','submitted','in_review','more_info_required',
    'pending','approved','restricted','suspended','rejected','banned','closed'
  ) NOT NULL DEFAULT 'draft';

ALTER TABLE sellers
  ADD COLUMN applied_at        DATETIME(3) NULL AFTER status,
  ADD COLUMN verified_at       DATETIME(3) NULL AFTER approved_at,
  -- A restriction lifts itself. A restriction with no expiry is a suspension nobody
  -- remembered to review.
  ADD COLUMN restricted_until  DATETIME(3) NULL AFTER suspended_reason,
  ADD COLUMN restricted_reason VARCHAR(255) NULL AFTER restricted_until,
  ADD COLUMN banned_at         DATETIME(3) NULL AFTER restricted_reason,
  ADD COLUMN banned_reason     VARCHAR(255) NULL AFTER banned_at;

-- Identity. Stored on the seller rather than the application because these outlive the
-- application and are what a re-verification checks against.
ALTER TABLE sellers
  -- 13 digits, no dashes, normalised by the application layer. ascii_bin so the unique index
  -- is exact.
  ADD COLUMN cnic              VARCHAR(15) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER legal_name,
  ADD COLUMN date_of_birth     DATE NULL AFTER cnic,
  ADD COLUMN ntn               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER date_of_birth,
  ADD COLUMN strn              VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER ntn,
  ADD COLUMN business_reg_no   VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER strn,
  ADD COLUMN business_type     ENUM('sole_proprietor','partnership','private_limited','other') NULL AFTER business_reg_no,
  ADD COLUMN address_line1     VARCHAR(255) NULL AFTER city,
  ADD COLUMN address_line2     VARCHAR(255) NULL AFTER address_line1,
  ADD COLUMN province          VARCHAR(100) NULL AFTER address_line2,
  ADD COLUMN postal_code       VARCHAR(20)  NULL AFTER province;

-- Operational levers an admin needs and did not have.
ALTER TABLE sellers
  -- Independent of suspension: a store may trade while its money is held pending an
  -- investigation, which is far more often the right answer than closing it down.
  ADD COLUMN payout_hold          TINYINT(1) NOT NULL DEFAULT 0 AFTER currency_code,
  ADD COLUMN payout_hold_reason   VARCHAR(255) NULL AFTER payout_hold,
  -- A seller who cannot fulfil needs a way to stop orders arriving. Without it their
  -- cancellation rate — and therefore their standing — is destroyed by their own honesty.
  ADD COLUMN vacation_mode        TINYINT(1) NOT NULL DEFAULT 0 AFTER payout_hold_reason,
  ADD COLUMN vacation_message     VARCHAR(255) NULL AFTER vacation_mode,
  -- NULL = use the platform rate. A per-seller override is how negotiated deals get honoured
  -- without editing a global setting that affects everyone.
  ADD COLUMN commission_bps_override SMALLINT UNSIGNED NULL AFTER vacation_message,
  ADD COLUMN verified_badge       TINYINT(1) NOT NULL DEFAULT 0 AFTER commission_bps_override;

-- One CNIC, one NTN, one seller. This is the cheapest multi-account control there is, and it
-- only works as a database constraint: an application-layer check loses every race.
-- NULLs stay distinct in MariaDB, so unverified rows do not collide with each other.
ALTER TABLE sellers
  ADD UNIQUE KEY uq_sellers_cnic (cnic),
  ADD UNIQUE KEY uq_sellers_ntn (ntn),
  ADD KEY ix_sellers_payout_hold (payout_hold),
  ADD KEY ix_sellers_verification (verification_level, status);

ALTER TABLE sellers
  ADD CONSTRAINT ck_sellers_cnic_digits
    CHECK (cnic IS NULL OR cnic REGEXP '^[0-9]{13}$');


-- ---------------------------------------------------------------------------
-- seller_applications
-- ---------------------------------------------------------------------------
--
-- One row per attempt to join Mirwal. Kept even after approval: it is the record of what was
-- claimed at the time, which is what a later fraud investigation actually needs.
--
-- `seller_id` is nullable and filled on approval. An application does not create a store; a
-- decision does. That ordering is what stops a rejected applicant leaving a half-built
-- storefront row behind, and what makes "how many applications did we reject last month" a
-- question with an answer.
CREATE TABLE seller_applications (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reference        VARCHAR(24) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,

  -- The applicant's user account. Required: an application from nobody cannot be verified,
  -- contacted, or turned into a login.
  user_id          BIGINT UNSIGNED NOT NULL,
  -- Set when the application is approved and a store is created from it.
  seller_id        BIGINT UNSIGNED NULL,

  seller_type      ENUM('individual','business') NOT NULL,

  -- What they claimed. Snapshotted rather than read back off `sellers`, so an edit to the
  -- store after approval never rewrites what was originally submitted and reviewed.
  applicant_name   VARCHAR(150) NOT NULL,
  applicant_email  VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  applicant_phone  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cnic             VARCHAR(15) CHARACTER SET ascii COLLATE ascii_bin NULL,
  date_of_birth    DATE NULL,

  store_name       VARCHAR(150) NOT NULL,
  legal_name       VARCHAR(200) NOT NULL DEFAULT '',
  business_type    ENUM('sole_proprietor','partnership','private_limited','other') NULL,
  business_reg_no  VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ntn              VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  strn             VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,

  address_line1    VARCHAR(255) NOT NULL,
  address_line2    VARCHAR(255) NOT NULL DEFAULT '',
  city             VARCHAR(100) NOT NULL,
  province         VARCHAR(100) NOT NULL,
  postal_code      VARCHAR(20)  NOT NULL DEFAULT '',
  country_code     CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PK',

  -- Free-text context from the applicant. Never rendered as markup.
  categories       VARCHAR(255) NOT NULL DEFAULT '',
  website          VARCHAR(255) NOT NULL DEFAULT '',
  notes            VARCHAR(2000) NOT NULL DEFAULT '',
  heard_from       VARCHAR(60) NOT NULL DEFAULT '',

  -- The applicant must accept the seller agreement, and we must be able to prove which
  -- version they accepted.
  agreement_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  agreed_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  status           ENUM('draft','submitted','in_review','more_info_required','approved','rejected','withdrawn','expired')
                     NOT NULL DEFAULT 'draft',
  -- Machine-readable, so "why do we reject applications" is answerable without reading prose.
  decision_code    VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  decision_note    VARCHAR(1000) NULL,
  -- What the applicant still has to supply, shown to them verbatim.
  info_requested   VARCHAR(1000) NULL,

  reviewed_by      BIGINT UNSIGNED NULL,
  reviewed_at      DATETIME(3) NULL,
  submitted_at     DATETIME(3) NULL,
  -- An application left in more_info_required forever is a queue leak. This is when it stops
  -- counting as live.
  expires_at       DATETIME(3) NULL,

  -- Anti-fraud context, captured once at submission.
  submitted_ip     VARBINARY(16) NULL,
  submitted_user_agent VARCHAR(255) NOT NULL DEFAULT '',

  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_applications_public (public_id),
  UNIQUE KEY uq_seller_applications_reference (reference),
  -- The review queue, oldest first — the only ordering an SLA can be measured against.
  KEY ix_seller_applications_queue (status, submitted_at),
  KEY ix_seller_applications_user (user_id, created_at),
  KEY ix_seller_applications_seller (seller_id),
  KEY ix_seller_applications_reviewer (reviewed_by),
  -- Duplicate-account detection: the same CNIC applying twice is the signal, not an error.
  KEY ix_seller_applications_cnic (cnic),

  CONSTRAINT fk_seller_applications_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_seller_applications_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_applications_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- One live application per person. A second attempt while the first is open is almost always
-- a confused applicant rather than a second business, and letting both into the queue wastes
-- reviewer time on the same case twice.
--
-- Expressed as a generated column because MariaDB cannot put a WHERE on a unique index: the
-- column is the user id while the application is live and NULL once it is closed, and NULLs
-- do not collide.
ALTER TABLE seller_applications
  ADD COLUMN active_user_id BIGINT UNSIGNED
    AS (CASE WHEN status IN ('draft','submitted','in_review','more_info_required')
             THEN user_id ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_seller_applications_active (active_user_id);


-- ---------------------------------------------------------------------------
-- seller_bank_accounts
-- ---------------------------------------------------------------------------
--
-- Where a payout goes. Separate from `sellers` because it has its own verification state and
-- its own history: knowing that the destination changed three days before a large withdrawal
-- is the whole point.
--
-- Only one account per seller may be `is_default`, enforced by the partial-unique trick used
-- above. Verification is a real state, not a flag: an unverified account can be entered but
-- must not be paid to.
CREATE TABLE seller_bank_accounts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seller_id      BIGINT UNSIGNED NOT NULL,

  -- 'bank' = IBAN transfer. The wallets are how most Pakistani sellers are actually paid.
  method         ENUM('bank','easypaisa','jazzcash') NOT NULL DEFAULT 'bank',

  -- Must match the CNIC name (individual) or the registered business name (business). The
  -- mismatch between this and the account holder is the single most common KYC failure.
  account_title  VARCHAR(150) NOT NULL,
  bank_name      VARCHAR(120) NOT NULL DEFAULT '',
  -- PK IBANs are 24 characters. Stored upper-cased, no spaces.
  iban           VARCHAR(34) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Wallet MSISDN in E.164, for easypaisa/jazzcash.
  msisdn         VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Display only, so support can confirm an account without the full number in the UI.
  last4          CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NULL,

  status         ENUM('pending','verified','rejected','archived') NOT NULL DEFAULT 'pending',
  rejection_reason VARCHAR(255) NULL,
  verified_by    BIGINT UNSIGNED NULL,
  verified_at    DATETIME(3) NULL,

  is_default     TINYINT(1) NOT NULL DEFAULT 0,

  -- Set when this row replaced another. A payout destination that changed recently is a risk
  -- signal, and this is what makes it queryable.
  replaced_id    BIGINT UNSIGNED NULL,

  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_bank_accounts_public (public_id),
  KEY ix_seller_bank_accounts_seller (seller_id, status),
  KEY ix_seller_bank_accounts_queue (status, created_at),
  KEY ix_seller_bank_accounts_verifier (verified_by),
  KEY ix_seller_bank_accounts_replaced (replaced_id),

  CONSTRAINT fk_seller_bank_accounts_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_seller_bank_accounts_verifier
    FOREIGN KEY (verified_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_bank_accounts_replaced
    FOREIGN KEY (replaced_id) REFERENCES seller_bank_accounts (id) ON DELETE SET NULL ON UPDATE CASCADE,

  -- A bank transfer needs an IBAN; a wallet payout needs a number. Neither is optional for
  -- its own method, and the database is the right place to say so.
  CONSTRAINT ck_seller_bank_accounts_destination
    CHECK ((method = 'bank' AND iban IS NOT NULL) OR (method <> 'bank' AND msisdn IS NOT NULL))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- One default account per seller.
ALTER TABLE seller_bank_accounts
  ADD COLUMN default_seller_id BIGINT UNSIGNED
    AS (CASE WHEN is_default = 1 AND status <> 'archived' THEN seller_id ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_seller_bank_accounts_default (default_seller_id);


-- Payouts learn where they went. `destination_hint` stays for the historical rows it already
-- describes; new payouts reference a real, verified account.
ALTER TABLE payouts
  ADD COLUMN bank_account_id BIGINT UNSIGNED NULL AFTER method,
  ADD KEY ix_payouts_bank_account (bank_account_id),
  ADD CONSTRAINT fk_payouts_bank_account
    FOREIGN KEY (bank_account_id) REFERENCES seller_bank_accounts (id) ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- seller_documents — what a document actually says, not just that one exists
-- ---------------------------------------------------------------------------
--
-- Approving an image was the whole of verification. These columns are what turns that into a
-- check: the number on the document, when it expires, which fields a reviewer confirmed, and
-- a machine-readable reason when it is refused.
ALTER TABLE seller_documents
  MODIFY COLUMN doc_type ENUM(
    'cnic_front','cnic_back','selfie_with_cnic','proof_of_address',
    'business_registration','tax_certificate','bank_statement',
    'brand_authorization','other'
  ) NOT NULL DEFAULT 'other';

ALTER TABLE seller_documents
  MODIFY COLUMN status ENUM('pending','approved','rejected','more_info_required','expired','superseded')
    NOT NULL DEFAULT 'pending';

ALTER TABLE seller_documents
  ADD COLUMN document_number VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER doc_type,
  ADD COLUMN issued_at    DATE NULL AFTER document_number,
  ADD COLUMN expires_at   DATE NULL AFTER issued_at,
  -- Which checks the reviewer actually ticked, e.g. {"name_matches":true,"legible":true}.
  -- JSON because the checklist differs per document type and none of it is filtered on.
  ADD COLUMN verified_fields JSON NULL AFTER review_note,
  ADD COLUMN rejection_code VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER verified_fields,
  -- A resubmission never overwrites the original; it points at what it replaces.
  ADD COLUMN supersedes_id BIGINT UNSIGNED NULL AFTER rejection_code,
  ADD KEY ix_seller_documents_expiry (expires_at),
  ADD KEY ix_seller_documents_supersedes (supersedes_id),
  ADD CONSTRAINT fk_seller_documents_supersedes
    FOREIGN KEY (supersedes_id) REFERENCES seller_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT ck_seller_documents_verified_fields
    CHECK (verified_fields IS NULL OR JSON_VALID(verified_fields));


-- ---------------------------------------------------------------------------
-- PII access log
-- ---------------------------------------------------------------------------
--
-- `audit_logs` records that a document was approved. It did not record that one was *looked
-- at*, which is the event that matters for a CNIC: the harm from a staff member browsing
-- identity documents happens on the read, and the approve/reject entry never fires for it.
--
-- Separate from audit_logs on purpose. This table is high-volume, has a retention policy of
-- its own, and is the one an auditor asks for by name.
CREATE TABLE pii_access_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_role    VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',

  -- What was read: 'seller_document', 'bank_account', 'kyc_profile', 'customer_contact'.
  subject_type  VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  subject_id    VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  -- Which seller/customer the data belongs to, so "who looked at this seller" is one query.
  seller_id     BIGINT UNSIGNED NULL,

  action        ENUM('view','download','export') NOT NULL DEFAULT 'view',
  -- Why. Optional today; the hook is here so a justification can be required for the most
  -- sensitive reads without another migration.
  reason        VARCHAR(255) NULL,

  ip_address    VARBINARY(16) NULL,
  request_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_pii_access_actor (actor_user_id, created_at),
  KEY ix_pii_access_subject (subject_type, subject_id),
  KEY ix_pii_access_seller (seller_id, created_at),
  KEY ix_pii_access_created (created_at),

  CONSTRAINT fk_pii_access_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_pii_access_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Email and phone verification
-- ---------------------------------------------------------------------------
--
-- `users.email_verified_at` and `phone_verified_at` have existed since migration 001 and were
-- written only by the seeder. Nothing could set them because there was no token to check.
--
-- Same design as password_resets: only a hash is stored, single use, short lived. Phone codes
-- are six digits, so they also carry an attempt counter — a six-digit code with unlimited
-- guesses is not a second factor.
CREATE TABLE verification_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  purpose     ENUM('email','phone') NOT NULL,

  -- The address or number being proven. Kept so changing an email mid-flight invalidates a
  -- token issued for the old one rather than verifying the wrong address.
  destination VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,

  token_hash  CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,

  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_verification_tokens_hash (token_hash),
  KEY ix_verification_tokens_user (user_id, purpose, used_at),
  KEY ix_verification_tokens_expiry (expires_at),

  CONSTRAINT fk_verification_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ============================================================================
-- Permissions
-- ============================================================================
--
-- The problem being fixed: `settings.manage` was one key for coupons, banners, promotions,
-- shipping, integrations, webhooks and payouts. Anyone who could publish a banner could
-- approve a withdrawal. And `seller.approve` was the key for both *deciding* an application
-- and *reading the CNIC attached to it*, so every reviewer had full PII access whether their
-- job needed it or not.
--
-- Existing keys are kept. Nothing below removes a grant — the coarse keys stay valid so no
-- running session loses access mid-deploy, and the new keys are additive. Tightening
-- `settings.manage` on individual routes happens in the route layer, where it can be reviewed
-- one endpoint at a time.
-- ----------------------------------------------------------------------------

INSERT INTO permissions (slug, area, description) VALUES
  -- Seller lifecycle, split from the single seller.approve key.
  ('seller.application.read',   'sellers', 'View seller applications'),
  ('seller.application.decide', 'sellers', 'Approve, reject or request more information on an application'),
  ('seller.kyc.view',           'sellers', 'View seller identity documents and KYC data (PII)'),
  ('seller.kyc.decide',         'sellers', 'Approve or reject identity documents'),
  ('seller.bank.view',          'sellers', 'View seller payout destinations'),
  ('seller.bank.verify',        'sellers', 'Verify or reject a seller payout destination'),
  ('seller.enforce',            'sellers', 'Restrict, ban or lift enforcement on a seller'),

  -- Finance, split out of settings.manage.
  ('payout.read',               'finance', 'View payouts'),
  ('payout.manage',             'finance', 'Approve, reject, hold and settle payouts'),
  ('finance.read',              'finance', 'View marketplace finance and ledger data'),
  ('finance.manage',            'finance', 'Adjust commission, tax and ledger entries'),
  ('refund.approve',            'finance', 'Approve and settle refunds'),

  -- Marketing, split out of settings.manage.
  ('marketing.read',            'marketing', 'View coupons, promotions, campaigns and banners'),
  ('marketing.manage',          'marketing', 'Create and edit coupons, promotions, campaigns and banners'),

  -- Platform configuration, split out of settings.manage.
  ('integration.manage',        'system', 'Connect and configure third-party integrations'),
  ('webhook.manage',            'system', 'Register and rotate outbound webhook endpoints'),
  ('shipping.manage',           'system', 'Manage shipping zones, methods and warehouses'),
  ('messaging.manage',          'system', 'Edit email and SMS templates and view deliveries'),

  -- Trust and safety.
  ('case.read',                 'safety', 'View reports, complaints and disputes'),
  ('case.manage',               'safety', 'Action, resolve and escalate cases'),
  ('review.moderate',           'safety', 'Hide, remove or reinstate customer reviews'),
  ('dispute.resolve',           'safety', 'Override a seller decision on a return or dispute'),
  ('risk.read',                 'safety', 'View seller and buyer risk signals'),

  -- Data egress. Deliberately its own key: exporting a customer list is a different act from
  -- reading one row on screen.
  ('data.export',               'system', 'Export marketplace data to a file'),

  -- The PII access log itself.
  ('pii.audit.read',            'system', 'View the PII access log');


-- ============================================================================
-- Roles
-- ============================================================================
--
-- Seven operational roles, in addition to the four that already exist. Each is a real job on a
-- marketplace operations team, and the point of splitting them is that KYC PII, money and
-- security controls are three separate keys — no operational role holds more than one.
-- ----------------------------------------------------------------------------

INSERT INTO roles (slug, name, description, is_system) VALUES
  ('marketplace_manager',  'Marketplace Manager',      'Catalogue, stores and day-to-day marketplace operations.', 1),
  ('verification_agent',   'Seller Verification Agent','Reviews applications and identity documents.',             1),
  ('product_moderator',    'Product Moderator',        'Approves listings and actions product reports.',           1),
  ('customer_support',     'Customer Support',         'Handles tickets, orders and buyer questions.',             1),
  ('finance_manager',      'Finance Manager',          'Payouts, refunds, commission and reconciliation.',         1),
  ('marketing_manager',    'Marketing Manager',        'Coupons, promotions, campaigns and banners.',              1),
  ('risk_manager',         'Security & Risk Manager',  'Cases, enforcement, fraud signals and audit.',             1);


-- Super Admin gets everything, including everything added later by this migration.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- The existing generic `admin` role keeps operating the marketplace, minus the three things
-- that should now require a deliberate, separate grant: KYC PII, payouts, and enforcement.
-- An existing admin loses nothing they had — these keys did not exist yesterday.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'admin'
   AND p.slug IN (
     'seller.application.read','seller.application.decide',
     'marketing.read','marketing.manage','case.read','case.manage',
     'review.moderate','payout.read','finance.read','shipping.manage','messaging.manage'
   )
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'marketplace_manager'
   AND p.slug IN (
     'catalog.product.read','catalog.product.write','catalog.product.approve',
     'catalog.category.read','catalog.category.write','catalog.brand.read','catalog.brand.write',
     'inventory.read','inventory.write',
     'seller.read','seller.application.read','store.read','store.write',
     'order.read','order.write','case.read','case.manage','analytics.read'
   );

-- The verification agent sees identity documents and nothing financial. This is the role that
-- exists specifically so that PII access is a small, named group rather than "all admins".
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'verification_agent'
   AND p.slug IN (
     'seller.read','seller.application.read','seller.application.decide',
     'seller.kyc.view','seller.kyc.decide','seller.bank.view','store.read'
   );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'product_moderator'
   AND p.slug IN (
     'catalog.product.read','catalog.product.write','catalog.product.approve','catalog.product.delete',
     'catalog.category.read','catalog.brand.read',
     'case.read','case.manage','review.moderate','seller.read'
   );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'customer_support'
   AND p.slug IN (
     'order.read','order.write','user.read','seller.read','store.read',
     'catalog.product.read','case.read','case.manage'
   );

-- Money, and no PII. A finance manager reconciling payouts has no business reading a CNIC.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'finance_manager'
   AND p.slug IN (
     'payout.read','payout.manage','finance.read','finance.manage','refund.approve',
     'seller.read','seller.bank.view','seller.bank.verify','order.read','analytics.read','data.export'
   );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'marketing_manager'
   AND p.slug IN (
     'marketing.read','marketing.manage','catalog.product.read','catalog.category.read',
     'catalog.brand.read','analytics.read'
   );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE r.slug = 'risk_manager'
   AND p.slug IN (
     'case.read','case.manage','dispute.resolve','risk.read','seller.enforce','seller.read',
     'user.read','user.suspend','audit.read','pii.audit.read','analytics.read'
   );


-- ============================================================================
-- Settings
-- ============================================================================
--
-- Deliberately none here. `platform_settings` is seeded lazily from the DEFAULTS registry in
-- modules/settings/settings.service.js, so that a fresh database and an upgraded one behave
-- identically and a new setting needs no migration. Inserting rows here as well would give
-- one concept two registries that can disagree — the keys this migration's behaviour depends
-- on (sellers.require_email_verification, sellers.application_expiry_days, and the rest) are
-- registered there instead.
