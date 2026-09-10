#!/usr/bin/env node
/**
 * Migration runner for MariaDB 10.11.x.
 *
 * Design constraints (docs/DATABASE.md §4):
 *  - Forward-only, numbered .sql files applied in filename order.
 *  - Every applied migration is recorded in `schema_migrations` with a checksum, so an
 *    edited-after-apply migration is detected rather than silently diverging.
 *  - MariaDB has NO transactional DDL. A migration that fails partway leaves partial DDL
 *    behind and cannot be rolled back automatically. Each migration therefore performs one
 *    logical change, and the runner stops immediately on failure rather than continuing.
 *  - Statements are split on `;` at line ends, with $$ ... $$ blocks respected so routines
 *    and triggers survive intact.
 *
 * Commands:
 *   node src/db/migrate.js up       apply pending migrations
 *   node src/db/migrate.js status   show applied / pending
 *   node src/db/migrate.js fresh    DROP the database and re-apply everything (DEV ONLY)
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations')

const checksum = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)

/** Connect without selecting a database, so we can create it if missing. */
async function serverConnection() {
  return mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: false,
    charset: 'utf8mb4_unicode_520_ci',
  })
}

async function dbConnection() {
  return mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: false,
    charset: 'utf8mb4_unicode_520_ci',
    dateStrings: true,
  })
}

/**
 * Ensure the database exists AND is utf8mb4.
 *
 * cPanel's database-creation UI creates databases with the *server* default, which on the
 * Mirwal production host is latin1/cp1252. Tables then inherit latin1 and silently corrupt
 * non-Latin text. ALTER DATABASE fixes the default for tables created afterwards; it does
 * not convert existing tables, which is deliberate — converting live tables is a separate,
 * reviewed migration, never an implicit side effect of running the runner.
 */
async function ensureDatabase() {
  const connection = await serverConnection()
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`,
    )
    const [[row]] = await connection.query(
      `SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co
         FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [env.db.database],
    )
    if (row.cs !== 'utf8mb4') {
      console.warn(`  ! database charset is "${row.cs}" — altering to utf8mb4`)
      await connection.query(
        `ALTER DATABASE \`${env.db.database}\`
           CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`,
      )
    }
  } finally {
    await connection.end()
  }
}

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename    VARCHAR(191) NOT NULL,
      checksum    CHAR(16)     NOT NULL,
      applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_filename (filename)
    ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
      DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci
  `)
}

async function migrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR)
  return entries.filter((name) => name.endsWith('.sql')).sort()
}

/**
 * Split a migration into individual statements.
 * Handles `--` line comments and $$-delimited blocks (triggers, procedures).
 */
function splitStatements(sql) {
  const statements = []
  let current = ''
  let inDollarBlock = false

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const withoutComment = line.replace(/^\s*--.*$/, '')
    if (withoutComment.trim() === '' && current.trim() === '') continue

    if (/^\s*DELIMITER\s+\$\$/i.test(line)) { inDollarBlock = true; continue }
    if (/^\s*DELIMITER\s+;/i.test(line)) { inDollarBlock = false; continue }

    current += withoutComment + '\n'

    if (inDollarBlock) {
      if (/\$\$\s*$/.test(withoutComment)) {
        statements.push(current.replace(/\$\$\s*$/, '').trim())
        current = ''
      }
    } else if (/;\s*$/.test(withoutComment)) {
      statements.push(current.replace(/;\s*$/, '').trim())
      current = ''
    }
  }

  if (current.trim()) statements.push(current.trim())
  return statements.filter(Boolean)
}

async function applied(connection) {
  const [rows] = await connection.query('SELECT filename, checksum FROM schema_migrations ORDER BY filename')
  return new Map(rows.map((row) => [row.filename, row.checksum]))
}

async function up() {
  await ensureDatabase()
  const connection = await dbConnection()
  try {
    await ensureMigrationsTable(connection)
    const done = await applied(connection)
    const files = await migrationFiles()

    // Detect a migration that was edited after being applied — this silently diverges
    // environments and is worth failing loudly over.
    for (const file of files) {
      if (!done.has(file)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      if (done.get(file) !== checksum(sql)) {
        throw new Error(
          `Migration ${file} has changed since it was applied ` +
          `(recorded ${done.get(file)}, now ${checksum(file ? sql : '')}). ` +
          `Applied migrations are immutable — add a new migration instead.`,
        )
      }
    }

    const pending = files.filter((file) => !done.has(file))
    if (pending.length === 0) {
      console.log('  nothing to do — schema is up to date')
      return
    }

    for (const file of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      const statements = splitStatements(sql)
      const started = Date.now()
      process.stdout.write(`  ${file} (${statements.length} statements) ... `)

      for (const [index, statement] of statements.entries()) {
        try {
          await connection.query(statement)
        } catch (error) {
          console.log('FAILED')
          console.error(`\n  Statement ${index + 1} of ${file} failed:`)
          console.error(`  ${statement.split('\n')[0].slice(0, 120)}`)
          console.error(`  ${error.code}: ${error.sqlMessage ?? error.message}\n`)
          console.error('  MariaDB has no transactional DDL, so earlier statements in this')
          console.error('  migration remain applied. Inspect the schema before re-running.\n')
          throw error
        }
      }

      const duration = Date.now() - started
      await connection.query(
        'INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES (?, ?, ?)',
        [file, checksum(sql), duration],
      )
      console.log(`ok (${duration}ms)`)
    }
  } finally {
    await connection.end()
  }
}

async function status() {
  await ensureDatabase()
  const connection = await dbConnection()
  try {
    await ensureMigrationsTable(connection)
    const done = await applied(connection)
    const files = await migrationFiles()
    console.log(`  database: ${env.db.database} @ ${env.db.host}:${env.db.port}\n`)
    for (const file of files) {
      console.log(`  ${done.has(file) ? '[applied]' : '[pending]'}  ${file}`)
    }
    const orphaned = [...done.keys()].filter((file) => !files.includes(file))
    for (const file of orphaned) console.log(`  [MISSING FILE, but recorded as applied]  ${file}`)
    console.log(`\n  ${done.size} applied, ${files.length - done.size} pending`)
  } finally {
    await connection.end()
  }
}

async function fresh() {
  if (env.isProduction) {
    throw new Error('`migrate fresh` drops the database and is refused when NODE_ENV=production.')
  }
  const connection = await serverConnection()
  try {
    console.log(`  dropping database ${env.db.database} (development only)`)
    await connection.query(`DROP DATABASE IF EXISTS \`${env.db.database}\``)
  } finally {
    await connection.end()
  }
  await up()
}

const commands = { up, status, fresh }
const command = process.argv[2] ?? 'up'

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: up | status | fresh`)
  process.exit(1)
}

try {
  await commands[command]()
} catch (error) {
  console.error(`\n  migration ${command} failed: ${error.message}`)
  process.exit(1)
}
