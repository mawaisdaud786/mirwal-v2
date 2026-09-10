-- Persist customer profile details used by the storefront account page.
ALTER TABLE users
  ADD COLUMN city VARCHAR(80) NULL DEFAULT NULL,
  ADD COLUMN country VARCHAR(80) NULL DEFAULT NULL,
  ADD COLUMN preferred_language VARCHAR(40) NULL DEFAULT NULL,
  ADD COLUMN default_address VARCHAR(500) NULL DEFAULT NULL;
