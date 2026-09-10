-- ============================================================================
-- 008 — Refunds
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Section 32 built returns: approving one marks the item 'returned' and restocks it. What it
-- did not do is move money back. This table closes that gap.
--
-- Not every refund can be automated, and the schema says so rather than pretending:
--
--   card (Stripe)          -> automated. Stripe's refunds API is called directly and the
--                             result is authoritative.
--   easypaisa / jazzcash   -> 'manual_required'. Both wallets do expose refund APIs, but they
--                             need merchant-portal-enabled permissions and their exact
--                             contracts were not available when this was built (same caveat
--                             as the payment adapters). Automating a money-OUT call I cannot
--                             verify risks double-refunding or silently failing, so Mirwal
--                             records what is owed and asks a human to action it in the
--                             merchant portal instead.
--   cod                    -> 'manual_required' by definition: the money was collected in
--                             cash by the courier, so there is no gateway to reverse.
--
-- A refund therefore always has a truthful status. 'manual_required' is a real state a human
-- resolves, not a euphemism for "failed".
-- ============================================================================

CREATE TABLE refunds (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  order_id            BIGINT UNSIGNED NOT NULL,
  -- The return that caused it. Nullable because an admin may one day refund without a return
  -- (goodwill, a billing error); the schema should not forbid that before it exists.
  return_request_id   BIGINT UNSIGNED NULL DEFAULT NULL,
  -- The original payment being reversed. NULL for COD, which had no payment attempt at all.
  payment_attempt_id  BIGINT UNSIGNED NULL DEFAULT NULL,

  provider            ENUM('stripe','easypaisa','jazzcash','cod') NOT NULL,
  -- The provider's own refund id, once one exists. Empty for manual refunds until settled.
  provider_ref        VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',

  currency_code       CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',
  amount              DECIMAL(12,2) NOT NULL,

  status              ENUM('pending','manual_required','succeeded','failed') NOT NULL DEFAULT 'pending',
  failure_reason      VARCHAR(255) NOT NULL DEFAULT '',
  -- Who marked a manual refund done, and when. Null until a human actions it.
  settled_by_user_id  BIGINT UNSIGNED NULL DEFAULT NULL,
  settled_at          DATETIME(3) NULL DEFAULT NULL,

  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_public_id (public_id),
  -- One refund per return request: approving a return twice cannot pay a buyer twice.
  -- (resolveReturnRequestForSeller already refuses to re-resolve, but money-out deserves the
  -- constraint at the storage layer too, not only in application logic.)
  UNIQUE KEY uq_refunds_return_request (return_request_id),
  KEY ix_refunds_order (order_id, created_at),
  KEY ix_refunds_status (status),

  CONSTRAINT fk_refunds_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_return_request
    FOREIGN KEY (return_request_id) REFERENCES return_requests (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_payment_attempt
    FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_settled_by
    FOREIGN KEY (settled_by_user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_refunds_amount CHECK (amount >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
