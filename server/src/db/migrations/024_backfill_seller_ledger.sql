-- ============================================================================
-- 024 — Backfill the seller ledger from existing orders
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Migration 021 introduced `seller_ledger_entries` and made it the source of truth for what
-- Mirwal owes a seller. Without this migration that change would be silently destructive: the
-- balance used to be derived from `order_items` on the fly, so every seller's earnings existed
-- only as a query. The moment the code started reading the ledger instead, every existing
-- seller's balance would have become zero — including money they had genuinely earned and not
-- yet withdrawn.
--
-- This reconstructs the ledger from the orders that actually happened. Three rules:
--
--   1. Only `delivered` items produce an earning, matching the live rule exactly.
--
--   2. Earnings are backdated to `delivered_at` (falling back to `updated_at`, since
--      `delivered_at` did not exist before migration 021) and marked available immediately.
--      Applying the new hold window retroactively would freeze money sellers have already been
--      told is theirs, which is a worse failure than not holding money that predates the rule.
--
--   3. Anything already paid out is reconstructed too, so a seller's history reads correctly
--      and their balance does not double-count what they have already received.
--
-- `uq_seller_ledger_sale_once` makes every INSERT here idempotent by construction: re-running
-- against a partially-populated ledger cannot create a second earning for one item.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Earnings for delivered items
-- ---------------------------------------------------------------------------
--
-- `discount_funded_by` decides the seller's share, the same way postSaleEarning() does: a
-- platform-funded discount is Mirwal's cost and the seller is paid the full line, while a
-- seller-funded one comes out of their own earnings. Every pre-existing row has 'none', so
-- this reduces to the full line total for historical data — which is what those sellers were
-- promised under the old model.
INSERT IGNORE INTO seller_ledger_entries
  (public_id, seller_id, entry_type, amount, currency_code, order_item_id, order_id,
   available_at, description, created_at)
SELECT
  UUID(),
  oi.seller_id,
  'sale',
  CASE WHEN oi.discount_funded_by = 'seller'
       THEN oi.line_total - oi.discount_amount
       ELSE oi.line_total END,
  o.currency_code,
  oi.id,
  oi.order_id,
  -- Immediately available: see rule 2 above.
  COALESCE(oi.delivered_at, oi.updated_at),
  'Delivered order item (backfilled)',
  COALESCE(oi.delivered_at, oi.updated_at)
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE oi.status = 'delivered';


-- ---------------------------------------------------------------------------
-- 2. Commission on those earnings
-- ---------------------------------------------------------------------------
--
-- Uses the seller's override where one exists, otherwise the platform rate, otherwise the
-- documented 10% default that `payouts.service.js` has always fallen back to. Read from
-- `platform_settings` at apply time rather than hard-coded, so a marketplace that has already
-- changed its commission does not get its history rewritten at the wrong rate.
--
-- No unique key protects this one — commission is not restricted to one row per item, because
-- a refund legitimately adds a `commission_refund` later. The NOT EXISTS is therefore what
-- makes a re-run safe.
INSERT INTO seller_ledger_entries
  (public_id, seller_id, entry_type, amount, currency_code, order_item_id, order_id,
   available_at, description, created_at)
SELECT
  UUID(),
  oi.seller_id,
  'commission',
  -ROUND(
    (CASE WHEN oi.discount_funded_by = 'seller'
          THEN oi.line_total - oi.discount_amount
          ELSE oi.line_total END)
    * COALESCE(
        s.commission_bps_override,
        (SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(ps.value_json, '$.v')) AS UNSIGNED)
           FROM platform_settings ps WHERE ps.`key` = 'finance.commission_bps'),
        1000
      ) / 10000,
    2),
  o.currency_code,
  oi.id,
  oi.order_id,
  COALESCE(oi.delivered_at, oi.updated_at),
  'Marketplace commission (backfilled)',
  COALESCE(oi.delivered_at, oi.updated_at)
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN sellers s ON s.id = oi.seller_id
WHERE oi.status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM seller_ledger_entries e
     WHERE e.order_item_id = oi.id AND e.entry_type = 'commission'
  );


-- Snapshot the commission onto the item, which is where the live path records it so that a
-- historical payout keeps the rate actually applied even after the platform rate changes.
UPDATE order_items oi
   SET oi.commission_amount = COALESCE((
     SELECT -SUM(e.amount) FROM seller_ledger_entries e
      WHERE e.order_item_id = oi.id AND e.entry_type = 'commission'
   ), 0)
 WHERE oi.status = 'delivered' AND oi.commission_amount = 0;


-- ---------------------------------------------------------------------------
-- 3. Withdrawals that have already happened
-- ---------------------------------------------------------------------------
--
-- Without these the ledger would show every past earning as still owed, and a seller who had
-- already been paid would appear able to withdraw the same money a second time.
--
-- Only payouts that actually moved money are reconstructed. A `requested` or `rejected` payout
-- never left, so it is not a ledger event — and the live path posts the debit at request time,
-- which is why 'requested' is deliberately excluded here rather than merely overlooked: those
-- rows predate that behaviour and their money is still in the seller's balance.
INSERT INTO seller_ledger_entries
  (public_id, seller_id, entry_type, amount, currency_code, payout_id,
   available_at, description, created_at)
SELECT
  UUID(),
  p.seller_id,
  'payout',
  -p.net_amount,
  p.currency_code,
  p.id,
  COALESCE(p.paid_at, p.approved_at, p.requested_at),
  CONCAT('Withdrawal ', p.reference, ' (backfilled)'),
  COALESCE(p.paid_at, p.approved_at, p.requested_at)
FROM payouts p
WHERE p.status IN ('approved', 'processing', 'paid')
  AND NOT EXISTS (
    SELECT 1 FROM seller_ledger_entries e
     WHERE e.payout_id = p.id AND e.entry_type = 'payout'
  );


-- ---------------------------------------------------------------------------
-- 4. Refunds that have already been paid to buyers
-- ---------------------------------------------------------------------------
--
-- A refund reverses the seller's earning. Reconstructing these is what stops a seller's
-- backfilled balance including money that was handed back to a buyer months ago.
INSERT INTO seller_ledger_entries
  (public_id, seller_id, entry_type, amount, currency_code, order_item_id, order_id, refund_id,
   available_at, description, created_at)
SELECT
  UUID(),
  oi.seller_id,
  'refund',
  -LEAST(r.amount, CASE WHEN oi.discount_funded_by = 'seller'
                        THEN oi.line_total - oi.discount_amount
                        ELSE oi.line_total END),
  r.currency_code,
  oi.id,
  r.order_id,
  r.id,
  COALESCE(r.settled_at, r.updated_at),
  'Buyer refunded (backfilled)',
  COALESCE(r.settled_at, r.updated_at)
FROM refunds r
JOIN return_requests rr ON rr.id = r.return_request_id
JOIN order_items oi ON oi.id = rr.order_item_id
WHERE r.status = 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM seller_ledger_entries e
     WHERE e.refund_id = r.id AND e.entry_type = 'refund'
  );
