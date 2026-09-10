-- ============================================================================
-- MIRWAL — Database environment verification
-- ============================================================================
--
-- PURPOSE
--   Capture exactly what the target MariaDB server is and what already exists
--   on it, so the Phase 0.5 schema is designed against measured facts rather
--   than assumptions.
--
-- SAFETY
--   This script is STRICTLY READ-ONLY. Every statement is a SELECT, SHOW or a
--   query against INFORMATION_SCHEMA. There is no CREATE, ALTER, DROP, INSERT,
--   UPDATE, DELETE, TRUNCATE or GRANT anywhere in this file. It cannot modify,
--   lock or damage the production database.
--
-- HOW TO RUN (recommended — you never share credentials with anyone)
--   1. cPanel -> phpMyAdmin
--   2. Select the Mirwal database in the left sidebar (important: several
--      queries below use DATABASE(), which is NULL if no database is selected)
--   3. SQL tab -> paste this file -> Go
--   4. Export or copy each result grid
--
--   phpMyAdmin runs multi-statement scripts and shows one result grid per
--   SELECT. If your version only returns the last grid, run the sections
--   one at a time — they are numbered and independent.
--
-- WHAT TO SEND BACK
--   Sections 1, 2, 3, 6 and 7 are the ones that change design decisions.
--   Sections 4, 5, 8 and 9 describe anything that already exists.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. SERVER IDENTITY
--    Confirms the reported 10.11.16 and tells us which features are available.
--    Feature gates that matter for Mirwal:
--      >= 10.2  CHECK constraints, window functions, CTEs
--      >= 10.5  INSERT ... RETURNING
--      >= 10.6  SELECT ... SKIP LOCKED (InnoDB) — needed for job queues
--      >= 10.7  native UUID column type
--      >= 10.8  descending indexes actually stored descending
-- ----------------------------------------------------------------------------
SELECT
  VERSION()                        AS server_version,
  @@version_comment                AS version_comment,
  @@innodb_version                 AS innodb_version,
  @@hostname                       AS hostname,
  @@port                           AS port,
  DATABASE()                       AS current_database,
  CURRENT_USER()                   AS current_user_account,
  USER()                           AS connected_as,
  NOW()                            AS server_time,
  @@system_time_zone               AS system_time_zone,
  @@time_zone                      AS session_time_zone;


-- ----------------------------------------------------------------------------
-- 2. CHARACTER SET AND COLLATION
--    You reported the server default as latin1/cp1252. Mirwal must not inherit
--    that: latin1 cannot store Urdu, Arabic or emoji at all, and a latin1
--    column silently mangles them rather than erroring.
--
--    What we need to see:
--      character_set_database / collation_database -> should become utf8mb4
--      character_set_server                        -> may stay latin1; we
--                                                     override per-database
--    Note: on MariaDB 10.11 the default collation for utf8mb4 is still
--    utf8mb4_general_ci. The newer utf8mb4_uca1400_* collations arrived in
--    11.5+, so Mirwal must name its collation explicitly rather than rely on
--    the server default.
-- ----------------------------------------------------------------------------
SELECT
  @@character_set_server           AS charset_server,
  @@collation_server               AS collation_server,
  @@character_set_database         AS charset_database,
  @@collation_database             AS collation_database,
  @@character_set_client           AS charset_client,
  @@character_set_connection       AS charset_connection,
  @@character_set_results          AS charset_results,
  @@character_set_filesystem       AS charset_filesystem;

-- Is utf8mb4 available, and which collations can we choose from?
SELECT
  COLLATION_NAME,
  CHARACTER_SET_NAME,
  IS_DEFAULT,
  IS_COMPILED,
  SORTLEN
FROM information_schema.COLLATIONS
WHERE CHARACTER_SET_NAME = 'utf8mb4'
ORDER BY IS_DEFAULT DESC, COLLATION_NAME;


-- ----------------------------------------------------------------------------
-- 3. INNODB AND DDL SETTINGS THAT AFFECT THE SCHEMA
--
--    innodb_default_row_format  DYNAMIC is required for long utf8mb4 indexes.
--                               A utf8mb4 VARCHAR(255) index is 1020 bytes,
--                               which overflows the 767-byte limit of the old
--                               COMPACT/REDUNDANT formats.
--    lower_case_table_names     MUST be compared against the dev machine.
--                               Linux cPanel is normally 0 (case-sensitive);
--                               Windows dev is 1 or 2. A mismatch produces
--                               "table doesn't exist" bugs that only appear in
--                               production.
--    sql_mode                   STRICT_TRANS_TABLES determines whether bad data
--                               errors or is silently truncated.
--    max_allowed_packet         Caps product description / image payload size.
-- ----------------------------------------------------------------------------
SELECT
  @@default_storage_engine         AS default_storage_engine,
  @@innodb_default_row_format      AS innodb_default_row_format,
  @@innodb_file_per_table          AS innodb_file_per_table,
  @@innodb_page_size               AS innodb_page_size,
  @@innodb_strict_mode             AS innodb_strict_mode,
  @@lower_case_table_names         AS lower_case_table_names,
  @@sql_mode                       AS sql_mode,
  @@max_allowed_packet             AS max_allowed_packet,
  @@wait_timeout                   AS wait_timeout,
  @@max_connections                AS max_connections,
  @@transaction_isolation          AS transaction_isolation,
  @@autocommit                     AS autocommit;

