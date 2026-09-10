-- ============================================================================
-- 011 — Product reviews
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- `products.rating_average` / `rating_count` have existed since 002 and are displayed
-- everywhere in the app — star ratings on every card, "rated 4.4 by 56 buyers" in the AI
-- assistant, "Top Rated" sorting — but nothing ever wrote them except the seeder. They were
-- seed numbers presented to shoppers as real buyer ratings, with no review anywhere behind
-- them. 002's own comment already said they should be "derived from real reviews"; this is
-- the table that makes that true.
--
-- Verified-purchase only: a review row must reference the buyer's own delivered order_item.
-- That is enforced by the service (it looks the item up scoped to the reviewer) and backed
-- here by a unique key on order_item_id, so one delivered item yields at most one review and
-- ratings cannot be inflated by repeat submissions or by people who never bought the product.
-- ============================================================================

CREATE TABLE product_reviews (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  product_id     BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  -- The proof of purchase. NOT NULL on purpose: there is no path to an unverified review.
  order_item_id  BIGINT UNSIGNED NOT NULL,

  rating         TINYINT UNSIGNED NOT NULL,
  title          VARCHAR(150) NOT NULL DEFAULT '',
  body           TEXT NOT NULL,

  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_public (public_id),
  -- One review per purchased item: the anti-inflation rule, enforced by the database rather
  -- than only by application logic.
  UNIQUE KEY uq_reviews_order_item (order_item_id),

  -- The two read paths: a product's review list, and "have I reviewed this yet".
  KEY ix_reviews_product (product_id, created_at),
  KEY ix_reviews_user (user_id, created_at),

  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5),

  CONSTRAINT fk_reviews_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
