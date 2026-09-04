-- ============================================================================
-- 021 — Shipments, order money, and the seller ledger
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Four things this fixes, all of which were silently wrong rather than merely absent.
--
--   1. "Shipped" meant nothing. `order_items.status` could be set to 'shipped' with no
--      carrier, no tracking number and no dispatch time, so the buyer's "track your order"
--      page had nothing to show and a delivery dispute had no evidence on either side.
--
--   2. Order money was incomplete. `shipping_fee` was written as a literal 0 by
--      createOrder(), and there was nowhere at all to record a discount or tax. Every GMV,
--      commission and payout figure in the system was therefore computed from a total that
--      did not match what the buyer actually paid or owed.
--
--   3. A cancellation had no author. `order_items.status = 'cancelled'` was set both when a
--      buyer changed their mind and when a seller could not supply the goods. Those are
--      opposite facts about a seller, and seller-performance was scoring them identically.
--
--   4. A seller's balance was a query, not a record. `getAvailableBalance()` derived it as
--      "delivered, not yet paid out", which cannot express a hold, a reserve against an open
--      return, a refund that landed after payout, an adjustment, or tax withheld. The ledger
--      below makes the balance a sum of recorded facts, so admin and seller can no longer
--      compute different answers, and money already paid can be clawed back.
--
-- The ledger is the significant design decision here. Every event that changes what Mirwal
-- owes a seller writes one immutable row. Nothing updates a balance in place, so a balance is
-- always explainable line by line — which is what an angry seller actually asks for, and what
-- a derived query can never produce.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Order states that real deliveries actually reach
-- ---------------------------------------------------------------------------
--
-- 'returned' already existed on order_items (migration 005). The three added here are states
-- an order genuinely occupies and previously had to be misrepresented as something else:
--   * failed_delivery — the courier could not deliver. Not 'cancelled': the seller shipped,
--     performed correctly, and must not be scored as if they cancelled.
--   * partially_cancelled / partially_refunded — a multi-seller order where one line fell
--     away. Previously the whole order had to be called cancelled or left as if untouched.
ALTER TABLE orders
  MODIFY COLUMN status ENUM(
    'pending','confirmed','processing','shipped','delivered',
    'partially_cancelled','cancelled','failed_delivery','returned'
  ) NOT NULL DEFAULT 'pending';

ALTER TABLE orders
  MODIFY COLUMN payment_status ENUM(
    'pending','processing','paid','failed','partially_refunded','refunded'
  ) NOT NULL DEFAULT 'pending';

ALTER TABLE order_items
  MODIFY COLUMN status ENUM(
    'pending','confirmed','processing','shipped','delivered',
    'cancelled','failed_delivery','returned'
  ) NOT NULL DEFAULT 'pending';


