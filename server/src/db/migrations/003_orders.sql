-- ============================================================================
-- 003 — Orders: checkout, order items, seller fulfillment
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Cart is deliberately NOT a server-side table. It stays what it already is on the
-- frontend — an in-memory list of {productId, variantId, quantity} — because there is no
-- guest-cart-merge-on-login problem worth the schema until Mirwal needs one. The server's
-- job starts at checkout: it re-validates every price and every unit of stock itself and
-- never trusts a client-supplied total, then commits an immutable order.
--
-- Multi-seller orders: a single checkout can contain products from more than one seller.
-- `orders` is the one checkout event (one shipping address, one placed_at); `order_items`
-- carries its own `seller_id` so `WHERE seller_id = ?` is exactly how a seller's own
-- fulfillment queue is scoped, the same ownership pattern as `products.seller_id`.
--
-- Payment: COD only. Mirwal has no payment gateway integration, so `payment_method` has a
-- single value on purpose — adding 'jazzcash'/'easypaisa'/'card' is a later migration once
-- a real gateway exists, not a value the checkout form should be able to select today.
--
-- Shipping address is embedded on `orders` rather than normalised into its own table:
-- there is no "saved addresses" feature yet, and an order is a snapshot of where it shipped
-- regardless of what the buyer's address book looks like later. Adding a real address book
-- can reference these same columns without migrating existing orders.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id             CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Human-facing, e.g. "MW-100042". Assigned once after insert, from the auto-increment id.
  order_number          VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  buyer_id              BIGINT UNSIGNED NOT NULL,

  currency_code         CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',
  subtotal              DECIMAL(12,2) NOT NULL,
  shipping_fee          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total                 DECIMAL(12,2) NOT NULL,

  status                ENUM('pending','confirmed','processing','shipped','delivered','cancelled')
                          NOT NULL DEFAULT 'pending',
  cancelled_reason      VARCHAR(255) NULL DEFAULT NULL,

  payment_method        ENUM('cod') NOT NULL DEFAULT 'cod',
  payment_status        ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  paid_at               DATETIME(3) NULL DEFAULT NULL,

  shipping_full_name    VARCHAR(150) NOT NULL,
  shipping_phone        VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  shipping_line1        VARCHAR(255) NOT NULL,
  shipping_line2        VARCHAR(255) NOT NULL DEFAULT '',
  shipping_city         VARCHAR(100) NOT NULL,
  shipping_region       VARCHAR(100) NOT NULL DEFAULT '',
  shipping_postal_code  VARCHAR(20)  NOT NULL DEFAULT '',
  shipping_country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PK',

  notes                 VARCHAR(500) NOT NULL DEFAULT '',

  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_public_id (public_id),
  UNIQUE KEY uq_orders_number (order_number),
  KEY ix_orders_buyer (buyer_id, created_at),
  KEY ix_orders_status (status),

  CONSTRAINT fk_orders_buyer
    FOREIGN KEY (buyer_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_orders_totals CHECK (subtotal >= 0 AND shipping_fee >= 0 AND total >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- order_items
--
-- Product/variant name, SKU and price are snapshotted at purchase time. A seller renaming
-- or repricing a product afterward must never rewrite what a past order says was bought.
-- ----------------------------------------------------------------------------
CREATE TABLE order_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,

  -- The ownership column for seller-scoped fulfillment queries, same role as
  -- products.seller_id.
  seller_id       BIGINT UNSIGNED NOT NULL,
  product_id      BIGINT UNSIGNED NOT NULL,
  variant_id      BIGINT UNSIGNED NOT NULL,

  product_name    VARCHAR(255) NOT NULL,
  variant_name    VARCHAR(150) NOT NULL DEFAULT '',
  sku             VARCHAR(80)  NOT NULL,
  unit_price      DECIMAL(12,2) NOT NULL,
  quantity        INT UNSIGNED NOT NULL,
  line_total      DECIMAL(12,2) NOT NULL,

  -- Fulfilled per seller: two sellers in the same order progress independently.
  status          ENUM('pending','confirmed','processing','shipped','delivered','cancelled')
                    NOT NULL DEFAULT 'pending',

  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_order_items_order (order_id),
  KEY ix_order_items_seller_status (seller_id, status, created_at),
  KEY ix_order_items_product (product_id),

  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_order_items_quantity CHECK (quantity > 0),
  CONSTRAINT ck_order_items_prices CHECK (unit_price >= 0 AND line_total >= 0)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- Permissions: order.read / order.write, scoped the same way catalog.product.* is —
-- holding order.write as a seller never means "any order", only "order items of my store",
-- enforced in the query layer via seller_id, not by this permission grant.
-- ----------------------------------------------------------------------------
INSERT INTO permissions (slug, area, description) VALUES
  ('order.read',  'orders', 'View orders'),
  ('order.write', 'orders', 'Update order fulfillment status');

-- customer: still no management permissions. Reading/creating their own orders is not a
-- management capability — it is scoped to buyer_id = self by construction, the same reason
-- GET /seller/me/store needs no permission check at all.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'seller' AND p.slug IN ('order.read', 'order.write');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'admin' AND p.slug IN ('order.read', 'order.write');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'super_admin' AND p.slug IN ('order.read', 'order.write');
