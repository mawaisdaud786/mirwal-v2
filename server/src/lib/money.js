/**
 * Shared money formatting for every module that sends a price across the API boundary.
 *
 * Money crosses as a string, not a float: mysql2 returns DECIMAL as a string and it stays
 * that way. The API sends `{ amount: "202000.00", currency: "PKR", display: "Rs. 202,000" }`
 * so no caller re-parses a formatted string with a regex to get the number back.
 */
export function formatMoney(amount, currency = 'PKR') {
  if (amount === null || amount === undefined) return null
  const numeric = Number(amount)
  return {
    amount: String(amount),
    currency,
    display: currency === 'PKR'
      ? `Rs. ${numeric.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
      : `${currency} ${amount}`,
  }
}

/**
 * A money value as a plain DECIMAL(12,2) string, for storing.
 *
 * `formatMoney` is for the API boundary and returns a display object; passing that to an
 * INSERT writes the JSON into the column, which MariaDB rejects as a decimal. Two names
 * because they are two different jobs, and the failure when they are confused is loud but
 * only at runtime.
 */
export function toDecimal(amount) {
  if (amount === null || amount === undefined || amount === '') return null
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) throw new TypeError(`Not a money value: ${amount}`)
  return numeric.toFixed(2)
}
