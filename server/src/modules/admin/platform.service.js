import { randomUUID, createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink, readFile } from 'node:fs/promises'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { query, queryOne, pool } from '../../db/pool.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { env } from '../../config/env.js'
import { getSetting, updateSettings } from '../settings/settings.service.js'

/**
 * Maintenance mode and database backups — the last two admin screens with nothing behind them.
 *
 * Both were previously walls of invented data: a fake "285.6 GB across Google Drive, S3 and
 * Dropbox" storage breakdown with a fabricated backup history, and a maintenance toggle that
 * wrote to component state. What replaces them is deliberately smaller than what was drawn.
 *
 * Two things this module does NOT do, on purpose:
 *
 *  - It never restores. A restore overwrites live data, and the project's standing constraint
 *    is that destructive database changes do not happen without explicit approval. Exports can
 *    be downloaded and handed to whoever runs the database; that is where a restore belongs.
 *  - It never uploads anywhere. A dump is the entire database in one file, including every
 *    customer's address and every password hash. Shipping that to third-party storage is a
 *    decision for the operator, not a default.
 */

// ---------------------------------------------------------------------------
// Maintenance mode
// ---------------------------------------------------------------------------

export async function getMaintenance() {
  const [enabled, message, allowIps] = await Promise.all([
    getSetting('maintenance.enabled', false),
    getSetting('maintenance.message', ''),
    getSetting('maintenance.allow_ips', []),
  ])
  return {
    enabled: Boolean(enabled),
    message: String(message ?? ''),
    allowIps: Array.isArray(allowIps) ? allowIps : [],
  }
}

/**
 * Turn maintenance mode on or off.
 *
 * Staff sessions are always allowed through (see middleware/maintenance.js), so switching
 * this on cannot lock the person who did it out of the control that switches it off.
 */
export async function setMaintenance({ enabled, message, allowIps }, userId) {
  const updates = {}
  if (enabled !== undefined) updates['maintenance.enabled'] = enabled
  if (message !== undefined) updates['maintenance.message'] = message
  if (allowIps !== undefined) updates['maintenance.allow_ips'] = allowIps

  if (Object.keys(updates).length > 0) await updateSettings(updates, userId)
  return getMaintenance()
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

const backupRoot = () => path.resolve(env.backups.dir)

/** Resolve a stored name inside the backup directory, refusing anything that escapes it. */
function resolveBackup(storedName) {
  const root = backupRoot()
  const full = path.resolve(root, storedName)
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw badRequest('Invalid backup reference.', 'INVALID_BACKUP_PATH')
  }
  return full
}

/** MySQL string literal escaping for the dump. */
function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Backslash and quote are the two that break out of a literal; the control characters
  // below would otherwise corrupt the dump when it is read back line by line.
  return `'${text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
    // Ctrl-Z. Escaped because MySQL treats a raw 0x1A in a dump file as end-of-file on
    // Windows, which would silently truncate a restore at the first row containing one.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1a/g, '\\Z')}'`
}

/**
 * Write a gzipped SQL dump of every table.
 *
 * Rows are streamed a page at a time rather than loaded into memory: a dump of a marketplace
 * that has been trading for a year must not need the whole `orders` table resident to run.
 *
 * Written in JS rather than shelling out to mysqldump, which is frequently absent on shared
 * hosting — a backup button that works only where a binary happens to be installed is worse
 * than no button, because it looks like it worked everywhere.
 *
 * The whole read runs on one connection holding a REPEATABLE READ consistent snapshot, which
 * is what makes the export restorable rather than merely plausible. Without it the dump sees
 * each table at a different instant: an order written midway through lands in `orders` but
 * not in `order_items`, and restoring that produces rows whose foreign keys point at nothing.
 * On InnoDB the snapshot costs nothing — readers never block writers — and it is the same
 * mechanism `mysqldump --single-transaction` relies on.
 */
