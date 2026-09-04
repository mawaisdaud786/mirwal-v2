-- ============================================================================
-- 019 — Password reset
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- "Forgot Password?" was a link that reported the feature was not connected. It could not have
-- worked before: resetting a password by email needs email, and Mirwal had no mailer until
-- migration 017. It does now, so this is the missing half.
--
-- Only a SHA-256 hash of the token is stored, for the same reason `refresh_tokens` stores only
-- a hash: a database leak must not hand an attacker a working way into every account. The
-- token itself exists only in the email.
--
-- Tokens are short-lived and single-use, and every outstanding token for an account is
-- invalidated when one is used or when the password changes by any other route.
-- ============================================================================

CREATE TABLE password_resets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,

  -- SHA-256 of the token in the email. Not a password hash: this is 256 bits of server
  -- generated randomness with no dictionary to slow an attacker down against, and a reset
  -- endpoint that has to bcrypt every candidate is its own denial of service.
  token_hash  CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,

  -- Kept for the security page: a burst of resets against one account is worth seeing.
  requested_ip VARBINARY(16) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY ix_password_resets_user (user_id, used_at),
  KEY ix_password_resets_expiry (expires_at),

  CONSTRAINT fk_password_resets_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
