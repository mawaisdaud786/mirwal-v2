-- ============================================================================
-- 022 — Store profile, policies, and public media
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- The seller panel has eight store-profile routes — information, business, branding, contact,
-- policies, hours, SEO, preview — and until now not one of them could save anything: the API
-- exposed `GET /seller/me/store` returning three fields and no PATCH at all. Some of what
-- those forms collect had nowhere to go even in principle, which is what this migration adds.
--
-- Two of these matter beyond letting a form save.
--
--   * `store_policies` is what a buyer is actually promised. A return window and a dispatch
--     time that live only in a seller's marketing copy cannot be enforced, cannot be shown on
--     a product page, and cannot be quoted back in a dispute. Storing them makes "the seller
--     said 7 days" a fact rather than a claim, and gives the return window a per-seller value
--     instead of one platform-wide constant.
--
--   * `media_assets` is a public upload path, and it is deliberately separate from the
--     seller-document store. Verification documents are CNICs and bank letters: they live
--     outside any web root and are readable only through an authenticated endpoint. A store
--     logo is the opposite — it must be served to anonymous visitors on every page. Putting
--     both in one directory would mean one misconfiguration exposes identity documents to the
--     internet, so they never share a root, a table, or a code path.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Store presentation
-- ---------------------------------------------------------------------------
--
-- Store pages are indexable, so they carry their own metadata for the same reason categories
-- have since migration 002.
ALTER TABLE sellers
  ADD COLUMN meta_title       VARCHAR(180) NULL AFTER description,
  ADD COLUMN meta_description VARCHAR(320) NULL AFTER meta_title,
  -- Free-text "about the store", distinct from the short `description` used on cards.
  ADD COLUMN about            TEXT NULL AFTER meta_description,
  -- Opening hours as a JSON object keyed by weekday. JSON is right here because nothing is
  -- ever filtered or reported on by it — it is display-only, exactly like variant options.
  ADD COLUMN business_hours   JSON NULL AFTER about,
  ADD CONSTRAINT ck_sellers_hours CHECK (business_hours IS NULL OR JSON_VALID(business_hours));


-- ---------------------------------------------------------------------------
-- store_policies
-- ---------------------------------------------------------------------------
--
-- One row per seller, created on demand. Every numeric field falls back to the platform
-- setting when NULL, so a seller who never opens the policies page behaves exactly as before
-- this table existed — a default expressed as NULL is honest about the fact that the seller
-- has not chosen, which a copied-in default value is not.
CREATE TABLE store_policies (
  seller_id            BIGINT UNSIGNED NOT NULL,

  -- NULL = use the platform's orders.return_window_days. A seller may offer a longer window
  -- than Mirwal requires; the service clamps a shorter one up to the platform minimum, so
  -- this can never be used to offer buyers less protection than Mirwal promises.
  return_window_days   SMALLINT UNSIGNED NULL,
  returns_accepted     TINYINT(1) NOT NULL DEFAULT 1,
  -- Who pays return carriage when the seller is not at fault. When they are at fault the
  -- platform rule applies regardless of what is set here.
  return_shipping_paid_by ENUM('buyer','seller') NOT NULL DEFAULT 'buyer',
  exchange_offered     TINYINT(1) NOT NULL DEFAULT 0,

  -- The dispatch promise shown to buyers and measured against `order_items.shipped_at`.
  dispatch_days        SMALLINT UNSIGNED NULL,
  -- Free-text, rendered as plain text and never as markup.
  warranty_text        VARCHAR(2000) NULL,
  returns_text         VARCHAR(2000) NULL,
  shipping_text        VARCHAR(2000) NULL,

  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (seller_id),
  CONSTRAINT fk_store_policies_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- A 400-day return window is a typo, not an offer.
  CONSTRAINT ck_store_policies_window
    CHECK (return_window_days IS NULL OR return_window_days BETWEEN 0 AND 365),
  CONSTRAINT ck_store_policies_dispatch
    CHECK (dispatch_days IS NULL OR dispatch_days BETWEEN 0 AND 60)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ---------------------------------------------------------------------------
-- media_assets
-- ---------------------------------------------------------------------------
--
-- Public images: product photos, store logos and banners, category art.
--
-- Sellers could not upload a product image at all — `product_images` is a table with no write
-- path outside admin JSON — so a seller literally could not list a product with a photograph.
--
-- Every row records who uploaded it and what it is attached to, so an orphaned file is
-- findable and a seller's entire media can be removed with their account. The checksum makes
-- a re-upload of the same bytes detectable, which is both a storage saving and the hook a
-- duplicate-image check later needs.
CREATE TABLE media_assets (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- Who owns the bytes. NULL owner = uploaded by staff (category art, platform banners).
  seller_id     BIGINT UNSIGNED NULL,
  uploaded_by   BIGINT UNSIGNED NULL,

  -- What it is for. Constrains where a given file may legitimately be referenced from.
  purpose       ENUM('product','store_logo','store_banner','category','banner','other')
                  NOT NULL DEFAULT 'other',

  original_name VARCHAR(255) NOT NULL,
  -- Generated, never derived from the upload — the same rule the document store follows.
  stored_name   VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- The path the frontend uses, e.g. /media/ab12….webp. Relative on purpose: the store
  -- service refuses any absolute URL, so a logo can never point at a third-party host.
  url           VARCHAR(500) NOT NULL,

  mime_type     VARCHAR(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  width         SMALLINT UNSIGNED NULL,
  height        SMALLINT UNSIGNED NULL,
  checksum      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_media_assets_public (public_id),
  UNIQUE KEY uq_media_assets_stored (stored_name),
  KEY ix_media_assets_seller (seller_id, purpose, created_at),
  KEY ix_media_assets_checksum (checksum),

  CONSTRAINT fk_media_assets_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_media_assets_uploader
    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- Link product images back to the asset they came from, so deleting an asset can find every
-- listing that used it rather than leaving a broken image behind.
ALTER TABLE product_images
  ADD COLUMN media_asset_id BIGINT UNSIGNED NULL AFTER product_id,
  ADD KEY ix_product_images_asset (media_asset_id),
  ADD CONSTRAINT fk_product_images_asset
    FOREIGN KEY (media_asset_id) REFERENCES media_assets (id) ON DELETE SET NULL ON UPDATE CASCADE;