export async function createBackup(userId) {
  const running = await queryOne("SELECT id FROM backup_runs WHERE status = 'running'")
  if (running) throw conflict('A backup is already running.', 'BACKUP_IN_PROGRESS')

  const publicId = randomUUID()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const storedName = `mirwal-${stamp}-${publicId.slice(0, 8)}.sql.gz`

  await query(
    'INSERT INTO backup_runs (public_id, stored_name, status, created_by) VALUES (?, ?, ?, ?)',
    [publicId, storedName, 'running', userId ?? null],
  )

  const startedAt = Date.now()
  // Held for the whole dump and released in the finally below, whatever happens — a snapshot
  // left open holds back InnoDB's purge and grows the undo log indefinitely.
  const snapshot = await pool.getConnection()
  try {
    await mkdir(backupRoot(), { recursive: true })
    const target = resolveBackup(storedName)

    const gzip = createGzip()
    const file = createWriteStream(target, { mode: 0o600 })
    const finished = pipeline(gzip, file)

    // Backpressure matters here: without awaiting drain, a large table queues the whole
    // dump in memory and defeats the point of paging.
    const write = (chunk) => new Promise((resolve, reject) => {
      if (gzip.write(chunk)) return resolve()
      return gzip.once('drain', resolve).once('error', reject)
    })

    await snapshot.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await snapshot.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    /** Every read below goes through the snapshot connection, never the pool. */
    const read = async (sql, params = []) => (await snapshot.query(sql, params))[0]

    const tables = (await read(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    )).map((row) => row.name)

    await write(`-- Mirwal database export\n-- Generated ${new Date().toISOString()}\n`)
    await write('-- Restoring this file overwrites existing data. Hand it to whoever runs the database.\n\n')
    await write('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n')

    let totalRows = 0
    for (const table of tables) {
      const [created] = await read(`SHOW CREATE TABLE \`${table}\``)
      await write(`\n-- ----------------------------\n-- ${table}\n-- ----------------------------\n`)
      await write(`DROP TABLE IF EXISTS \`${table}\`;\n${created['Create Table']};\n\n`)

      const columns = (await read(
        `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
        [table],
      )).map((row) => row.name)
      const columnList = columns.map((name) => `\`${name}\``).join(', ')

      const PAGE = 500
      for (let offset = 0; ; offset += PAGE) {
        const rows = await read(`SELECT ${columnList} FROM \`${table}\` LIMIT ? OFFSET ?`, [PAGE, offset])
        if (rows.length === 0) break
        const values = rows
          .map((row) => `(${columns.map((name) => sqlValue(row[name])).join(', ')})`)
          .join(',\n  ')
        await write(`INSERT INTO \`${table}\` (${columnList}) VALUES\n  ${values};\n`)
        totalRows += rows.length
        if (rows.length < PAGE) break
      }
    }

    await write('\nSET FOREIGN_KEY_CHECKS = 1;\n')
    // Read-only, so there is nothing to commit — this only ends the snapshot.
    await snapshot.query('COMMIT')
    gzip.end()
    await finished

    const { size } = await stat(target)
    const checksum = createHash('sha256').update(await readFile(target)).digest('hex')

    await query(
      `UPDATE backup_runs
          SET status = 'completed', table_count = ?, row_count = ?, size_bytes = ?,
              checksum = ?, duration_ms = ?, completed_at = NOW(3)
        WHERE public_id = ?`,
      [tables.length, totalRows, size, checksum, Date.now() - startedAt, publicId],
    )

    await pruneOldBackups()
    return getBackup(publicId)
  } catch (error) {
    await query(
      `UPDATE backup_runs SET status = 'failed', error = ?, duration_ms = ?, completed_at = NOW(3)
        WHERE public_id = ?`,
      [String(error.message).slice(0, 500), Date.now() - startedAt, publicId],
    )
    throw error
  } finally {
    snapshot.release()
  }
}

/** Keep the newest `env.backups.keep` completed runs; delete the rest, file and row. */
async function pruneOldBackups() {
  const stale = await query(
    `SELECT public_id, stored_name FROM backup_runs
      WHERE status = 'completed' ORDER BY created_at DESC LIMIT 500 OFFSET ?`,
    [env.backups.keep],
  )
  for (const row of stale) {
    // A file already gone is the state we wanted; the row still goes.
    await unlink(resolveBackup(row.stored_name)).catch(() => {})
    await query('DELETE FROM backup_runs WHERE public_id = ?', [row.public_id])
  }
}

const mapBackup = (row) => ({
  id: row.public_id,
  fileName: row.stored_name,
  status: row.status,
  tableCount: Number(row.table_count),
  rowCount: Number(row.row_count),
  sizeBytes: Number(row.size_bytes),
  checksum: row.checksum,
  error: row.error,
  durationMs: Number(row.duration_ms),
  createdBy: row.created_by_name ?? null,
  createdAt: row.created_at,
  completedAt: row.completed_at,
})

export async function listBackups({ page = 1, pageSize = 25 } = {}) {
  const offset = (page - 1) * pageSize
  const rows = await query(
    `SELECT b.*, u.full_name AS created_by_name
       FROM backup_runs b
       LEFT JOIN users u ON u.id = b.created_by
      ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset],
  )
  const { total } = await queryOne('SELECT COUNT(*) AS total FROM backup_runs')

  const summary = await queryOne(
    `SELECT COUNT(*) AS completed, COALESCE(SUM(size_bytes), 0) AS bytes, MAX(completed_at) AS last_run
       FROM backup_runs WHERE status = 'completed'`,
  )

  return {
    items: rows.map(mapBackup),
    total: Number(total),
    summary: {
      completed: Number(summary.completed),
      totalBytes: Number(summary.bytes),
      lastRunAt: summary.last_run,
      // Read from the environment so the page states the real retention, not a guess.
      keep: env.backups.keep,
      directory: backupRoot(),
    },
  }
}

export async function getBackup(publicId) {
  const row = await queryOne(
    `SELECT b.*, u.full_name AS created_by_name
       FROM backup_runs b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.public_id = ?`,
    [publicId],
  )
  if (!row) throw notFound('Backup not found.', 'BACKUP_NOT_FOUND')
  return mapBackup(row)
}

/** The bytes, for an authenticated download. Never served statically. */
export async function readBackup(publicId) {
  const row = await queryOne("SELECT * FROM backup_runs WHERE public_id = ? AND status = 'completed'", [publicId])
  if (!row) throw notFound('Backup not found.', 'BACKUP_NOT_FOUND')
  try {
    return { fileName: row.stored_name, buffer: await readFile(resolveBackup(row.stored_name)) }
  } catch {
    // The row survives a missing file so the history stays honest about what was taken.
    throw notFound('That backup file is no longer on disk.', 'BACKUP_FILE_MISSING')
  }
}

export async function deleteBackup(publicId) {
  const row = await queryOne('SELECT * FROM backup_runs WHERE public_id = ?', [publicId])
  if (!row) throw notFound('Backup not found.', 'BACKUP_NOT_FOUND')
  if (row.status === 'running') throw conflict('That backup is still running.', 'BACKUP_IN_PROGRESS')

  await unlink(resolveBackup(row.stored_name)).catch(() => {})
  await query('DELETE FROM backup_runs WHERE id = ?', [row.id])
  return { fileName: row.stored_name }
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

/** Live facts about the running server, for the maintenance page's status panel. */
export async function systemStatus() {
  const [maintenance, version, size, connections] = await Promise.all([
    getMaintenance(),
    queryOne('SELECT VERSION() AS version'),
    queryOne(
      `SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes, COUNT(*) AS tables
         FROM information_schema.tables WHERE table_schema = DATABASE()`,
    ),
    queryOne("SHOW STATUS LIKE 'Threads_connected'").catch(() => null),
  ])

  return {
    maintenance,
    database: {
      version: version.version,
      // information_schema sizes are estimates for InnoDB; said plainly rather than
      // presented as an exact figure.
      approximateBytes: Number(size.bytes),
      tables: Number(size.tables),
      openConnections: connections ? Number(connections.Value) : null,
      poolLimit: pool.config?.connectionLimit ?? null,
    },
    server: {
      nodeVersion: process.version,
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      memoryBytes: process.memoryUsage().rss,
    },
  }
}
