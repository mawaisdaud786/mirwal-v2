import { randomUUID } from 'node:crypto'
import { query, queryOne, withTransaction } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { parseJsonColumn } from '../../lib/json.js'
import { getSetting } from '../settings/settings.service.js'

/**
 * Tax invoices.
 *
 * Mirwal computes sales tax on every order and stores it, and no document ever stated it. A
 * Pakistani buyer registered for sales tax cannot claim input tax without an invoice, and
 * Mirwal had no record of what it had collected beyond a column.
 *
 * Two decisions that shape everything here:
 *
 *   **An invoice is a snapshot, not a view.** The totals are copied into `order_invoices` when
 *   it is issued. Rendering an invoice from the live order would mean a partial cancellation
 *   next week silently rewrites a document someone has already filed with their accountant.
 *   A refund produces a credit note; it does not edit the invoice.
 *
 *   **The number is gapless.** `invoice_counters` is locked while the next number is taken.
 *   AUTO_INCREMENT would be simpler and leaves gaps on every rolled-back transaction, and a tax
 *   authority reads a gap as a deleted invoice.
 */

/** The marketplace's own details, as they appear at the top of the document. */
async function issuerDetails() {
  return {
    name: (await getSetting('company.legal_name', 'Mirwal')) || 'Mirwal',
    ntn: (await getSetting('company.ntn', '')) || null,
    strn: (await getSetting('company.strn', '')) || null,
    address: (await getSetting('company.address', '')) || null,
  }
}

/**
 * Take the next number in the series, under a row lock.
 *
 * The series is the calendar year, which is how Pakistani businesses number: `MIR-2026-000417`.
 */
async function nextNumber(connection, prefix) {
  const series = String(new Date().getFullYear())
  await connection.execute(
    'INSERT INTO invoice_counters (series, last_number) VALUES (?, 0) ON DUPLICATE KEY UPDATE series = series',
    [series],
  )
  const [rows] = await connection.execute(
    'SELECT last_number FROM invoice_counters WHERE series = ? FOR UPDATE',
    [series],
  )
  const next = Number(rows[0].last_number) + 1
  await connection.execute('UPDATE invoice_counters SET last_number = ? WHERE series = ?', [next, series])
  return `${prefix}-${series}-${String(next).padStart(6, '0')}`
}

/**
 * Issue the invoice for an order.
 *
 * Idempotent: `uq_order_invoices_order` means an order has one invoice for its whole life, and
 * a second call returns the one that exists rather than failing. That matters because this is
 * called from the payment path, which retries.
 */