-- ---------------------------------------------------------------------------
-- Order money: discount and tax
-- ---------------------------------------------------------------------------
--
-- `total` stays the authoritative figure the buyer pays. These columns explain it, so that
-- subtotal - discount + shipping + tax = total is checkable rather than assumed.
ALTER TABLE orders
  ADD COLUMN discount_total DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER subtotal,
  ADD COLUMN tax_total      DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER shipping_fee,
  -- The coupon that produced discount_total, if any. SET NULL rather than RESTRICT: deleting
  -- a spent coupon must not be blocked by history, and the code below preserves what was used.
  ADD COLUMN coupon_id      BIGINT UNSIGNED NULL AFTER discount_total,
  -- Snapshotted: the code as typed, kept even if the coupon row is later deleted or renamed.
  ADD COLUMN coupon_code    VARCHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER coupon_id,
  -- Which shipping method was quoted, so a delivery-price dispute has an answer.
  ADD COLUMN shipping_method_id BIGINT UNSIGNED NULL AFTER tax_total,
  ADD COLUMN shipping_method_name VARCHAR(120) NOT NULL DEFAULT '' AFTER shipping_method_id,
  ADD KEY ix_orders_coupon (coupon_id),
  ADD CONSTRAINT fk_orders_coupon
    FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_orders_shipping_method
    FOREIGN KEY (shipping_method_id) REFERENCES shipping_methods (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE orders
  ADD CONSTRAINT ck_orders_discount CHECK (discount_total >= 0 AND tax_total >= 0);


-- ---------------------------------------------------------------------------
-- Order items: attribution, money, and real timestamps
-- ---------------------------------------------------------------------------
ALTER TABLE order_items
  -- The seller's share of any order-level discount, apportioned at checkout. Without it a
  -- marketplace-funded coupon would silently come out of the seller's earnings.
  ADD COLUMN discount_amount   DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER line_total,
  ADD COLUMN tax_amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER discount_amount,
  -- Snapshotted at delivery, not recomputed: the platform rate may change afterwards and a
  -- historical payout must keep the figure that was actually applied.
  ADD COLUMN commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER tax_amount,
  -- Who funded the discount. 'platform' means Mirwal absorbs it and the seller is paid in
  -- full; 'seller' means it comes out of their earnings. Guessing this wrong is how a
  -- marketplace loses a seller's trust permanently.
  ADD COLUMN discount_funded_by ENUM('none','platform','seller') NOT NULL DEFAULT 'none' AFTER commission_amount,

  -- The attribution that seller-performance was missing entirely.
  ADD COLUMN cancelled_by      ENUM('buyer','seller','admin','system') NULL AFTER status,
  ADD COLUMN cancelled_reason  VARCHAR(255) NULL AFTER cancelled_by,
  ADD COLUMN cancelled_at      DATETIME(3) NULL AFTER cancelled_reason,

  -- Real fulfilment timestamps. `updated_at` cannot answer "was this shipped on time"
  -- because any later edit overwrites it.
  ADD COLUMN confirmed_at      DATETIME(3) NULL AFTER cancelled_at,
  ADD COLUMN shipped_at        DATETIME(3) NULL AFTER confirmed_at,
  ADD COLUMN delivered_at      DATETIME(3) NULL AFTER shipped_at,
  -- The seller's dispatch promise for this line, from the store's policy at order time.
  -- On-time dispatch rate is (shipped_at <= dispatch_due_at), and needs both halves.
  ADD COLUMN dispatch_due_at   DATETIME(3) NULL AFTER delivered_at,

  ADD KEY ix_order_items_cancelled_by (cancelled_by),
  ADD KEY ix_order_items_delivered (delivered_at),
  ADD CONSTRAINT ck_order_items_money
    CHECK (discount_amount >= 0 AND tax_amount >= 0 AND commission_amount >= 0);


-- ---------------------------------------------------------------------------
-- order_events — the status history that `status` alone destroys
-- ---------------------------------------------------------------------------
--
-- An order row holds only where it is now. "When did this become shipped, and who moved it"
-- is the first question in every delivery dispute, and it was unanswerable.
CREATE TABLE order_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED NOT NULL,
  -- NULL for an order-level event (payment, cancellation of the whole order).
  order_item_id BIGINT UNSIGNED NULL,

  event_type    VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  from_status   VARCHAR(30) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  to_status     VARCHAR(30) CHARACTER SET ascii COLLATE ascii_general_ci NULL,

  -- Which side caused it. Stored rather than derived from the actor's roles, for the same
  -- reason support_messages.author_side is stored: roles change, history must not.
  actor_side    ENUM('buyer','seller','admin','system','provider') NOT NULL DEFAULT 'system',
  actor_user_id BIGINT UNSIGNED NULL,

  note          VARCHAR(500) NULL,
  metadata      JSON NULL,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_order_events_order (order_id, created_at),
  KEY ix_order_events_item (order_item_id, created_at),
  KEY ix_order_events_type (event_type, created_at),

  CONSTRAINT fk_order_events_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_events_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_order_events_metadata CHECK (metadata IS NULL OR JSON_VALID(metadata))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- carriers
-- ---------------------------------------------------------------------------
--
-- The Pakistani couriers a seller actually hands a parcel to. Seeded with the real set so a
-- seller picks from a list rather than typing "TCS" nine different ways, which is what makes
-- a tracking URL constructible and a delivery-performance report possible.
CREATE TABLE carriers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug           VARCHAR(60) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name           VARCHAR(120) NOT NULL,
  -- {{tracking}} is substituted to build the public tracking link. Empty = no online tracking.
  tracking_url_template VARCHAR(300) NOT NULL DEFAULT '',
  phone          VARCHAR(30) NOT NULL DEFAULT '',
  -- Whether this carrier collects cash on delivery, which decides if COD may be offered.
  supports_cod   TINYINT(1) NOT NULL DEFAULT 1,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  position       SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_carriers_slug (slug),
  KEY ix_carriers_active (is_active, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

INSERT INTO carriers (slug, name, tracking_url_template, supports_cod, position) VALUES
  ('tcs',        'TCS',             'https://www.tcsexpress.com/track/{{tracking}}',      1, 10),
  ('leopards',   'Leopards Courier','https://leopardscourier.com/tracking/{{tracking}}',  1, 20),
  ('mp-courier', 'M&P Courier',     'https://mulphilog.com/track/{{tracking}}',           1, 30),
  ('postex',     'PostEx',          'https://postex.pk/tracking/{{tracking}}',            1, 40),
  ('trax',       'Trax',            'https://sonic.pk/tracking?cn={{tracking}}',          1, 50),
  ('callcourier','CallCourier',     'https://cctrack.callcourier.com.pk/?cn={{tracking}}',1, 60),
  ('daewoo',     'Daewoo FastEx',   '',                                                   1, 70),
  ('pakistan-post','Pakistan Post', 'https://ep.gov.pk/Track.aspx?id={{tracking}}',        1, 80),
  ('self',       'Self / own rider','',                                                   1, 90),
  ('other',      'Other',           '',                                                   1, 99);


-- ---------------------------------------------------------------------------
-- shipments
-- ---------------------------------------------------------------------------
--
-- One parcel. Scoped to a seller rather than an order, because a two-seller order is two
-- parcels sent by two people on two days, and pretending otherwise is what makes multi-vendor
-- tracking incoherent.
--
-- `shipment_items` allows a seller to split one order into several parcels (backorder, bulky
-- goods), which is the case a single tracking column on order_items could not express.
CREATE TABLE shipments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  order_id       BIGINT UNSIGNED NOT NULL,
  seller_id      BIGINT UNSIGNED NOT NULL,
  carrier_id     BIGINT UNSIGNED NULL,

  -- As printed on the parcel. Case-sensitive and exact: a courier's reference is not a name.
  tracking_number VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  -- Denormalised from the carrier so a historical shipment keeps a working link even if the
  -- carrier row is later edited.
  tracking_url   VARCHAR(400) NOT NULL DEFAULT '',

  status         ENUM('ready','dispatched','in_transit','out_for_delivery','delivered','failed','returned','cancelled')
                   NOT NULL DEFAULT 'ready',

  -- What the buyer is told, and what on-time performance is measured against.
  estimated_delivery_at DATETIME(3) NULL,
  dispatched_at  DATETIME(3) NULL,
  delivered_at   DATETIME(3) NULL,
  -- Set when the courier could not deliver. The reason is what decides whether the seller,
  -- the buyer or nobody is at fault, so it is not optional in practice.
  failed_at      DATETIME(3) NULL,
  failure_reason VARCHAR(255) NULL,
  attempt_count  TINYINT UNSIGNED NOT NULL DEFAULT 0,

  -- Proof of delivery: who signed, and a photo if the courier provided one. This is what
  -- decides a "it never arrived" dispute on a COD order.
  received_by    VARCHAR(150) NULL,
  proof_url      VARCHAR(500) NULL,

  weight_grams   INT UNSIGNED NULL,
  -- Cash the courier is to collect. Zero for a prepaid order.
  cod_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cod_collected_at DATETIME(3) NULL,

  notes          VARCHAR(500) NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_shipments_public (public_id),
  -- One tracking number per carrier. A duplicate is a typo or a copy-paste, never a real
  -- second parcel, and catching it here saves a support ticket.
  UNIQUE KEY uq_shipments_tracking (carrier_id, tracking_number),
  KEY ix_shipments_order (order_id),
  KEY ix_shipments_seller (seller_id, status, created_at),
  KEY ix_shipments_status (status, estimated_delivery_at),

  CONSTRAINT fk_shipments_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_shipments_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_shipments_carrier
    FOREIGN KEY (carrier_id) REFERENCES carriers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_shipments_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_shipments_cod CHECK (cod_amount >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE shipment_items (
  shipment_id   BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (shipment_id, order_item_id),
  KEY ix_shipment_items_item (order_item_id),

  CONSTRAINT fk_shipment_items_shipment
    FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_shipment_items_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ck_shipment_items_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- seller_ledger_entries
-- ---------------------------------------------------------------------------
--
-- The single source of truth for what Mirwal owes a seller.
--
-- Append-only. Nothing here is ever updated or deleted: a reversal is a new row with the
-- opposite sign, exactly as a real ledger works. That is what makes a balance explainable and
-- a clawback possible — `getAvailableBalance()` previously derived a number from order rows,
-- which could not represent money that had already been paid and then became owed back.
--
--   amount > 0  Mirwal owes the seller more (an earning, a reversal of a deduction)
--   amount < 0  Mirwal owes the seller less (commission, refund, tax, a payout leaving)
--
-- `available_at` is the hold. An earning is recorded the moment an item is delivered but is
-- not withdrawable until the return window closes, which is the control that stops Mirwal
-- paying out money it is about to owe back.
CREATE TABLE seller_ledger_entries (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seller_id      BIGINT UNSIGNED NOT NULL,

  entry_type     ENUM(
                   'sale',            -- gross earning on a delivered item
                   'commission',      -- Mirwal's cut, negative
                   'refund',          -- buyer refunded, negative
                   'commission_refund',-- commission returned to the seller on a refund, positive
                   'tax_withheld',    -- withholding tax, negative
                   'shipping_fee',    -- delivery cost borne by the seller, negative
                   'adjustment',      -- manual correction by finance, either sign
                   'penalty',         -- enforcement fine, negative
                   'chargeback',      -- negative
                   'payout',          -- money leaving to the seller, negative
                   'payout_reversal'  -- a failed transfer coming back, positive
                 ) NOT NULL,

  amount         DECIMAL(12,2) NOT NULL,
  currency_code  CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',

  -- What caused it. Nullable because an adjustment has no order behind it.
  order_item_id  BIGINT UNSIGNED NULL,
  order_id       BIGINT UNSIGNED NULL,
  payout_id      BIGINT UNSIGNED NULL,
  refund_id      BIGINT UNSIGNED NULL,

  -- When this becomes withdrawable. NOW for a deduction (a debt is immediate); order
  -- delivery + the hold window for an earning.
  available_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  description    VARCHAR(255) NOT NULL DEFAULT '',
  -- Set on a row that reverses an earlier one, so a correction is traceable to what it fixed.
  reverses_id    BIGINT UNSIGNED NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_ledger_public (public_id),
  -- The balance query: one seller, entries that have matured.
  KEY ix_seller_ledger_balance (seller_id, available_at),
  KEY ix_seller_ledger_type (seller_id, entry_type, created_at),
  KEY ix_seller_ledger_order_item (order_item_id),
  KEY ix_seller_ledger_payout (payout_id),
  KEY ix_seller_ledger_reverses (reverses_id),
  KEY ix_seller_ledger_order (order_id),
  KEY ix_seller_ledger_refund (refund_id),

  CONSTRAINT fk_seller_ledger_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_seller_ledger_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_ledger_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_ledger_payout
    FOREIGN KEY (payout_id) REFERENCES payouts (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_ledger_refund
    FOREIGN KEY (refund_id) REFERENCES refunds (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_ledger_reverses
    FOREIGN KEY (reverses_id) REFERENCES seller_ledger_entries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_seller_ledger_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- One `sale` row per order item, ever. The same guarantee `uq_payout_items_item` gives for
-- payouts: an earning cannot be credited twice by a retried job or a double-fired event.
--
-- A generated column again, because the uniqueness applies only to the 'sale' type — a seller
-- may legitimately have a sale, a commission and a refund all pointing at the same item.
ALTER TABLE seller_ledger_entries
  ADD COLUMN sale_order_item_id BIGINT UNSIGNED
    AS (CASE WHEN entry_type = 'sale' THEN order_item_id ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_seller_ledger_sale_once (sale_order_item_id);


-- ---------------------------------------------------------------------------
-- Returns: the states a real return actually passes through
-- ---------------------------------------------------------------------------
--
-- Three outcomes (requested/approved/rejected) could not express a return that was approved,
-- posted, and is now in transit — nor one where the seller needs a photo before deciding, nor
-- a replacement rather than a refund. Each of those had to be represented as one of the three,
-- which meant the status was telling the buyer something untrue.
ALTER TABLE return_requests
  MODIFY COLUMN status ENUM(
    'requested','more_info_required','approved','in_transit','received',
    'refunded','replaced','rejected','cancelled','escalated'
  ) NOT NULL DEFAULT 'requested';

ALTER TABLE return_requests
  -- A buyer who wants the item replaced rather than refunded is asking for something the
  -- schema could not previously record.
  ADD COLUMN return_type ENUM('refund','replacement','repair') NOT NULL DEFAULT 'refund' AFTER reason,
  -- Photographs are how a "damaged on arrival" claim is settled. Count denormalised so the
  -- queue can show "has evidence" without a join per row.
  ADD COLUMN evidence_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER description,
  ADD COLUMN return_carrier_id BIGINT UNSIGNED NULL AFTER evidence_count,
  ADD COLUMN return_tracking VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER return_carrier_id,
  ADD COLUMN received_at   DATETIME(3) NULL AFTER resolved_at,
  -- Who pays to send it back. 'seller' when the fault is theirs, which is the default for a
  -- damaged or wrong item and the main thing buyers argue about.
  ADD COLUMN return_shipping_paid_by ENUM('buyer','seller','platform') NULL AFTER received_at,
  -- Escalation: the buyer disagreed with the seller's decision. This is the seam the dispute
  -- system in migration 022 attaches to.
  ADD COLUMN escalated_at  DATETIME(3) NULL AFTER return_shipping_paid_by,
  ADD COLUMN admin_decision ENUM('upheld_seller','upheld_buyer','partial') NULL AFTER escalated_at,
  ADD COLUMN admin_decision_by BIGINT UNSIGNED NULL AFTER admin_decision,
  ADD COLUMN admin_decision_at DATETIME(3) NULL AFTER admin_decision_by,
  ADD COLUMN admin_decision_note VARCHAR(1000) NULL AFTER admin_decision_at,
  -- The window this request was filed within, so a late request is visibly late.
  ADD COLUMN window_closes_at DATETIME(3) NULL AFTER created_at,

  ADD KEY ix_return_requests_escalated (escalated_at),
  ADD KEY ix_return_requests_carrier (return_carrier_id),
  ADD KEY ix_return_requests_decider (admin_decision_by),
  ADD CONSTRAINT fk_return_requests_carrier
    FOREIGN KEY (return_carrier_id) REFERENCES carriers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_return_requests_decider
    FOREIGN KEY (admin_decision_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;


-- The one-return-per-item rule was `UNIQUE (order_item_id)`, which meant a rejected request
-- permanently consumed the buyer's only attempt — deliberate at the time, and wrong now that
-- a rejection can be escalated and a cancelled request should not block a genuine second one.
--
-- Replaced with "one OPEN request per item", which keeps the protection that mattered (a
-- buyer cannot file five simultaneous claims on one item) without the part that did not.
--
-- The unique index is also the index `fk_return_requests_order_item` relies on, so a plain
-- one has to exist before it can be dropped — MariaDB refuses to leave a foreign key
-- unindexed, and does not create a replacement on its own.
ALTER TABLE return_requests
  ADD KEY ix_return_requests_order_item (order_item_id);

ALTER TABLE return_requests
  DROP INDEX uq_return_requests_order_item;

ALTER TABLE return_requests
  ADD COLUMN open_order_item_id BIGINT UNSIGNED
    AS (CASE WHEN status IN ('requested','more_info_required','approved','in_transit','received','escalated')
             THEN order_item_id ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_return_requests_open (open_order_item_id);


-- Return evidence. Reuses the hardened upload path that already serves seller documents:
-- generated filenames, magic-byte type detection, storage outside any web root, and reads only
-- through an authenticated endpoint. A buyer's photo of a damaged parcel is not public.
CREATE TABLE return_evidence (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  return_request_id BIGINT UNSIGNED NOT NULL,
  -- Who supplied it. Both sides may: the seller's photo of what came back matters too.
  uploaded_by    BIGINT UNSIGNED NULL,
  uploader_side  ENUM('buyer','seller','admin') NOT NULL DEFAULT 'buyer',

  original_name  VARCHAR(255) NOT NULL,
  stored_name    VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime_type      VARCHAR(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  checksum       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  caption        VARCHAR(255) NOT NULL DEFAULT '',
  uploaded_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_return_evidence_public (public_id),
  UNIQUE KEY uq_return_evidence_stored (stored_name),
  KEY ix_return_evidence_request (return_request_id, uploaded_at),
  KEY ix_return_evidence_uploader (uploaded_by),

  CONSTRAINT fk_return_evidence_request
    FOREIGN KEY (return_request_id) REFERENCES return_requests (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_return_evidence_uploader
    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- Payout controls the ledger makes possible
-- ---------------------------------------------------------------------------
ALTER TABLE payouts
  ADD COLUMN tax_withheld   DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER commission_amount,
  ADD COLUMN adjustments    DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER tax_withheld,
  ADD COLUMN hold_reason    VARCHAR(255) NULL AFTER failure_reason,
  ADD COLUMN held_by        BIGINT UNSIGNED NULL AFTER hold_reason,
  ADD COLUMN held_at        DATETIME(3) NULL AFTER held_by,
  ADD KEY ix_payouts_held_by (held_by),
  ADD CONSTRAINT fk_payouts_held_by
    FOREIGN KEY (held_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE payouts
  MODIFY COLUMN status ENUM('requested','on_hold','approved','processing','paid','rejected','failed','reversed')
    NOT NULL DEFAULT 'requested';


-- ---------------------------------------------------------------------------
-- Settings that govern the money rules above
-- ---------------------------------------------------------------------------
--
-- Registered in the DEFAULTS list in modules/settings/settings.service.js rather than
-- inserted here, for the reason given in migration 020: one registry, seeded lazily, so a
-- fresh install and an upgrade cannot end up with different keys. The keys this migration
-- relies on are finance.payout_hold_days, finance.withholding_tax_bps,
-- orders.return_window_days and orders.dispatch_sla_hours.
