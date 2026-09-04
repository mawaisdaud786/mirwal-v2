-- ============================================================================
-- 005 — Returns
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Two distinct post-purchase paths, kept separate because they have different rules:
--
--   Cancellation — the buyer's own right, before the seller has shipped anything. No new
--   table: it's just `order_items.status` moving to 'cancelled', which the seller-scoped
--   status endpoint already supports; this migration only adds a buyer-facing route for it.
--
--   Return — only possible after delivery, and requires the seller's review (a buyer cannot
--   unilaterally reverse a completed fulfillment the way they can cancel an unshipped one).
--   That review is the `return_requests` table below.
--
-- `order_items.status` gains a 'returned' terminal value, distinct from 'cancelled': an order
-- that was cancelled never completed; one that was returned did, then came back.
-- ============================================================================

ALTER TABLE order_items
  MODIFY COLUMN status ENUM('pending','confirmed','processing','shipped','delivered','cancelled','returned')
    NOT NULL DEFAULT 'pending';

-- ----------------------------------------------------------------------------
-- return_requests
--
-- One row per return attempt on one order item. `seller_id` is denormalised from the item
-- (same ownership role as everywhere else in the orders schema) so the seller's review queue
-- is `WHERE seller_id = ?`, not a join through orders/order_items every time.
-- ----------------------------------------------------------------------------
CREATE TABLE return_requests (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_item_id     BIGINT UNSIGNED NOT NULL,
  buyer_id          BIGINT UNSIGNED NOT NULL,
  seller_id         BIGINT UNSIGNED NOT NULL,

  reason            VARCHAR(100)  NOT NULL,
  description       VARCHAR(1000) NOT NULL DEFAULT '',

  status            ENUM('requested','approved','rejected') NOT NULL DEFAULT 'requested',
  resolution_note   VARCHAR(500) NOT NULL DEFAULT '',
  resolved_at       DATETIME(3)  NULL DEFAULT NULL,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_return_requests_public_id (public_id),
  -- One active return request per item — a rejected request does not free up a second try,
  -- which is a deliberate simplification (a real dispute-escalation path is future work, not
  -- silently allowed by letting the buyer just file again).
  UNIQUE KEY uq_return_requests_order_item (order_item_id),
  KEY ix_return_requests_buyer (buyer_id, created_at),
  KEY ix_return_requests_seller_status (seller_id, status, created_at),

  CONSTRAINT fk_return_requests_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_return_requests_buyer
    FOREIGN KEY (buyer_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_return_requests_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