export async function issueForOrder(orderId) {
  const existing = await queryOne('SELECT * FROM order_invoices WHERE order_id = ?', [orderId])
  if (existing) return shape(existing)

  const order = await queryOne(
    `SELECT o.*, u.full_name, u.phone, u.email
       FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = ?`,
    [orderId],
  )
  if (!order) throw notFound('Order not found.')

  // An unpaid order is a quotation, not an invoice. Issuing one for money that never arrived
  // would put a taxable supply on record that did not happen.
  if (!['paid', 'partially_refunded', 'refunded'].includes(order.payment_status)) {
    throw conflict('An invoice is issued once the order is paid.', 'ORDER_NOT_PAID')
  }

  const items = await query(
    `SELECT oi.product_name, oi.variant_name, oi.sku, oi.unit_price, oi.quantity,
            oi.line_total, oi.discount_amount, oi.tax_amount,
            s.store_name, s.ntn AS seller_ntn, s.strn AS seller_strn
       FROM order_items oi JOIN sellers s ON s.id = oi.seller_id
      WHERE oi.order_id = ? ORDER BY oi.id`,
    [orderId],
  )

  const issuer = await issuerDetails()
  const prefix = (await getSetting('tax.invoice_prefix', 'MIR')) || 'MIR'
  const inclusive = Boolean(await getSetting('tax.prices_include_tax', true))

  const address = [
    order.shipping_line1, order.shipping_line2, order.shipping_city,
    order.shipping_region, order.shipping_postal_code,
  ].filter(Boolean).join(', ')

  const publicId = randomUUID()
  const lineItems = items.map((row) => ({
    description: row.variant_name ? `${row.product_name} — ${row.variant_name}` : row.product_name,
    sku: row.sku,
    // Each seller is a separate supply, so each line carries the registration it was made under.
    soldBy: row.store_name,
    sellerNtn: row.seller_ntn ?? null,
    sellerStrn: row.seller_strn ?? null,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
    discount: Number(row.discount_amount),
    tax: Number(row.tax_amount),
    lineTotal: Number(row.line_total),
  }))

  const invoiceNumber = await withTransaction(async (connection) => {
    const number = await nextNumber(connection, prefix)
    await connection.execute(
      `INSERT INTO order_invoices
         (public_id, invoice_number, order_id, issuer_name, issuer_ntn, issuer_strn, issuer_address,
          bill_to_name, bill_to_phone, bill_to_address, currency_code,
          subtotal, discount_total, shipping_fee, tax_total, total, tax_inclusive, line_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId, number, orderId, issuer.name, issuer.ntn, issuer.strn, issuer.address,
        order.shipping_full_name || order.full_name, order.shipping_phone || order.phone, address,
        order.currency_code, order.subtotal, order.discount_total, order.shipping_fee,
        order.tax_total, order.total, inclusive ? 1 : 0, JSON.stringify(lineItems),
      ],
    )
    return number
  })

  const saved = await queryOne('SELECT * FROM order_invoices WHERE invoice_number = ?', [invoiceNumber])
  return shape(saved)
}

function shape(row) {
  return {
    id: row.public_id,
    number: row.invoice_number,
    issuedAt: row.issued_at,
    issuer: {
      name: row.issuer_name,
      ntn: row.issuer_ntn,
      strn: row.issuer_strn,
      address: row.issuer_address,
    },
    billTo: {
      name: row.bill_to_name,
      phone: row.bill_to_phone,
      address: row.bill_to_address,
      ntn: row.bill_to_ntn,
    },
    // mysql2 returns a JSON column parsed on some paths and as a string on others; this is the
    // codebase's answer to that, and JSON.parse on an already-parsed value throws.
    lines: parseJsonColumn(row.line_items, []),
    totals: {
      subtotal: formatMoney(row.subtotal, row.currency_code),
      discount: formatMoney(row.discount_total, row.currency_code),
      shipping: formatMoney(row.shipping_fee, row.currency_code),
      tax: formatMoney(row.tax_total, row.currency_code),
      total: formatMoney(row.total, row.currency_code),
    },
    // Says how to read the tax line: extracted from the prices, or added to them.
    taxInclusive: Boolean(row.tax_inclusive),
  }
}

/**
 * The invoice for one of the buyer's own orders.
 *
 * Issues it on first request when the order is paid but has none — orders placed before
 * invoicing existed still need one, and asking a buyer to wait for a backfill job would be
 * worse than issuing it the moment they ask.
 */
export async function forBuyer(buyerId, orderPublicId) {
  const order = await queryOne('SELECT id, buyer_id FROM orders WHERE public_id = ?', [orderPublicId])
  if (!order) throw notFound('Order not found.')
  if (order.buyer_id !== buyerId) throw forbidden('This order does not belong to you.')

  const existing = await queryOne('SELECT * FROM order_invoices WHERE order_id = ?', [order.id])
  return existing ? shape(existing) : issueForOrder(order.id)
}

/** The same document, for staff. Read-only: nothing here reissues or edits. */
export async function forAdmin(orderPublicId) {
  const order = await queryOne('SELECT id FROM orders WHERE public_id = ?', [orderPublicId])
  if (!order) throw notFound('Order not found.')
  const existing = await queryOne('SELECT * FROM order_invoices WHERE order_id = ?', [order.id])
  return existing ? shape(existing) : issueForOrder(order.id)
}

/**
 * Credit notes: what has gone back against an order since the invoice was issued.
 *
 * Returned alongside the invoice rather than folded into it, because that is the accounting
 * relationship — the invoice stands, and the credits sit against it.
 */
export async function creditsForOrder(orderId) {
  const rows = await query(
    `SELECT r.public_id, r.amount, r.kind, r.reason, r.status, r.created_at, o.currency_code
       FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE r.order_id = ? AND r.status IN ('pending', 'manual_required', 'succeeded')
      ORDER BY r.created_at`,
    [orderId],
  )
  return rows.map((row) => ({
    id: row.public_id,
    amount: formatMoney(row.amount, row.currency_code),
    kind: row.kind,
    reason: row.reason,
    // A refund that is still owed is shown as such: telling a buyer money went back when it has
    // not is the complaint this avoids.
    settled: row.status === 'succeeded',
    at: row.created_at,
  }))
}
