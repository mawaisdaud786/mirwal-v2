import { toSqlDateTime } from './tokens.js'

/**
 * Shared date-range math for every real analytics/reporting query in the app (admin
 * platform-wide analytics, seller finance, and anything added later). Factored out once two
 * consumers needed the identical "resolve a range, compare it to the equivalent prior period,
 * zero-fill a daily trend" logic, rather than let it drift into two slightly-different copies.
 */

const DAY_MS = 86_400_000
export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }

/** Resolves `{range, from, to}` into a concrete [start, end] window plus the immediately
 * preceding window of equal length, used for period-over-period change. `all` and a custom
 * `from` both yield a null previous window — there is nothing honest to compare against, so
 * callers get `changePercent: null` instead of a fabricated percentage. */
export function resolveWindow({ range, from, to }) {
  const end = to ?? new Date()
  let start = from ?? null
  if (!start && range !== 'all') start = new Date(end.getTime() - RANGE_DAYS[range] * DAY_MS)

  if (!start) return { start: null, end, prevStart: null, prevEnd: null }

  const durationMs = end.getTime() - start.getTime()
  return { start, end, prevStart: new Date(start.getTime() - durationMs), prevEnd: start }
}

/** `AND column >= ? AND column <= ?`, omitting either side that has no bound. */
export function windowClause(column, start, end) {
  const clauses = []
  const params = []
  if (start) { clauses.push(`${column} >= ?`); params.push(toSqlDateTime(start)) }
  if (end) { clauses.push(`${column} <= ?`); params.push(toSqlDateTime(end)) }
  return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params }
}

/** Percentage change, or null when there is no real prior-period baseline to compare to
 * (never displayed as a fabricated "+0%" or "+100%"). */
export function changePercent(current, previous) {
  if (previous == null) return null
  if (previous === 0) return current > 0 ? null : 0
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/** Zero-fills `rows` (each `{ day: 'YYYY-MM-DD', ...values }`) across every day in a bounded
 * [start, end] window, so a trend line shows real gaps as real zeros rather than skipping
 * them. An unbounded window (`start` null, i.e. an 'all' range) has no start to fill from and
 * returns only the days that actually have data. `emptyValue` supplies the shape for a
 * zero-value day (e.g. `{ revenue: 0, orders: 0 }`). */
export function zeroFillDaily(rows, start, end, emptyValue) {
  const byDay = new Map(rows.map(({ day, ...rest }) => [String(day).slice(0, 10), rest]))
  if (!start) return [...byDay.entries()].map(([day, value]) => ({ date: day, ...value }))

  const points = []
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
  while (cursor <= last) {
    const key = cursor.toISOString().slice(0, 10)
    points.push({ date: key, ...(byDay.get(key) ?? emptyValue) })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return points
}
