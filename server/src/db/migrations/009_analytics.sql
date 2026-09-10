-- ============================================================================
-- 009 — Analytics
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- AdminAnalytics.jsx has, since it was first built, rendered entirely hard-coded numbers
-- (a fixed "Rs. 12,84,50,000" GMV, "85,421" orders, a fake top-products table, fake traffic
-- sources and device breakdown that would require a web-analytics/session-tracking pipeline
-- Mirwal does not have) as if they were live platform metrics. This migration adds nothing
-- structural — no new tables — because every real metric the dashboard can honestly show
-- (GMV, order counts, revenue by category, top products, refunds, an hour-of-day order
-- heatmap) is already derivable from `orders`/`order_items`/`refunds`. What was missing was
-- a permission to gate a real endpoint. The traffic/device/pageview panels have no backing
-- data anywhere in this schema and are removed from the frontend rather than left fake.
-- ============================================================================

INSERT INTO permissions (slug, area, description) VALUES
  ('analytics.read', 'system', 'View platform analytics');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'admin' AND p.slug = 'analytics.read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.slug = 'super_admin' AND p.slug = 'analytics.read';
