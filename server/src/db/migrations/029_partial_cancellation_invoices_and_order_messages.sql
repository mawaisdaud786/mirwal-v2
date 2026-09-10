-- ============================================================================
-- 029 — Partial cancellation, tax invoices, and talking about an order
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Three gaps that share a theme: an order is not a single indivisible thing, and Mirwal's
-- schema kept insisting that it was.
--
--   * **Cancelling is all-or-nothing per line.** A buyer who ordered three of something and
--     wants one fewer had to cancel the whole line and re-order two, which loses their place in
--     the dispatch queue and any coupon that required the original basket. Sellers had no way
--     to cancel at all: an item they could not supply sat in `processing` until a human
--     intervened, and the cancellation-rate figure that scores sellers had no way to record who
--     was actually responsible.
--
--   * **No invoice exists.** Sales tax is computed and stored per order, and no document ever
--     states it. A Pakistani buyer registered for sales tax cannot claim input tax without one,
--     and Mirwal cannot show what it collected. An invoice is a legal record, not a rendering
--     of the current row: it must keep the numbers as they were when issued, even if the order
--     is later partly refunded.
--
--   * **Nowhere to ask a question.** A buyer with a question about a live order could open a
--     support ticket with Mirwal or file a return. There was no way to reach the seller who is
--     actually holding the parcel, which is why so much of `support_tickets` is people asking
--     Mirwal to relay a message.

-- ---------------------------------------------------------------------------
-- order_items.cancelled_quantity
-- ---------------------------------------------------------------------------
--
-- `quantity` stays the live quantity — what is still owed and still to be shipped — so every
-- existing SUM, every shipment allocation and every ledger figure keeps working untouched.
-- `cancelled_quantity` is the record of what was pulled, which is what makes a partial
-- cancellation visible rather than just a smaller number than the buyer remembers ordering.
--
-- The alternative — splitting the line into two rows — was rejected: shipments, returns,
-- reviews and ledger entries all reference `order_items.id`, and a split would leave every one
-- of them pointing at whichever half happened to keep the id.
ALTER TABLE order_items
  ADD COLUMN cancelled_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER quantity,
  -- What the cancelled portion was worth. Needed for the refund and for the invoice's credit
  -- line; recomputing it from `unit_price` later would silently drop the apportioned discount.
  ADD COLUMN cancelled_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER cancelled_quantity;

-- A fully cancelled line sets `status = 'cancelled'` as before; a partial one leaves the status
-- alone. This keeps "is this line still live" a single-column question.

-- ---------------------------------------------------------------------------
-- refunds: refunds that do not come from a return
-- ---------------------------------------------------------------------------
--
-- Every refund row so far was created by a return being upheld, so `return_request_id` was
-- effectively mandatory and there was no way to record why money went back. A cancellation
-- refund and a goodwill gesture are both real, and both need to be distinguishable from a
-- return refund on a tax statement.
ALTER TABLE refunds
  ADD COLUMN kind ENUM('return','cancellation','goodwill','chargeback') NOT NULL DEFAULT 'return' AFTER return_request_id,
  ADD COLUMN order_item_id BIGINT UNSIGNED NULL AFTER return_request_id,
  ADD COLUMN reason VARCHAR(255) NULL AFTER kind,
  -- Who decided. A discretionary refund is an exercise of judgement and must be attributable.
  ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER reason,
  ADD KEY ix_refunds_kind (kind, created_at),
  ADD KEY ix_refunds_order_item (order_item_id),
  ADD CONSTRAINT fk_refunds_order_item FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_refunds_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- order_invoices
