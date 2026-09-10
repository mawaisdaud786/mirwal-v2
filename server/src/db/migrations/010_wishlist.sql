-- ============================================================================
-- 010 — Wishlist
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- Every "save to wishlist" heart in the app (HomePage, ExplorePage, DealsPage,
-- ProductListingPage, SellerPages) was local component `useState` and nothing else: the
-- heart filled in, and the choice was gone on the next navigation. There was no wishlist
-- table, no endpoint, and the /wishlist account page had nothing to read. A control that
-- looks like it saves something and saves nothing is exactly the fake-UI problem the rest
-- of this project has been removing, so this makes it real.
--
-- Ownership: rows belong to `user_id`, so a wishlist is per-account, not per-browser. It
-- follows a shopper to another device and — the point of doing it server-side — it is gone
-- from the UI the moment they sign out, because reading it requires their own token.
-- ============================================================================

CREATE TABLE wishlist_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),

  -- One row per product per user. Saving twice is idempotent rather than a duplicate,
  -- which lets the API use INSERT ... ON DUPLICATE KEY UPDATE and stay safe under a
  -- double-click or a retried request.
  UNIQUE KEY uq_wishlist_user_product (user_id, product_id),

  -- The read path is always "this user's wishlist, newest first".
  KEY ix_wishlist_user (user_id, created_at),

  CONSTRAINT fk_wishlist_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- A deleted product should drop out of every wishlist rather than leave a dangling row
  -- that the read query has to defensively filter out forever.
  CONSTRAINT fk_wishlist_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
