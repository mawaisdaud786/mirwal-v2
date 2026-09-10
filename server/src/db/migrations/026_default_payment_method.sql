ALTER TABLE users
  ADD COLUMN default_payment_method ENUM('cod', 'card', 'easypaisa', 'jazzcash') NOT NULL DEFAULT 'cod';