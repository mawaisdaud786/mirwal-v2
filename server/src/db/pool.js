import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

/**
 * MariaDB connection pool.
 *
 * MariaDB-specific notes (see docs/DATABASE.md):
 *  - charset is forced to utf8mb4 on the connection. The production server's default is
 *    latin1/cp1252; a latin1 connection would mangle Urdu, Arabic and emoji on the wire
 *    even when the columns themselves are utf8mb4.
 *  - `dateStrings` keeps DATETIME(3) values as strings so the driver does not reinterpret
 *    them in the server's local timezone. All application timestamps are UTC.
 *  - every connection explicitly sets its session `time_zone` to UTC. Without this, "All
 *    application timestamps are UTC" above was only true of values the app itself wrote
 *    with an explicit UTC string — every `DEFAULT CURRENT_TIMESTAMP(3)` column (every
 *    `created_at`/`updated_at` in the schema) was silently using the session's default
 *    `time_zone` (`SYSTEM`), i.e. whatever timezone the OS the DB happens to run on is set
 *    to. On this box that's Asia/Karachi (UTC+5), so every row written by the database
 *    itself — as opposed to by the app — was 5 hours ahead of what every date-range query
 *    in this codebase assumes. It went unnoticed until the first query that filtered
 *    `created_at` against an app-computed UTC boundary (analytics.service.js), where an
 *    order placed minutes ago read as "in the future" and dropped out of a same-day window.
 *  - `decimalNumbers` is deliberately left OFF: DECIMAL comes back as a string so money is
 *    never silently pushed through a float. Callers convert explicitly.
 *  - the pool is small because cPanel/CloudLinux caps concurrent connections per account.
 */
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  connectTimeout: env.db.connectTimeout,
  charset: 'utf8mb4_unicode_520_ci',
  dateStrings: true,
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  multipleStatements: false, // defence in depth against SQL injection chaining
  timezone: 'Z',
})

// mysql2's `timezone: 'Z'` option only controls how the driver itself converts JS Date
// parameters/results — it never touches the server session. Without this, the server's own
// CURRENT_TIMESTAMP()/NOW() still runs in whatever timezone the OS is set to.
pool.on('connection', (connection) => {
  // The pool's 'connection' event hands back the underlying callback-style connection,
  // not the promise-wrapped one `pool.execute()` uses elsewhere in this file.
  connection.query("SET time_zone = '+00:00'", () => {
    // Best-effort: a connection that fails this is still usable for everything that
    // doesn't depend on server-side NOW()/CURRENT_TIMESTAMP() matching app-computed UTC.
  })
})

/** Run a query and return rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

/** Run a query and return the first row, or null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] ?? null
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any throw.
 *
 * MariaDB does not support transactional DDL, so this is for DML only — a migration that
 * needs DDL cannot rely on rollback and must be written to fail safely instead.
 */
export async function withTransaction(fn) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await fn(connection)
    await connection.commit()
    return result
  } catch (error) {
    try { await connection.rollback() } catch { /* connection already gone */ }
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Read several aggregates as one consistent snapshot.
 *
 * A dashboard that runs eleven aggregate queries in parallel gets eleven pooled connections
 * and therefore eleven slightly different moments in time. Under any real write traffic the
 * headline figure and the chart beside it then disagree — the KPI counts an order the trend
 * does not, and nothing about the page says which is right.
 *
 * `START TRANSACTION WITH CONSISTENT SNAPSHOT` in REPEATABLE READ gives every query in `fn`
 * the same view of the database. It costs the parallelism — one connection, so the reads are
 * serial — which is the right trade for a page whose whole job is that its numbers add up.
 * READ ONLY lets InnoDB skip allocating a transaction id.
 *
 * `fn` is handed a `read(sql, params)` that runs on that connection. Anything using the pool
 * directly inside `fn` is outside the snapshot, so pass everything through it.
 */
export async function withSnapshot(fn) {
  const connection = await pool.getConnection()
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    const read = async (sql, params = []) => {
      const [rows] = await connection.execute(sql, params)
      return rows
    }
    return await fn(read)
  } finally {
    // Nothing was written, so the outcome of ending it does not matter — but the connection
    // must not go back to the pool still inside a transaction.
    try { await connection.query('COMMIT') } catch { /* connection already gone */ }
    connection.release()
  }
}

/** Verify connectivity and that the session really is utf8mb4. Called on boot. */
export async function verifyConnection() {
  const row = await queryOne(
    `SELECT VERSION() AS version,
            @@character_set_connection AS connection_charset,
            @@character_set_database   AS database_charset,
            @@collation_database       AS database_collation`,
  )

  if (!row.database_charset?.startsWith('utf8mb4')) {
    throw new Error(
      `Database "${env.db.database}" has charset "${row.database_charset}", not utf8mb4. ` +
      `Urdu, Arabic and emoji cannot be stored correctly. Run the migrations, which ALTER ` +
      `the database charset, or recreate it with CHARACTER SET utf8mb4.`,
    )
  }

  return row
}

export async function closePool() {
  await pool.end()
}