-- ---------------------------------------------------------------------------
--
-- One per order, issued once and never rewritten. The totals are copied rather than joined
-- because that is the whole point of an invoice: it says what was charged on the day, and a
-- later refund produces a separate credit note rather than editing history.
CREATE TABLE order_invoices (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- Human-facing and sequential within a series, because a tax authority expects a gapless run.
  -- Generated in the service under a row lock on the counter, not by AUTO_INCREMENT, which
  -- leaves gaps on rollback.
  invoice_number    VARCHAR(32) NOT NULL,
  order_id          BIGINT UNSIGNED NOT NULL,

  -- Who issued it. Mirwal invoices as the marketplace of record; the seller's own tax numbers
  -- are captured per line below, because a multi-seller order is several supplies.
  issuer_name       VARCHAR(200) NOT NULL,
  issuer_ntn        VARCHAR(40) NULL,
  issuer_strn       VARCHAR(40) NULL,
  issuer_address    VARCHAR(500) NULL,

  -- The buyer as they were at the time. An address changed next month does not change what was
  -- delivered where.
  bill_to_name      VARCHAR(150) NOT NULL,
  bill_to_phone     VARCHAR(20) NULL,
  bill_to_address   VARCHAR(600) NULL,
  bill_to_ntn       VARCHAR(40) NULL,

  currency_code     CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',
  subtotal          DECIMAL(12,2) NOT NULL,
  discount_total    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  shipping_fee      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_total         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total             DECIMAL(12,2) NOT NULL,
  -- Whether the line prices already contained the tax. Without it the figures are ambiguous a
  -- year later, when the setting has been changed.
  tax_inclusive     TINYINT(1) NOT NULL DEFAULT 1,

  -- The lines as issued, including each seller's own tax registration. JSON rather than a child
  -- table: nothing ever queries inside an issued invoice, and a child table invites the edits
  -- an invoice must not have. Named `line_items` because LINES is reserved in MariaDB.
  line_items        LONGTEXT NULL CHECK (line_items IS NULL OR JSON_VALID(line_items)),

  issued_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_order_invoices_public (public_id),
  UNIQUE KEY uq_order_invoices_number (invoice_number),
  -- One invoice per order. A reissue corrects nothing; a credit note is the instrument for that.
  UNIQUE KEY uq_order_invoices_order (order_id),
  CONSTRAINT fk_order_invoices_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invoice_counters
-- ---------------------------------------------------------------------------
--
-- A numbering series per year. One row, locked with SELECT ... FOR UPDATE while the next number
-- is taken, which is what makes the run gapless under concurrency.
CREATE TABLE invoice_counters (
  series        VARCHAR(20) NOT NULL,
  last_number   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (series)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- order_messages
-- ---------------------------------------------------------------------------
--
-- A thread per (order, seller) rather than per order: a basket split across three stores is
-- three separate conversations, and letting one seller read another's thread would expose both
-- the buyer's other purchases and a competitor's service.
--
-- Deliberately not a support ticket. A ticket is Mirwal answering; this is the buyer and the
-- seller talking, with Mirwal able to read it if a case is later opened — which is exactly the
-- evidence a dispute needs and which a private channel would not produce.
CREATE TABLE order_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  order_id        BIGINT UNSIGNED NOT NULL,
  seller_id       BIGINT UNSIGNED NOT NULL,
  -- Which item prompted it, when the buyer picked one. Nullable: most questions are about the
  -- parcel, not a line.
  order_item_id   BIGINT UNSIGNED NULL,

  author_side     ENUM('buyer','seller','admin','system') NOT NULL,
  author_user_id  BIGINT UNSIGNED NULL,
  body            VARCHAR(4000) NOT NULL,

  -- Staff notes on the thread, invisible to both parties. Same reasoning as `case_messages`:
  -- without it, an operator investigating has to keep their working out somewhere else.
  is_internal     TINYINT(1) NOT NULL DEFAULT 0,

  read_by_buyer_at   DATETIME(3) NULL,
  read_by_seller_at  DATETIME(3) NULL,

  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_order_messages_public (public_id),
  KEY ix_order_messages_thread (order_id, seller_id, created_at),
  KEY ix_order_messages_seller_unread (seller_id, read_by_seller_at),
  CONSTRAINT fk_order_messages_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_messages_seller FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_messages_item FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE SET NULL,
  CONSTRAINT fk_order_messages_author FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
--
-- Cancelling on a buyer's behalf and refunding without a return are both discretionary spends
-- of Mirwal's money, so they are their own permissions rather than riding on `order.write`.
INSERT INTO permissions (slug, area, description) VALUES
  ('order.cancel',        'orders', 'Cancel order items on behalf of a buyer or seller'),
  ('order.refund.manual', 'orders', 'Issue a refund that no return required'),
  ('order.invoice.read',  'orders', 'View and reissue order invoices'),
  ('order.message.read',  'orders', 'Read buyer-seller order conversations')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
    ON p.slug IN ('order.cancel', 'order.refund.manual', 'order.invoice.read', 'order.message.read')
 WHERE r.slug IN ('super_admin', 'admin')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Support staff answer the people in these threads, so reading them is the job. Refunding is
-- not, and finance keeps that.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
    ON p.slug IN ('order.message.read', 'order.invoice.read', 'order.cancel')
 WHERE r.slug = 'customer_support'
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
    ON p.slug IN ('order.refund.manual', 'order.invoice.read')
 WHERE r.slug = 'finance_manager'
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
