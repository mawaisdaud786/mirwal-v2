-- ============================================================================
-- 002 — Catalog: sellers, categories, brands, products, variants, images, inventory
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- This migration resolves the model conflicts found in the Phase 0 audit (§5) and the
-- follow-up data-model analysis. The frontend currently carries two incompatible product
-- shapes:
--
--   src/data/mockData.js       (public) price "Rs. 202,000" string, rating "4.8 (1.2k)"
--                                       string, category as a label, no brand, no stock,
--                                       no SKU, NO SELLER.
--   src/data/sellerMockData.js (seller) price 8900 number, rating 4.5 + reviews 128,
--                                       sku, brand, stock, reserved, costPrice — but also
--                                       NO SELLER, because sellerStore is a singleton.
--
-- Resolution:
--   price          -> DECIMAL(12,2), never a string, never a float
--   rating         -> rating_average DECIMAL(3,2) + rating_count, derived from real reviews
--   category/brand -> foreign keys, not labels
--   seller         -> products.seller_id NOT NULL. This is the single most important
--                     column in the schema: it is what makes "Seller A must never reach
--                     Seller B's data" expressible at all. It did not exist anywhere in
--                     the frontend data model.
--
-- Inventory model: every product has at least one variant, including simple products which
-- get one default variant. Stock therefore always hangs off a variant and no code has to
-- branch on "does this product have variants?".
-- ============================================================================


-- ----------------------------------------------------------------------------
-- sellers
--
-- One row per seller account, currently combining the business and its storefront,
-- matching the frontend's single `sellerStore` object. Splitting seller -> many stores is
-- a later migration if multi-store is ever required; nothing here prevents it.
-- ----------------------------------------------------------------------------
CREATE TABLE sellers (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,

  -- Storefront identity. utf8mb4_bin so /seller/awais-store and /seller/Awais-Store are
  -- never treated as the same row.
  slug              VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  store_name        VARCHAR(150) NOT NULL,
  legal_name        VARCHAR(200) NOT NULL DEFAULT '',
  description       TEXT         NULL DEFAULT NULL,
  logo_url          VARCHAR(500) NULL DEFAULT NULL,
  banner_url        VARCHAR(500) NULL DEFAULT NULL,

  support_email     VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL,
  support_phone     VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,

  city              VARCHAR(100) NULL DEFAULT NULL,
  country_code      CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PK',
  currency_code     CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',

  -- Lifecycle: applications are reviewed before a store can publish products.
  status            ENUM('pending','approved','suspended','rejected','closed')
                      NOT NULL DEFAULT 'pending',
  approved_at       DATETIME(3) NULL DEFAULT NULL,
  approved_by       BIGINT UNSIGNED NULL DEFAULT NULL,
  suspended_reason  VARCHAR(255) NULL DEFAULT NULL,

  -- Denormalised aggregates, recomputed from reviews/orders. Never hand-written.
  rating_average    DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  rating_count      INT UNSIGNED NOT NULL DEFAULT 0,
  product_count     INT UNSIGNED NOT NULL DEFAULT 0,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3) NULL DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_sellers_public_id (public_id),
  UNIQUE KEY uq_sellers_slug (slug),
  UNIQUE KEY uq_sellers_user (user_id),
  KEY ix_sellers_status (status),
  KEY ix_sellers_approved_by (approved_by),

  CONSTRAINT fk_sellers_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sellers_approved_by
    FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ck_sellers_rating CHECK (rating_average BETWEEN 0 AND 5)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- categories — self-referencing tree; the frontend already shows subcategories.
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_id     BIGINT UNSIGNED NULL DEFAULT NULL,
  slug          VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name          VARCHAR(150) NOT NULL,
  description   TEXT         NULL DEFAULT NULL,
  image_url     VARCHAR(500) NULL DEFAULT NULL,
  position      INT UNSIGNED NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,

  -- Category landing pages are indexable, so they carry their own metadata.
  meta_title       VARCHAR(180) NULL DEFAULT NULL,
  meta_description VARCHAR(320) NULL DEFAULT NULL,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  KEY ix_categories_parent (parent_id, position),
  KEY ix_categories_active (is_active),

  CONSTRAINT fk_categories_parent
    FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- brands — a real entity at last. The frontend currently derives "brand" from
