import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { ok } from '../../lib/errors.js'
import { formatMoney } from '../../lib/money.js'
import { resolveCoupon, round2 } from './pricing.service.js'

/**
 * Previewing a promo code before checkout.
 *
 * The checkout page had a promo box that sent the code with the order and told the shopper
 * "applied when you place the order". Nothing validated it, the summary never moved, and the
 * only feedback was an error *after* pressing Place Order. From the shopper's side that is
 * indistinguishable from a broken feature — which is exactly what it was reported as.
 *
 * This endpoint answers the one question the box needs answered: is this code usable on this
 * cart, and what is it worth?
 *
 * Two properties it shares with checkout, and must:
 *
 *   * **Prices are re-read from the database.** The request carries product ids and
 *     quantities, never amounts. A preview that trusted a client-supplied line total would
 *     happily report a 90% discount on a cart the shopper invented, and while the real
 *     discount is recomputed at checkout, showing a figure Mirwal will not honour is its own
 *     kind of lie.
 *
 *   * **The same rule set decides.** It calls `resolveCoupon`, the function checkout uses,
 *     rather than a second copy of the rules. Two implementations of "is this coupon valid"
 *     drift, and the day they disagree the shopper sees a discount at preview and loses it at
 *     checkout.
 *
 * `resolveCoupon` takes an executor and issues `SELECT ... FOR UPDATE`. Passing the pool
 * rather than a transaction is deliberate: in autocommit the row lock is taken and released
 * immediately, which is right for a read-only preview. The binding decision — the one that
 * must not race another checkout — still happens inside the order transaction.
 */

export const previewCouponSchema = z.object({
  code: z.string().trim().min(1).max(40),
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(36),
    sku: z.string().trim().min(1).max(80).optional(),
    quantity: z.coerce.number().int().min(1).max(20),
  })).min(1).max(50),
})

export async function preview(req, res, next) {
  try {
    const { code, items } = req.body

    // Re-price the cart from the database, the same way checkout does.
    const lines = []
    for (const requested of items) {
      const [rows] = await pool.execute(
        `SELECT p.id AS product_id, p.price AS product_price, p.seller_id, p.status,
                p.deleted_at, s.status AS seller_status,
                v.id AS variant_id, v.price AS variant_price
           FROM products p
           JOIN sellers s ON s.id = p.seller_id
           JOIN product_variants v
             ON v.product_id = p.id
            AND (${requested.sku ? 'v.sku = ?' : 'v.is_default = 1'})
          WHERE p.public_id = ?`,
        requested.sku ? [requested.sku, requested.productId] : [requested.productId],
      )
      const row = rows[0]
      // Silently skipped rather than refused: a stale cart line is checkout's problem to
      // report, and failing the whole preview because of one would leave the shopper unable to
      // see a discount that genuinely applies to the rest.
      if (!row || row.status !== 'active' || row.deleted_at || row.seller_status !== 'approved') continue

      const unitPrice = Number(row.variant_price ?? row.product_price)
      lines.push({
        key: `${row.product_id}:${row.variant_id}`,
        sellerId: row.seller_id,
        lineTotal: round2(unitPrice * requested.quantity),
      })
    }

    if (!lines.length) {
      return ok(res, { valid: false, reason: 'There is nothing in your cart this code could apply to.' })
    }

    const coupon = await resolveCoupon(pool, { code, buyerId: req.user.id, lines })

    return ok(res, {
      valid: true,
      code: coupon.code,
      discount: formatMoney(coupon.discount.toFixed(2), 'PKR'),
      freeShipping: coupon.freeShipping,
      // How much of the basket the code actually touches. A seller-owned code on a
      // multi-seller cart discounts only that seller's lines, and saying so up front prevents
      // "why is it only Rs. 71 off?" arriving as a support ticket.
      appliesToItems: coupon.eligibleLineIds.size,
      itemCount: lines.length,
    })
  } catch (error) {
    /**
     * A rejected code is a normal answer, not a server error.
     *
     * `resolveCoupon` throws for every "you cannot use this" case — expired, exhausted,
     * already used, minimum not met. Those all carry a message written for the shopper, so
     * they are returned as a 200 with `valid: false` and the reason shown next to the box.
     * Letting them through as 404/409 would make the promo field report failures the same way
     * a broken endpoint does.
     */
    if (error?.status === 404 || error?.status === 409 || error?.status === 400) {
      return ok(res, { valid: false, reason: error.message, code: error.code })
    }
    return next(error)
  }
}
