-- ============================================================================
-- 007 — Payments
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Migration 003 deliberately shipped `orders.payment_method` as ENUM('cod') with a single
-- value, because Mirwal had no gateway integration and offering "Online Payment" as a
-- selectable option would have been a fabricated capability. That's now changing: real
-- integrations exist for card (Stripe) and Pakistan's two dominant mobile wallets
-- (EasyPaisa, JazzCash), each as its own direct integration.
--
-- Two rules this schema enforces:
--
--   1. Mirwal NEVER stores card numbers, CVVs, expiry dates or wallet PINs. Not in this
--      table, not anywhere. Card details go directly from the shopper's browser to the
--      processor, and Mirwal only ever sees an opaque provider reference plus the last four
--      digits and brand for display ("Visa ···· 4242"). This is what keeps Mirwal out of
--      PCI-DSS scope, and it is not negotiable for convenience.
--
--   2. An order is only ever marked paid by a verified provider callback — never by the
--      browser returning to a success URL, which a user can forge by simply visiting it.
--      `payment_attempts` records every attempt with its provider reference so a webhook can
--      be matched back to exactly one order, idempotently.
-- ============================================================================

ALTER TABLE orders
  MODIFY COLUMN payment_method ENUM('cod','card','easypaisa','jazzcash')
    NOT NULL DEFAULT 'cod',
  MODIFY COLUMN payment_status ENUM('pending','processing','paid','failed','refunded')
    NOT NULL DEFAULT 'pending';


-- ----------------------------------------------------------------------------
-- payment_attempts
--
-- One row per attempt, not per order: a shopper whose card is declined and who then pays
-- with JazzCash produces two rows against the same order, and both are worth keeping — the
-- failure is real history, not noise to overwrite.
-- ----------------------------------------------------------------------------
CREATE TABLE payment_attempts (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id            BIGINT UNSIGNED NOT NULL,

  provider            ENUM('stripe','easypaisa','jazzcash') NOT NULL,
  -- The provider's own id for this attempt (Stripe PaymentIntent id, JazzCash txn ref,
  -- EasyPaisa order id). ascii_bin so lookup from a webhook is exact and case-sensitive.
  provider_ref        VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- Amount is re-derived from the order server-side, never taken from the client, and stored
  -- here so a webhook can assert the provider charged what Mirwal actually asked for.
  currency_code       CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',
  amount              DECIMAL(12,2) NOT NULL,

  status              ENUM('created','pending','succeeded','failed','cancelled')
                        NOT NULL DEFAULT 'created',
  failure_reason      VARCHAR(255) NOT NULL DEFAULT '',

  -- Display-only, and the ONLY card-ish data Mirwal ever holds. Never a full PAN.
  card_brand          VARCHAR(30)  NOT NULL DEFAULT '',
  card_last4          CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  -- Wallet payer msisdn, stored masked (e.g. "03XX XXX4567") for support/reconciliation.
  wallet_msisdn_masked VARCHAR(20) NOT NULL DEFAULT '',

  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_attempts_public_id (public_id),
  -- The idempotency anchor: a provider replaying the same webhook cannot create or re-apply
  -- a second attempt for the same reference.
  UNIQUE KEY uq_payment_attempts_provider_ref (provider, provider_ref),
  KEY ix_payment_attempts_order (order_id, created_at),
  KEY ix_payment_attempts_status (status),

  CONSTRAINT fk_payment_attempts_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_payment_attempts_amount CHECK (amount >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- payment_webhook_events
--
-- Every inbound provider callback is recorded before it is acted on, keyed by the provider's
-- own event id. A provider that retries (all three do, on any non-2xx) therefore cannot
-- double-apply a payment: the second delivery collides on this unique key and is skipped.
-- ----------------------------------------------------------------------------
CREATE TABLE payment_webhook_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider      ENUM('stripe','easypaisa','jazzcash') NOT NULL,
  event_id      VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type    VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  payload       LONGTEXT NULL DEFAULT NULL,
  processed_at  DATETIME(3) NULL DEFAULT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_webhook_events (provider, event_id),
  KEY ix_payment_webhook_events_created (created_at)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