-- product.name.split(' ')[0], which produces filter values like "Premium", "New" and "La".
-- ----------------------------------------------------------------------------
CREATE TABLE brands (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name          VARCHAR(150) NOT NULL,
  description   TEXT         NULL DEFAULT NULL,
  logo_url      VARCHAR(500) NULL DEFAULT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_brands_slug (slug),
  KEY ix_brands_active (is_active)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- products
--
-- Indexes are driven by what ExplorePage actually queries today: category, brand, price
-- range, rating, availability, free text, plus four sort orders. See docs/DATABASE.md.
-- ----------------------------------------------------------------------------
CREATE TABLE products (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- The ownership column. Every seller-scoped query filters on this.
  seller_id         BIGINT UNSIGNED NOT NULL,
  category_id       BIGINT UNSIGNED NOT NULL,
  brand_id          BIGINT UNSIGNED NULL DEFAULT NULL,

  slug              VARCHAR(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name              VARCHAR(255) NOT NULL,
  -- The public model's `type` field ("Smartphone", "Laptop") — a human-facing subtitle,
  -- distinct from the category.
  subtitle          VARCHAR(150) NOT NULL DEFAULT '',
  description       MEDIUMTEXT   NULL DEFAULT NULL,
  highlights        JSON         NULL DEFAULT NULL,

  -- Money. DECIMAL, never float. compare_at_price is the "was" price; a discount exists
  -- only when compare_at_price > price, which makes the inverted-price bug found in the
  -- audit (iPhone listed at 234,000 "reduced from" 202,000) impossible to represent.
  currency_code     CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PKR',
  price             DECIMAL(12,2) NOT NULL,
  compare_at_price  DECIMAL(12,2) NULL DEFAULT NULL,
  cost_price        DECIMAL(12,2) NULL DEFAULT NULL,

  condition_type    ENUM('new','refurbished','used') NOT NULL DEFAULT 'new',

  status            ENUM('draft','pending_review','active','rejected','archived')
                      NOT NULL DEFAULT 'draft',
  rejected_reason   VARCHAR(255) NULL DEFAULT NULL,
  published_at      DATETIME(3)  NULL DEFAULT NULL,

  -- Derived from real reviews only. Never hand-written, never seeded as marketing copy.
  rating_average    DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  rating_count      INT UNSIGNED NOT NULL DEFAULT 0,

  meta_title        VARCHAR(180) NULL DEFAULT NULL,
  meta_description  VARCHAR(320) NULL DEFAULT NULL,

  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3) NULL DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_products_public_id (public_id),
  UNIQUE KEY uq_products_slug (slug),

  -- Seller panel: "my products", newest first.
  KEY ix_products_seller_status (seller_id, status, created_at),
  -- Category and brand landing pages, filtered to live products.
  KEY ix_products_category_status (category_id, status, price),
  KEY ix_products_brand_status (brand_id, status, price),
  -- Explore facets: price range and rating sorts over live products.
  KEY ix_products_status_price (status, price),
  KEY ix_products_status_rating (status, rating_average),
  KEY ix_products_status_published (status, published_at),

  -- Free-text search. FULLTEXT works on InnoDB in MariaDB 10.11 and is enough until the
  -- catalogue justifies a dedicated search engine.
  FULLTEXT KEY ft_products_text (name, subtitle, description),

  CONSTRAINT fk_products_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_products_brand
    FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT ck_products_price_positive CHECK (price >= 0),
  CONSTRAINT ck_products_compare_at CHECK (compare_at_price IS NULL OR compare_at_price > price),
  CONSTRAINT ck_products_rating CHECK (rating_average BETWEEN 0 AND 5),
  CONSTRAINT ck_products_highlights CHECK (highlights IS NULL OR JSON_VALID(highlights))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- product_images
-- ----------------------------------------------------------------------------
CREATE TABLE product_images (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  BIGINT UNSIGNED NOT NULL,
  url         VARCHAR(500) NOT NULL,
  -- Required for accessibility and image SEO; empty string means intentionally decorative.
  alt_text    VARCHAR(255) NOT NULL DEFAULT '',
  position    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  width       SMALLINT UNSIGNED NULL DEFAULT NULL,
  height      SMALLINT UNSIGNED NULL DEFAULT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_product_images_product (product_id, position),
  CONSTRAINT fk_product_images_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- product_variants
--
-- Every product has at least one variant. Simple products get a single default variant so
-- that pricing and stock are uniform and no caller has to branch on whether variants exist.
-- `options` holds the axis values ({"color":"Black","storage":"128GB"}) — JSON here is
-- appropriate because these are display-only. Anything filtered or faceted becomes a real
-- column or its own table instead.
-- ----------------------------------------------------------------------------
CREATE TABLE product_variants (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL,

  -- Seller-facing identifier: exact-match, case-sensitive, unique per seller.
  sku           VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name          VARCHAR(150) NOT NULL DEFAULT 'Default',
  options       JSON         NULL DEFAULT NULL,

  -- NULL means "inherit the product price".
  price         DECIMAL(12,2) NULL DEFAULT NULL,
  cost_price    DECIMAL(12,2) NULL DEFAULT NULL,

  barcode       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  weight_grams  INT UNSIGNED NULL DEFAULT NULL,

  is_default    TINYINT(1)  NOT NULL DEFAULT 0,
  is_active     TINYINT(1)  NOT NULL DEFAULT 1,
  position      SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_product_variants_product (product_id, position),
  KEY ix_product_variants_sku (sku),
  CONSTRAINT fk_product_variants_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ck_product_variants_price CHECK (price IS NULL OR price >= 0),
  CONSTRAINT ck_product_variants_options CHECK (options IS NULL OR JSON_VALID(options))
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- inventory
--
-- One row per variant. `reserved` covers stock committed to unpaid orders; sellable stock
-- is (quantity - reserved) and is never allowed to go negative, which is enforced here
-- rather than trusted from the application.
-- ----------------------------------------------------------------------------
CREATE TABLE inventory (
  variant_id        BIGINT UNSIGNED NOT NULL,
  quantity          INT NOT NULL DEFAULT 0,
  reserved          INT NOT NULL DEFAULT 0,
  low_stock_threshold INT NOT NULL DEFAULT 5,
  -- Whether the seller allows ordering past zero stock.
  allow_backorder   TINYINT(1) NOT NULL DEFAULT 0,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (variant_id),
  KEY ix_inventory_quantity (quantity),
  CONSTRAINT fk_inventory_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ck_inventory_quantity CHECK (quantity >= 0),
  CONSTRAINT ck_inventory_reserved CHECK (reserved >= 0 AND reserved <= quantity)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ----------------------------------------------------------------------------
-- A SKU must be unique within a seller, not globally — two different stores may both
-- legitimately use "SKU-001". MariaDB cannot express that across a join, so the seller is
-- denormalised onto the variant and kept correct by triggers.
-- ----------------------------------------------------------------------------
ALTER TABLE product_variants
  ADD COLUMN seller_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER product_id,
  ADD UNIQUE KEY uq_product_variants_seller_sku (seller_id, sku),
  ADD CONSTRAINT fk_product_variants_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE RESTRICT ON UPDATE CASCADE;

DELIMITER $$
CREATE TRIGGER trg_product_variants_seller_insert
BEFORE INSERT ON product_variants
FOR EACH ROW
BEGIN
  IF NEW.seller_id IS NULL THEN
    SET NEW.seller_id = (SELECT seller_id FROM products WHERE id = NEW.product_id);
  END IF;
END$$

CREATE TRIGGER trg_product_variants_seller_update
BEFORE UPDATE ON product_variants
FOR EACH ROW
BEGIN
  SET NEW.seller_id = (SELECT seller_id FROM products WHERE id = NEW.product_id);
END$$
DELIMITER ;
