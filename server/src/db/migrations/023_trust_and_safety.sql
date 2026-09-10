-- ============================================================================
-- 023 — Trust and safety: cases, enforcement, review integrity, brand authority
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- This is the layer that exists because sellers are strangers and a few of them are
-- adversaries. Mirwal's transactional core was solid without it; its enforcement had nowhere
-- to land.
--
-- What was missing, precisely:
--
--   * Reporting worked for exactly one subject. `product_reports` is real and well-built, but
--     there was no way to report a seller, a store, a review, an order or a payment — and
--     upholding a product report did nothing at all: no takedown, no warning, no record.
--
--   * "Disputes" was a read-only SELECT over `return_requests`. The seller was judge and jury
--     on returns filed against themselves, with no escalation and no admin override.
--
--   * Reviews could not be moderated. `product_reviews` had no status, so a defamatory or
--     fake review could not be taken down; `AUDIT.REVIEW_DELETED` existed as a constant with
--     no endpoint behind it. Verified-purchase was enforced at the database level — genuinely
--     the hard half — and everything after it was absent.
--
--   * Nothing recorded that a seller had done something wrong, so nothing could stop them
--     doing it again, and no score could be computed from a history that was not kept.
--
--   * Any seller could attach any brand to any listing. That is the primary counterfeit
--     vector in Pakistani marketplaces and it had no control of any kind.
--
-- The central design decision is the unified `cases` table. Reports, complaints and disputes
-- are the same object — someone says something is wrong, a human decides, an action follows —
-- differing only in what they point at. Six near-identical report tables would mean six
-- queues, six SLAs and six places to forget to write an audit row.
--
-- `product_reports` is deliberately kept and not migrated into it. It is live, it has a
-- working public endpoint, and the storefront is about to be wired to it; converting it in the
-- same change that introduces the case model would put a working feature at risk for a tidier
-- diagram. New subjects go to `cases`, and a later migration can fold the old table in once
-- the case flow has proven itself.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
CREATE TABLE cases (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Quoted back to the reporter, so they can refer to it without an account.
  reference      VARCHAR(24) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,

  case_type      ENUM('product','seller','store','review','order','payment',
                      'fraud','counterfeit','policy','other') NOT NULL DEFAULT 'other',

  -- What it is about. Polymorphic by design: one queue, many subjects. The id is a public_id
  -- string rather than a foreign key precisely because the subject varies — a foreign key per
  -- possible subject would be nine nullable columns and eight of them always empty.
  subject_type   VARCHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  subject_id     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,

  -- Denormalised so the enforcement view — "everything ever filed against this store" — is one
  -- indexed read rather than a join through whichever subject table applies.
  against_seller_id BIGINT UNSIGNED NULL,
  -- The order it concerns, when there is one. Makes a payment or delivery case answerable.
  order_id       BIGINT UNSIGNED NULL,

  -- NULL for an anonymous report. Anonymous reports still matter: a shopper who has not
  -- signed in can still be looking at a counterfeit, and refusing their report loses the
  -- signal. This mirrors the choice `product_reports` already made.
  reporter_id    BIGINT UNSIGNED NULL,
  reporter_email VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  reporter_side  ENUM('buyer','seller','staff','anonymous') NOT NULL DEFAULT 'buyer',

  subject_summary VARCHAR(255) NOT NULL DEFAULT '',
  details        VARCHAR(4000) NOT NULL DEFAULT '',
  -- Machine-readable category within the type, e.g. 'fake_branded', 'never_arrived'.
  reason_code    VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL,

  status         ENUM('reported','under_review','more_info_required','action_taken',
                      'resolved','rejected','appealed','closed') NOT NULL DEFAULT 'reported',
  priority       ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',

  assigned_to    BIGINT UNSIGNED NULL,
  -- When this case breaches its service level. Set at creation from the priority, so an
  -- ageing queue is visible without recomputing a policy on every read.
  sla_due_at     DATETIME(3) NULL,

  resolution_code VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  resolution_note VARCHAR(2000) NULL,
  resolved_by    BIGINT UNSIGNED NULL,
  resolved_at    DATETIME(3) NULL,

  -- Denormalised for the list view, exactly as support_tickets does, so sorting by "most
  -- recently active" needs no correlated subquery per row.
  last_message_at DATETIME(3) NULL,
  message_count   INT UNSIGNED NOT NULL DEFAULT 0,
  evidence_count  INT UNSIGNED NOT NULL DEFAULT 0,

  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_cases_public (public_id),
  UNIQUE KEY uq_cases_reference (reference),
  -- The working queue: open cases, most urgent and most overdue first.
  KEY ix_cases_queue (status, priority, sla_due_at),
  KEY ix_cases_seller (against_seller_id, status, created_at),
  KEY ix_cases_subject (subject_type, subject_id),
  KEY ix_cases_reporter (reporter_id, created_at),
  KEY ix_cases_assignee (assigned_to, status),
  KEY ix_cases_order (order_id),
  KEY ix_cases_type (case_type, status, created_at),

  CONSTRAINT fk_cases_seller
    FOREIGN KEY (against_seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cases_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cases_reporter
    FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cases_assignee
    FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cases_resolver
    FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- One open case per person per subject.
--
-- Same rule and same reason as `uq_product_reports_once`: re-submitting must not inflate a
-- subject's report count into a false signal that many people complained. Expressed as a
-- generated column so it applies only while the case is open — a closed case must not stop a
-- genuine new report months later.
ALTER TABLE cases
  ADD COLUMN open_reporter_subject VARCHAR(180) CHARACTER SET ascii COLLATE ascii_general_ci
    AS (CASE WHEN status IN ('reported','under_review','more_info_required') AND reporter_id IS NOT NULL
             THEN CONCAT(reporter_id, ':', subject_type, ':', COALESCE(subject_id, '')) END) VIRTUAL,
  ADD UNIQUE KEY uq_cases_open_once (open_reporter_subject);


-- Conversation on a case. Internal notes are staff-only, exactly as support_messages models
-- it — and for the same reason: a reviewer has to be able to write "third report this month,
-- escalating" without the reporter or the seller reading it.
CREATE TABLE case_messages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id      BIGINT UNSIGNED NOT NULL,
  author_id    BIGINT UNSIGNED NULL,
  author_side  ENUM('reporter','seller','staff','system') NOT NULL,
  body         TEXT NOT NULL,
  is_internal  TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_case_messages_case (case_id, created_at),

  CONSTRAINT fk_case_messages_case
    FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_case_messages_author
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- Files attached to a case. Uses the private document store, not the public media path: a
-- photograph of a damaged parcel or a screenshot of a chat is evidence, not content.
CREATE TABLE case_evidence (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  case_id       BIGINT UNSIGNED NOT NULL,
  uploaded_by   BIGINT UNSIGNED NULL,
  uploader_side ENUM('reporter','seller','staff') NOT NULL DEFAULT 'reporter',

  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime_type     VARCHAR(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  checksum      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caption       VARCHAR(255) NOT NULL DEFAULT '',

  uploaded_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_case_evidence_public (public_id),
  UNIQUE KEY uq_case_evidence_stored (stored_name),
  KEY ix_case_evidence_case (case_id, uploaded_at),
  KEY ix_case_evidence_uploader (uploaded_by),

  CONSTRAINT fk_case_evidence_case
    FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_case_evidence_uploader
    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------
--
-- What Mirwal actually did about something. Separate from `cases` because one case can
-- produce several actions (warn the seller AND delist the product), one action can arise
-- without a case (a routine audit), and an action has its own lifetime — a 7-day listing
-- restriction has to lift itself, which a status on a case cannot express.
CREATE TABLE seller_enforcement_actions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  seller_id     BIGINT UNSIGNED NOT NULL,
  case_id       BIGINT UNSIGNED NULL,

  action_type   ENUM(
                  'warning',            -- recorded, seller notified, nothing restricted
                  'product_removed',
                  'listing_restricted', -- may not create new listings
                  'payout_held',
                  'store_restricted',   -- may fulfil, may not list or promote
                  'store_suspended',    -- listings pulled
                  'store_banned',       -- terminal
                  'review_removed',
                  'penalty',            -- a ledger deduction
                  'reinstated'          -- the reversal of any of the above
                ) NOT NULL,

  severity      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  reason_code   VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  reason_note   VARCHAR(2000) NULL,

  -- What it applied to, when narrower than the whole store.
  subject_type  VARCHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  subject_id    VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,

  -- NULL = indefinite. Anything else lifts itself, which is what stops a temporary
  -- restriction quietly becoming permanent because nobody diarised it.
  expires_at    DATETIME(3) NULL,
  lifted_at     DATETIME(3) NULL,
  lifted_by     BIGINT UNSIGNED NULL,
  lifted_reason VARCHAR(500) NULL,

  -- Every enforcement action is appealable. Recording the appeal on the action rather than in
  -- a separate table keeps "was this appealed, and what happened" in one place.
  appeal_status ENUM('none','requested','under_review','upheld','overturned') NOT NULL DEFAULT 'none',
  appeal_note   VARCHAR(2000) NULL,
  appeal_at     DATETIME(3) NULL,
  -- The appeal must be decided by someone other than the original actor. Storing both makes
  -- that checkable rather than merely intended.
  appeal_decided_by BIGINT UNSIGNED NULL,
  appeal_decided_at DATETIME(3) NULL,

  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_enforcement_public (public_id),
  KEY ix_enforcement_seller (seller_id, created_at),
  -- "What is currently in force against this seller" — the query the seller panel and the
  -- risk score both run.
  KEY ix_enforcement_active (seller_id, lifted_at, expires_at),
  KEY ix_enforcement_case (case_id),
  KEY ix_enforcement_appeals (appeal_status, appeal_at),
  KEY ix_enforcement_actor (created_by),

  CONSTRAINT fk_enforcement_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_enforcement_case
    FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_enforcement_actor
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_enforcement_lifter
    FOREIGN KEY (lifted_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_enforcement_appeal_decider
    FOREIGN KEY (appeal_decided_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Trust and risk
-- ---------------------------------------------------------------------------
--
-- Two scores, not one, because they answer different questions and have different audiences.
--
--   trust_score  — earned standing. Shown to the seller. Drives badges, search placement,
--                  payout speed and auto-approval eligibility.
--   risk_score   — probability of harm. Internal only, and deliberately never returned on any
--                  seller-facing endpoint: a seller who can watch their risk score move can
--                  reverse-engineer the thresholds and stay just under them.
--
-- `factors` holds the contributing counts as JSON so a score is explainable line by line. A
-- number with no explanation is unusable in an appeal, and appeals will happen.
CREATE TABLE seller_scores (
  seller_id       BIGINT UNSIGNED NOT NULL,

  trust_score     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  risk_score      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- Coarse band, so the UI and the payout rules can branch without re-deriving a threshold.
  trust_tier      ENUM('new','bronze','silver','gold','platinum') NOT NULL DEFAULT 'new',
  risk_band       ENUM('low','medium','high','severe') NOT NULL DEFAULT 'low',

  factors         JSON NULL,
  computed_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (seller_id),
  KEY ix_seller_scores_risk (risk_band, risk_score),
  KEY ix_seller_scores_trust (trust_tier, trust_score),

  CONSTRAINT fk_seller_scores_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ck_seller_scores_range
    CHECK (trust_score <= 100 AND risk_score <= 100),
  CONSTRAINT ck_seller_scores_factors
    CHECK (factors IS NULL OR JSON_VALID(factors))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- The history. Kept separately from the current score so a trend is visible and a seller can
-- be shown that their standing is improving — which is the only thing that makes a score
-- motivating rather than merely punitive.
CREATE TABLE seller_score_history (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seller_id    BIGINT UNSIGNED NOT NULL,
  trust_score  SMALLINT UNSIGNED NOT NULL,
  risk_score   SMALLINT UNSIGNED NOT NULL,
  factors      JSON NULL,
  computed_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_score_history_seller (seller_id, computed_at),

  CONSTRAINT fk_score_history_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ck_score_history_factors CHECK (factors IS NULL OR JSON_VALID(factors))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Review integrity
-- ---------------------------------------------------------------------------
--
-- Verified purchase was already enforced by the database — `order_item_id` NOT NULL and
-- UNIQUE, so there is no code path to an unverified review. That is the hard half and it does
-- not change. Everything below is the half that was missing entirely.
ALTER TABLE product_reviews
  ADD COLUMN status ENUM('published','pending','hidden','removed') NOT NULL DEFAULT 'published' AFTER body,
  ADD COLUMN moderation_reason VARCHAR(500) NULL AFTER status,
  ADD COLUMN moderation_code VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER moderation_reason,
  ADD COLUMN moderated_by BIGINT UNSIGNED NULL AFTER moderation_code,
  ADD COLUMN moderated_at DATETIME(3) NULL AFTER moderated_by,
  -- Denormalised so a product page can sort by helpfulness without a per-row subquery.
  ADD COLUMN helpful_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER moderated_at,
  ADD COLUMN report_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER helpful_count,
  ADD COLUMN edited_at DATETIME(3) NULL AFTER report_count,
  -- Captured at submission. A cluster of reviews from one device praising one seller is the
  -- clearest self-review signal there is, and it cannot be reconstructed after the fact.
  ADD COLUMN submitted_ip VARBINARY(16) NULL AFTER edited_at,
  ADD KEY ix_reviews_status (product_id, status, created_at),
  ADD KEY ix_reviews_moderation (status, report_count),
  ADD KEY ix_reviews_moderator (moderated_by),
  ADD CONSTRAINT fk_reviews_moderator
    FOREIGN KEY (moderated_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;


-- A seller's public answer to a review. One per review, and itself moderatable: a seller
-- replying with a customer's phone number is a privacy incident, not a response.
CREATE TABLE review_responses (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  review_id    BIGINT UNSIGNED NOT NULL,
  seller_id    BIGINT UNSIGNED NOT NULL,
  author_id    BIGINT UNSIGNED NULL,

  body         VARCHAR(2000) NOT NULL,
  status       ENUM('published','hidden','removed') NOT NULL DEFAULT 'published',
  moderation_reason VARCHAR(500) NULL,

  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_review_responses_public (public_id),
  -- One response per review. A seller arguing at length under a bad review helps nobody.
  UNIQUE KEY uq_review_responses_review (review_id),
  KEY ix_review_responses_seller (seller_id, created_at),

  CONSTRAINT fk_review_responses_review
    FOREIGN KEY (review_id) REFERENCES product_reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_responses_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_responses_author
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- Reports against a review. Both sides file these: a buyer reporting abuse, a seller
-- reporting a competitor's fake one-star.
CREATE TABLE review_reports (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  review_id    BIGINT UNSIGNED NOT NULL,
  reporter_id  BIGINT UNSIGNED NULL,
  reporter_side ENUM('buyer','seller','staff') NOT NULL DEFAULT 'buyer',

  reason       ENUM('spam','offensive','fake','off_topic','personal_information',
                    'incentivised','competitor','other') NOT NULL DEFAULT 'other',
  details      VARCHAR(1000) NULL,

  status       ENUM('open','reviewing','upheld','dismissed') NOT NULL DEFAULT 'open',
  resolution   VARCHAR(500) NULL,
  reviewed_by  BIGINT UNSIGNED NULL,
  reviewed_at  DATETIME(3) NULL,

  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_review_reports_public (public_id),
  -- One open report per person per review, for the same anti-inflation reason as everywhere
  -- else: five submissions from one angry seller must not look like five complaints.
  UNIQUE KEY uq_review_reports_once (review_id, reporter_id, status),
  KEY ix_review_reports_queue (status, created_at),
  KEY ix_review_reports_review (review_id),
  KEY ix_review_reports_reviewer (reviewed_by),

  CONSTRAINT fk_review_reports_review
    FOREIGN KEY (review_id) REFERENCES product_reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_reports_reporter
    FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_review_reports_moderator
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- Who found a review useful. Also the anti-manipulation record: one vote per person, so
-- "helpful" cannot be inflated by refreshing.
CREATE TABLE review_votes (
  review_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (review_id, user_id),
  KEY ix_review_votes_user (user_id),

  CONSTRAINT fk_review_votes_review
    FOREIGN KEY (review_id) REFERENCES product_reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_votes_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Brand authorisation
-- ---------------------------------------------------------------------------
--
-- The counterfeit control that did not exist. Any seller could attach any brand to any
-- listing, which is exactly how "Apple" and "Nike" listings from unauthorised sellers reach a
-- marketplace's search results.
--
-- Gating is per brand, not global: most brands on Mirwal are small and unprotected, and
-- requiring paperwork for every one of them would stop the catalogue growing for no safety
-- gain. A brand is marked `is_gated` and only then does a listing need an authorisation.
ALTER TABLE brands
  ADD COLUMN is_gated TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active,
  -- Why it is gated, shown to a seller who tries to list against it.
  ADD COLUMN gate_note VARCHAR(500) NULL AFTER is_gated,
  ADD KEY ix_brands_gated (is_gated);

CREATE TABLE brand_authorizations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  brand_id      BIGINT UNSIGNED NOT NULL,
  seller_id     BIGINT UNSIGNED NOT NULL,

  status        ENUM('pending','approved','rejected','revoked','expired') NOT NULL DEFAULT 'pending',
  -- The distributor agreement or authorisation letter. Points at the private document store,
  -- because it names people and carries signatures.
  document_id   BIGINT UNSIGNED NULL,

  -- Authorisations expire, because distribution agreements do.
  valid_from    DATE NULL,
  valid_until   DATE NULL,

  decision_note VARCHAR(1000) NULL,
  reviewed_by   BIGINT UNSIGNED NULL,
  reviewed_at   DATETIME(3) NULL,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_brand_auth_public (public_id),
  -- One authorisation record per seller per brand. A re-application updates it rather than
  -- creating a second row that could disagree with the first.
  UNIQUE KEY uq_brand_auth_pair (brand_id, seller_id),
  KEY ix_brand_auth_queue (status, created_at),
  KEY ix_brand_auth_seller (seller_id, status),
  KEY ix_brand_auth_expiry (valid_until),
  KEY ix_brand_auth_reviewer (reviewed_by),
  KEY ix_brand_auth_document (document_id),

  CONSTRAINT fk_brand_auth_brand
    FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_brand_auth_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_brand_auth_document
    FOREIGN KEY (document_id) REFERENCES seller_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_brand_auth_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_brand_auth_window
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Product moderation history and automated checks
-- ---------------------------------------------------------------------------
--
-- `products` holds only the current status, so "who approved this, when, and what did the
-- automated checks say at the time" was unanswerable — which is precisely what is asked after
-- a counterfeit reaches a buyer.
CREATE TABLE product_moderation_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL,

  event_type    VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  from_status   VARCHAR(30) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  to_status     VARCHAR(30) CHARACTER SET ascii COLLATE ascii_general_ci NULL,

  actor_side    ENUM('seller','admin','system','ai') NOT NULL DEFAULT 'system',
  actor_user_id BIGINT UNSIGNED NULL,

  reason_code   VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  note          VARCHAR(1000) NULL,
  -- What the automated checks found, and what any AI assist suggested. Recorded so an
  -- AI-assisted decision is auditable: the model's opinion, and the human who confirmed it.
  flags         JSON NULL,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_product_moderation_product (product_id, created_at),
  KEY ix_product_moderation_type (event_type, created_at),
  KEY ix_product_moderation_actor (actor_user_id),

  CONSTRAINT fk_product_moderation_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_product_moderation_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_product_moderation_flags CHECK (flags IS NULL OR JSON_VALID(flags))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- Products gain the states a policy takedown actually needs. `rejected` means "did not pass
-- review"; `archived` means "the seller took it down". Neither describes "Mirwal removed this
-- for selling counterfeits", and using one of them for that loses the distinction that
-- matters most in an appeal.
ALTER TABLE products
  MODIFY COLUMN status ENUM('draft','pending_review','active','rejected','archived','delisted')
    NOT NULL DEFAULT 'draft';

ALTER TABLE products
  ADD COLUMN delisted_at DATETIME(3) NULL AFTER rejected_reason,
  ADD COLUMN delisted_reason VARCHAR(500) NULL AFTER delisted_at,
  -- The automated check result from the last submission, so the review queue can be sorted by
  -- risk instead of by arrival.
  ADD COLUMN moderation_flags JSON NULL AFTER delisted_reason,
  ADD COLUMN moderation_risk TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER moderation_flags,
  ADD KEY ix_products_moderation_queue (status, moderation_risk),
  ADD CONSTRAINT ck_products_moderation_flags
    CHECK (moderation_flags IS NULL OR JSON_VALID(moderation_flags));


-- Terms that block or flag a listing. Admin-editable, because the list of what may not be
-- sold changes faster than releases do, and hard-coding it means a lawyer's email becomes a
-- deploy.
CREATE TABLE moderation_rules (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- 'block' refuses the listing outright; 'flag' sends it to a human with a note. Only
  -- unambiguous, legally prohibited goods should ever be 'block' — an automated refusal that
  -- is wrong is invisible to everyone except the seller it silently stopped.
  effect        ENUM('block','flag') NOT NULL DEFAULT 'flag',
  -- 'keyword' matches words in the title or description; 'regex' for structured patterns.
  match_type    ENUM('keyword','regex') NOT NULL DEFAULT 'keyword',
  pattern       VARCHAR(255) NOT NULL,
  -- Which fields to search. Empty = title and description.
  applies_to    VARCHAR(120) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'name,description',

  category      VARCHAR(60) NOT NULL DEFAULT 'prohibited',
  reason_code   VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  message       VARCHAR(500) NOT NULL DEFAULT '',
  -- How much this contributes to the listing's risk score when it matches.
  risk_weight   TINYINT UNSIGNED NOT NULL DEFAULT 10,

  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_moderation_rules_public (public_id),
  UNIQUE KEY uq_moderation_rules_pattern (pattern, match_type),
  KEY ix_moderation_rules_active (is_active, effect),

  CONSTRAINT fk_moderation_rules_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- The starting rule set.
--
-- The 'flag' entries are the Pakistani counterfeit vocabulary specifically — "master copy",
-- "first copy" and "replica" are how counterfeit goods are advertised locally, and a rule set
-- written for a different market would miss all three. They flag rather than block, because
-- each has legitimate uses ("replica football shirt, officially licensed") and an automated
-- refusal that is wrong is invisible to everyone but the seller.
--
-- The 'block' entries are goods that cannot lawfully be sold here at all, where a false
-- positive costs one appeal and a false negative costs considerably more.
INSERT INTO moderation_rules (public_id, effect, match_type, pattern, category, reason_code, message, risk_weight) VALUES
  (UUID(), 'flag',  'keyword', 'master copy',    'counterfeit', 'counterfeit_language', 'Listings advertised as copies are reviewed before publication.', 40),
  (UUID(), 'flag',  'keyword', 'first copy',     'counterfeit', 'counterfeit_language', 'Listings advertised as copies are reviewed before publication.', 40),
  (UUID(), 'flag',  'keyword', 'replica',        'counterfeit', 'counterfeit_language', 'Replica goods are reviewed before publication.', 30),
  (UUID(), 'flag',  'keyword', 'super copy',     'counterfeit', 'counterfeit_language', 'Listings advertised as copies are reviewed before publication.', 40),
  (UUID(), 'flag',  'keyword', '100% original',  'misleading',  'unverifiable_claim',   'Authenticity claims are checked before publication.', 15),
  (UUID(), 'flag',  'keyword', 'stock lot',      'misleading',  'unverifiable_claim',   'Reviewed before publication.', 10),
  (UUID(), 'block', 'keyword', 'firearm',        'prohibited',  'prohibited_weapons',   'Weapons cannot be sold on Mirwal.', 100),
  (UUID(), 'block', 'keyword', 'ammunition',     'prohibited',  'prohibited_weapons',   'Weapons and ammunition cannot be sold on Mirwal.', 100),
  (UUID(), 'block', 'keyword', 'ivory',          'prohibited',  'prohibited_wildlife',  'Wildlife products cannot be sold on Mirwal.', 100),
  (UUID(), 'block', 'keyword', 'prescription drug', 'prohibited','prohibited_medicine', 'Prescription medicines cannot be sold on Mirwal.', 100);