-- Confirm InnoDB is present and enabled as a transactional engine.
SELECT ENGINE, SUPPORT, TRANSACTIONS, XA, SAVEPOINTS
FROM information_schema.ENGINES
ORDER BY (SUPPORT = 'DEFAULT') DESC, ENGINE;


-- ----------------------------------------------------------------------------
-- 4. DATABASES VISIBLE TO THIS ACCOUNT, AND THEIR CHARACTER SETS
--    On cPanel the account normally sees only its own databases.
--    Look for any Mirwal database that already exists and what charset it has.
-- ----------------------------------------------------------------------------
SELECT
  SCHEMA_NAME                      AS database_name,
  DEFAULT_CHARACTER_SET_NAME       AS charset,
  DEFAULT_COLLATION_NAME           AS collation
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
ORDER BY SCHEMA_NAME;


-- ----------------------------------------------------------------------------
-- 5. EXISTING TABLES IN THE CURRENT DATABASE
--    Establishes whether we are working on an empty database or one that
--    already holds data we must not destroy.
-- ----------------------------------------------------------------------------
SELECT
  TABLE_NAME,
  ENGINE,
  ROW_FORMAT,
  TABLE_COLLATION,
  TABLE_ROWS                       AS approx_rows,
  ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS size_mb,
  AUTO_INCREMENT,
  CREATE_TIME,
  UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;


-- ----------------------------------------------------------------------------
-- 6. COLUMNS THAT ARE NOT utf8mb4
--    This is the single most important result for the charset question.
--    Any row returned here is a column that cannot correctly store Urdu,
--    Arabic or emoji. An empty result means the database is already clean.
-- ----------------------------------------------------------------------------
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_SET_NAME,
  COLLATION_NAME,
  CHARACTER_MAXIMUM_LENGTH
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND CHARACTER_SET_NAME IS NOT NULL
  AND CHARACTER_SET_NAME <> 'utf8mb4'
ORDER BY TABLE_NAME, ORDINAL_POSITION;


-- ----------------------------------------------------------------------------
-- 7. PRIVILEGES OF THE CONNECTING ACCOUNT
--    Determines what the migration runner is allowed to do. Migrations need at
--    minimum: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP,
--    REFERENCES (for foreign keys) and ideally CREATE VIEW / TRIGGER.
--    cPanel accounts sometimes lack REFERENCES, which silently prevents
--    foreign keys from being created.
-- ----------------------------------------------------------------------------
SHOW GRANTS FOR CURRENT_USER();


-- ----------------------------------------------------------------------------
-- 8. EXISTING FOREIGN KEYS
--    Empty result on an existing schema is itself a finding: it means
--    referential integrity is not being enforced at the database level.
-- ----------------------------------------------------------------------------
SELECT
  rc.CONSTRAINT_NAME,
  rc.TABLE_NAME,
  kcu.COLUMN_NAME,
  rc.REFERENCED_TABLE_NAME,
  kcu.REFERENCED_COLUMN_NAME,
  rc.UPDATE_RULE,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON  kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME   = rc.CONSTRAINT_NAME
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
ORDER BY rc.TABLE_NAME, rc.CONSTRAINT_NAME;


-- ----------------------------------------------------------------------------
-- 9. EXISTING INDEXES AND UNIQUE CONSTRAINTS
-- ----------------------------------------------------------------------------
SELECT
  TABLE_NAME,
  INDEX_NAME,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_order,
  IF(MAX(NON_UNIQUE) = 0, 'UNIQUE', 'INDEX')      AS uniqueness,
  MAX(INDEX_TYPE)                                 AS index_type
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;


-- ----------------------------------------------------------------------------
-- 10. STORAGE HEADROOM
--     Shared cPanel hosting often enforces a disk quota well below what a
--     product catalogue with images will need.
-- ----------------------------------------------------------------------------
SELECT
  TABLE_SCHEMA                                                   AS database_name,
  COUNT(*)                                                       AS table_count,
  ROUND(SUM(DATA_LENGTH) / 1024 / 1024, 2)                       AS data_mb,
  ROUND(SUM(INDEX_LENGTH) / 1024 / 1024, 2)                      AS index_mb,
  ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2)        AS total_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
GROUP BY TABLE_SCHEMA
ORDER BY total_mb DESC;

-- ============================================================================
-- End of verification script. Nothing above modifies any data.
-- ============================================================================
