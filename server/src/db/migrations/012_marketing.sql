-- ============================================================================
-- 012 — Marketing: coupons, promotions, campaigns, flash sales, banners
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- The admin panel has had Coupons, Promotions, Campaigns, Flash Sales and Banners pages
-- since the first build, and the seller panel has its own Marketing section. None of them
-- had a table behind them — every figure ("2,847 redemptions", "18% conversion") was
-- invented, and "Create Coupon" wrote nothing anywhere. This is the storage those surfaces
-- need in order to be honest.
--
-- Design notes:
--
--   * One `promotions` table covers promotions, campaigns and flash sales. They differ by
--     `kind` and by whether a window is set, not by structure — three near-identical tables
--     would drift apart and force three copies of the same "is it live right now" logic.
--
--   * Coupons are separate because they behave differently: a shopper types a code, it is
--     validated against per-code and per-customer limits, and each use is recorded. That
--     redemption ledger is what makes usage counts real rather than a number someone typed.
--
--   * `seller_id` is nullable throughout. NULL means Mirwal-wide (admin-owned); a value means
--     the seller owns it and may only manage their own. This is what lets the same tables
--     serve both the admin panel and the seller Marketing section without a second schema.
--
--   * Money is DECIMAL(12,2) like everywhere else, never float. Percentages are stored in
--     basis points (500 = 5.00%) so a discount is exact integer arithmetic.
-- ============================================================================

CREATE TABLE coupons (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- The typed code. ascii + a case-insensitive collation so "SAVE20" and "save20" are the
  -- same coupon and the unique key actually prevents a confusing duplicate.
  code                VARCHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name                VARCHAR(150) NOT NULL,
  description         VARCHAR(500) NULL,

  -- NULL = a Mirwal-wide coupon. Set = owned by that seller and only valid on their items.
  seller_id           BIGINT UNSIGNED NULL,

  discount_type       ENUM('percentage','fixed','free_shipping') NOT NULL,
  -- Basis points for percentage (500 = 5%), unused for the other types.
  discount_bps        SMALLINT UNSIGNED NULL,
  -- Absolute amount for `fixed`, unused otherwise.
  discount_amount     DECIMAL(12,2) NULL,
  currency_code       CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',
  -- Stops "50% off" turning into an unbounded loss on an expensive basket.
  max_discount_amount DECIMAL(12,2) NULL,
  min_order_amount    DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  -- NULL = unlimited. `usage_count` is maintained from the redemption ledger below.
  usage_limit         INT UNSIGNED NULL,
  usage_limit_per_user INT UNSIGNED NULL,
  usage_count         INT UNSIGNED NOT NULL DEFAULT 0,

  starts_at           DATETIME(3) NULL,
  ends_at             DATETIME(3) NULL,
  status              ENUM('draft','active','paused','expired') NOT NULL DEFAULT 'draft',

  created_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at          DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_coupons_public (public_id),
  UNIQUE KEY uq_coupons_code (code),
  KEY ix_coupons_status (status, ends_at),
  KEY ix_coupons_seller (seller_id, status),

  -- Each discount type must carry exactly the value it needs, so a "percentage" coupon can
  -- never exist with a NULL percentage and silently discount nothing at checkout.
  CONSTRAINT ck_coupons_shape CHECK (
    (discount_type = 'percentage'    AND discount_bps IS NOT NULL AND discount_bps BETWEEN 1 AND 10000)
    OR (discount_type = 'fixed'      AND discount_amount IS NOT NULL AND discount_amount > 0)
    OR (discount_type = 'free_shipping')
  ),
  CONSTRAINT ck_coupons_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),

  CONSTRAINT fk_coupons_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_coupons_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Every individual use of a coupon. This is the source of truth for usage counts and for
-- per-customer limits — without it "used 2,847 times" is just a number someone edited.
CREATE TABLE coupon_redemptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coupon_id       BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  order_id        BIGINT UNSIGNED NULL,
  discount_amount DECIMAL(12,2) NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  -- One redemption per order: re-submitting a checkout must not double-count a coupon.
  UNIQUE KEY uq_redemption_order (coupon_id, order_id),
  KEY ix_redemption_user (coupon_id, user_id),
  KEY ix_redemption_created (created_at),

  CONSTRAINT fk_redemption_coupon
    FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_redemption_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_redemption_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Promotions, campaigns and flash sales. One table, distinguished by `kind`.
CREATE TABLE promotions (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  kind                ENUM('promotion','campaign','flash_sale') NOT NULL DEFAULT 'promotion',
  slug                VARCHAR(140) NOT NULL,
  name                VARCHAR(150) NOT NULL,
  description         TEXT NULL,

  seller_id           BIGINT UNSIGNED NULL,

  discount_type       ENUM('percentage','fixed','none') NOT NULL DEFAULT 'percentage',
  discount_bps        SMALLINT UNSIGNED NULL,
  discount_amount     DECIMAL(12,2) NULL,
  currency_code       CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',

  -- A flash sale without a window is a contradiction; the service requires one for that kind.
  starts_at           DATETIME(3) NULL,
  ends_at             DATETIME(3) NULL,
  status              ENUM('draft','scheduled','active','paused','ended') NOT NULL DEFAULT 'draft',

  banner_image_url    VARCHAR(500) NULL,
  -- Ordering on the storefront when several are live at once.
  priority            SMALLINT NOT NULL DEFAULT 0,

  created_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at          DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_promotions_public (public_id),
  UNIQUE KEY uq_promotions_slug (slug),
  KEY ix_promotions_kind_status (kind, status, starts_at),
  KEY ix_promotions_seller (seller_id, status),
  KEY ix_promotions_window (status, starts_at, ends_at),

  CONSTRAINT ck_promotions_shape CHECK (
    (discount_type = 'percentage' AND discount_bps IS NOT NULL AND discount_bps BETWEEN 1 AND 10000)
    OR (discount_type = 'fixed'   AND discount_amount IS NOT NULL AND discount_amount > 0)
    OR (discount_type = 'none')
  ),
  CONSTRAINT ck_promotions_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),

  CONSTRAINT fk_promotions_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_promotions_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Which products a promotion applies to. No rows = the whole catalogue (or the whole store,
-- for a seller-owned promotion), which is the common case for a sitewide sale.
CREATE TABLE promotion_products (
  promotion_id BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (promotion_id, product_id),
  KEY ix_promotion_products_product (product_id),

  CONSTRAINT fk_promotion_products_promotion
    FOREIGN KEY (promotion_id) REFERENCES promotions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_promotion_products_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Merchandising banners on the storefront. Admin-owned only: a seller placing a banner on
-- the homepage is a different (unbuilt) product decision, so there is no seller_id here.
CREATE TABLE banners (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  title          VARCHAR(150) NOT NULL,
  subtitle       VARCHAR(255) NULL,
  image_url      VARCHAR(500) NOT NULL,
  -- Where the banner sends the shopper. Relative paths only, enforced by the service — an
  -- absolute URL here would let a banner redirect Mirwal traffic off-site.
  link_url       VARCHAR(500) NULL,
  -- Named slot on the storefront, e.g. 'home_hero', 'home_strip', 'category_top'.
  placement      VARCHAR(60) NOT NULL DEFAULT 'home_hero',
  position       SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  starts_at      DATETIME(3) NULL,
  ends_at        DATETIME(3) NULL,
  status         ENUM('draft','active','paused','expired') NOT NULL DEFAULT 'draft',

  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_banners_public (public_id),
  KEY ix_banners_placement (placement, status, position),

  CONSTRAINT ck_banners_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT fk_banners_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
