-- ============================================================================
-- 028 — Returns: partial refunds and the conversation around a return
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Migration 021 built the return lifecycle — `more_info_required`, `in_transit`, `received`,
-- `escalated`, carriage liability, an admin decision — and two things it did not provide have
-- turned out to be load-bearing now that the lifecycle is actually wired up:
--
--   * **How much was refunded.** The refund row records it, but a return whose refund is still
--     `manual_required` has an amount that exists nowhere the buyer or the seller can see, and
--     a partial settlement is invisible on the return itself. Storing it on the request means
--     the return can state its own outcome without joining to money.
--
--   * **Somewhere to put words.** `return_evidence` is a file table — every column that
--     matters is NOT NULL and describes an upload — so a buyer explaining why they disagree,
--     or a seller answering, or Mirwal recording what it asked for, had nowhere to go. Rather
--     than loosen five NOT NULL constraints and leave a table where half the rows are not
--     evidence, this follows the split migration 023 already made between `case_evidence` and
--     `case_messages`.

-- ---------------------------------------------------------------------------
-- return_requests.refund_amount
-- ---------------------------------------------------------------------------
--
-- Nullable, because most of a return's life it has not been decided. Capped against the line
-- total in the service rather than by a constraint here: the ceiling lives on `order_items`,
-- and a CHECK cannot reach across the join.
ALTER TABLE return_requests
  ADD COLUMN refund_amount DECIMAL(12,2) NULL AFTER return_type;


-- ---------------------------------------------------------------------------
-- return_messages
-- ---------------------------------------------------------------------------
--
-- The thread on a return: what the seller asked for, what the buyer answered, what Mirwal
-- concluded. Three rules, each borrowed from `case_messages` because a return dispute and a
-- trust-and-safety case are the same shape of problem:
--
--   * `author_side` is stored, never derived from the author's roles. Roles change; who said
--     what must not.
--
--   * `is_internal` lets staff write for each other without the parties reading it. A note
--     meant for a colleague that reaches the seller by accident is the expensive mistake.
--
--   * The author is nullable and the row survives them, because deleting an account must not
--     silently rewrite the record of a dispute.
CREATE TABLE return_messages (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  return_request_id BIGINT UNSIGNED NOT NULL,

  author_id         BIGINT UNSIGNED NULL,
  author_side       ENUM('buyer','seller','admin','system') NOT NULL,
  is_internal       TINYINT(1) NOT NULL DEFAULT 0,

  body              VARCHAR(4000) NOT NULL,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_return_messages_public (public_id),
  KEY ix_return_messages_request (return_request_id, created_at),
  KEY ix_return_messages_author (author_id),

  CONSTRAINT fk_return_messages_request
    FOREIGN KEY (return_request_id) REFERENCES return_requests (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_return_messages_author
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Permissions for the dispute queue
-- ---------------------------------------------------------------------------
--
-- Deciding a disputed return is not the same authority as reading orders. It moves money away
-- from a seller and against their stated decision, so it gets its own permission — held by
-- the roles that already adjudicate, not by everyone who can open an order.
INSERT INTO permissions (slug, area, description) VALUES
  ('order.return.adjudicate', 'orders', 'Decide a return the buyer has escalated to Mirwal')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
 WHERE p.slug = 'order.return.adjudicate'
   AND r.slug IN ('super_admin', 'admin', 'marketplace_manager', 'customer_support', 'risk_manager')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
