-- ============================================================================
-- 013 — Support tickets and messaging
-- Target: MariaDB 10.11.x / InnoDB
-- ============================================================================
--
-- The seller panel has Support (create request, my requests, request detail) and the admin
-- panel has Messaging and Complaints. None had storage: the seller "Create Ticket" form
-- showed a success toast and discarded the input, which is the worst version of this bug —
-- a seller believes they have reported a problem and nobody ever sees it.
--
-- One thread type covers both surfaces. A ticket is a conversation between one requester
-- (seller or customer) and Mirwal staff; admin "Messaging" is the same table read from the
-- other side. Splitting them would mean two schemas for one conversation and a reply that
-- has to be written into both.
-- ============================================================================

CREATE TABLE support_tickets (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Human-facing reference, e.g. "MW-T-000142". Shown to the requester and quoted back.
  reference     VARCHAR(24) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,

  -- Who opened it. `seller_id` is set when a seller opened it from the seller panel, which
  -- is what scopes the seller's "my requests" list; a customer ticket leaves it NULL.
  requester_id  BIGINT UNSIGNED NOT NULL,
  seller_id     BIGINT UNSIGNED NULL,

  subject       VARCHAR(200) NOT NULL,
  category      VARCHAR(60) NOT NULL DEFAULT 'general',
  priority      ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status        ENUM('open','pending','resolved','closed') NOT NULL DEFAULT 'open',

  -- The staff member who picked it up. NULL = unassigned queue.
  assigned_to   BIGINT UNSIGNED NULL,

  -- Denormalised for the list view, which otherwise needs a correlated subquery per row just
  -- to sort by "most recently active".
  last_message_at DATETIME(3) NULL,
  message_count   INT UNSIGNED NOT NULL DEFAULT 0,

  resolved_at   DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_public (public_id),
  UNIQUE KEY uq_tickets_reference (reference),
  KEY ix_tickets_requester (requester_id, created_at),
  KEY ix_tickets_seller (seller_id, status),
  KEY ix_tickets_queue (status, priority, last_message_at),
  KEY ix_tickets_assignee (assigned_to, status),

  CONSTRAINT fk_tickets_requester
    FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tickets_seller
    FOREIGN KEY (seller_id) REFERENCES sellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tickets_assignee
    FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE support_messages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id    BIGINT UNSIGNED NOT NULL,
  author_id    BIGINT UNSIGNED NULL,

  -- Which side wrote it. Stored rather than derived from the author's roles, because an
  -- author's roles can change later and that must not rewrite the history of a conversation.
  author_side  ENUM('requester','staff','system') NOT NULL,

  body         TEXT NOT NULL,
  -- Staff-only working notes. Never returned on the requester's read path.
  is_internal  TINYINT(1) NOT NULL DEFAULT 0,

  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY ix_messages_ticket (ticket_id, created_at),

  CONSTRAINT fk_messages_ticket
    FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_messages_author
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
