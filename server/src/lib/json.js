/**
 * Read a JSON column back out of MariaDB.
 *
 * MariaDB has no native JSON type: `JSON` is an alias for `longtext` plus a
 * `CHECK (json_valid(col))` constraint — which is exactly how migrations 001–011 declare
 * `audit_logs.metadata`, `product_variants.options` and friends. MariaDB still advertises
 * those columns to the client with the JSON type flag, so mysql2 parses them for us and hands
 * back an object.
 *
 * That makes a bare `JSON.parse(row.col)` a trap: it works against a plain text column and
 * throws `"[object Object]" is not valid JSON` against a json_valid one. Which behaviour you
 * get depends on the driver and the column's declaration, not on your code — so every read of
 * a JSON column goes through here instead of assuming either shape.
 *
 * @param {unknown} value    the raw column value
 * @param {unknown} fallback returned for null/undefined, or for text that will not parse
 */
export function parseJsonColumn(value, fallback = null) {
  if (value == null) return fallback
  // Already parsed by the driver — the common case for a json_valid column.
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    // A malformed value is data corruption, not a reason to fail the whole request: the row
    // is still worth showing without its metadata.
    return fallback
  }
}
