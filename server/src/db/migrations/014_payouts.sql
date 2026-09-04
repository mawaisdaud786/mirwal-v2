-- ============================================================================
-- 014 — Seller payouts
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- The admin panel has a Payouts page and the seller panel has Earnings, Withdrawals and
-- Payment Settings. Nothing was stored: seller "Withdraw" showed a confirmation and did
-- nothing, and the admin payout table was invented rows. For anything involving money that
-- is the most serious version of the fake-action bug in this codebase.
--
-- What this deliberately does NOT do: move money. There is no bank integration here. A payout
-- row records that Mirwal *intends to*, and later *did*, pay a seller — the actual transfer
-- happens outside the system and is marked here with a reference. Building a table that
-- implies automated disbursement would be worse than having none.
--
-- `payout_items` links a payout to the specific order items it pays for. Without that link a
-- payout is an unexplained number, and the same order item could be paid twice — which the
-- unique key here makes impossible.
-- ============================================================================

CREATE TABLE payouts (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reference         VARCHAR(24) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,

  seller_id         BIGINT UNSIGNED NOT NULL,

  -- Sum of the linked items' seller earnings, minus commission. Stored rather than computed
  -- on read: the commission rate may change later, and a historical payout must keep the
  -- figure that was actually paid.
  gross_amount      DECIMAL(12,2) NOT NULL,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_amount        DECIMAL(12,2) NOT NULL,
  currency_code     CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',

  -- requested: the seller asked. approved: Mirwal agreed. paid: money actually left.
  status            ENUM('requested','approved','processing','paid','rejected','failed')
                      NOT NULL DEFAULT 'requested',

  -- How and where it was sent. Free-text on purpose: Mirwal never stores full bank
  -- credentials, only what a human needs to reconcile the transfer.
  method            VARCHAR(40) NOT NULL DEFAULT 'bank_transfer',
  destination_hint  VARCHAR(120) NULL,
  -- The bank/provider's own reference once the transfer has happened.
  external_reference VARCHAR(120) NULL,
  failure_reason    VARCHAR(255) NULL,
  notes             VARCHAR(500) NULL,

  requested_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at       DATETIME(3) NULL,
  approved_by       BIGINT UNSIGNED NULL,
  paid_at           DATETIME(3) NULL,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_payouts_public (public_id),
  UNIQUE KEY uq_payouts_reference (reference),
  KEY ix_payouts_seller (seller_id, status, requested_at),
  KEY ix_payouts_queue (status, requested_at),

  CONSTRAINT ck_payouts_amounts CHECK (
    gross_amount >= 0 AND commission_amount >= 0 AND net_amount >= 0
  ),

  CONSTRAINT fk_payouts_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payouts_approver
    FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE payout_items (
  payout_id     BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  -- The seller's share of this line at the time the payout was assembled.
  amount        DECIMAL(12,2) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (payout_id, order_item_id),
  -- An order item may be paid out exactly once, ever. This is the database-level guarantee
  -- against double-paying a seller, rather than trusting the assembling query to be correct.
  UNIQUE KEY uq_payout_items_item (order_item_id),

  CONSTRAINT fk_payout_items_payout
    FOREIGN KEY (payout_id) REFERENCES payouts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payout_items_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
