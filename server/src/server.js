import { createApp } from './app.js'
import { env } from './config/env.js'
import { closePool, verifyConnection } from './db/pool.js'
import { startJobs, stopJobs } from './jobs/scheduler.js'
import { warmMailTransport } from './lib/mailer.js'

/**
 * Entry point. The process refuses to serve traffic until the database is reachable and
 * confirmed utf8mb4 — starting an API that silently corrupts Urdu and Arabic is worse
 * than not starting at all.
 */
const info = await verifyConnection().catch((error) => {
  console.error(`\n  Cannot start: ${error.message}\n`)
  process.exit(1)
})

console.log(`  database ${env.db.database} @ ${env.db.host}:${env.db.port}`)
console.log(`  MariaDB ${info.version}, charset ${info.database_charset}/${info.database_collation}`)

// Started after the database check, so a job can never fire against a connection that was
// never proven. See src/jobs/scheduler.js for why this runs in-process rather than on cron.
startJobs()

// Opens the SMTP connection now rather than making the first shopper wait for it.
warmMailTransport()

const server = createApp().listen(env.port, () => {
  console.log(`  Mirwal API listening on http://localhost:${env.port}${env.apiPrefix}  [${env.nodeEnv}]`)
})

const shutdown = async (signal) => {
  console.log(`\n  ${signal} received, shutting down`)
  stopJobs()
  server.close(async () => { await closePool(); process.exit(0) })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
