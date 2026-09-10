import { withSnapshot } from '../../db/pool.js'

/**
 * Everything waiting on a human, in one place.
 *
 * Mirwal grew a queue at a time — seller applications, product approvals, review moderation,
 * trust-and-safety cases, brand authorisations, disputed returns, manual refunds, payouts —
 * each with its own screen and its own idea of what "waiting" means. Nobody opening the admin
 * panel could answer the only question that matters at the start of a shift: *what needs doing
 * right now, and what is late?* You had to visit nine screens and remember the tenth.
 *
 * Three decisions:
 *
 * **Overdue is counted separately from open.** A queue of forty with nothing overdue is
 * healthy; a queue of three where all three have sat past their service level is not. A single
 * "open" number cannot tell those apart, and it is the second that costs Mirwal sellers and
 * buyers.
 *
 * **The service levels live here, next to the counts.** They are not settings, because they
 * are not something an operator should be able to quietly relax when a queue is red — the
 * point of a service level is that it does not move when it becomes inconvenient.
 *
 * **Read as one snapshot.** Nine counts taken at nine different instants produce a total that
 * matches none of the rows, which is exactly the kind of small incoherence that teaches people
 * to distrust a dashboard. `withSnapshot` costs the parallelism and buys arithmetic that adds
 * up.
 */

/**
 * How long each queue may keep someone waiting.
 *
 * Chosen from what the person on the other end is doing while they wait, not from how hard the
 * work is. A seller whose application is unreviewed cannot trade at all, so it is the tightest;
 * a payout request is money already earned, so it is tighter than a listing review; marketing
 * copy waits longest because nobody is blocked by it.
 */
const QUEUES = [
  {
    key: 'applications',
    label: 'Seller applications',
    link: '/seller-applications',
    permission: 'seller.application.read',
    slaHours: 48,
    blurb: 'An applicant cannot trade at all until this is decided.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(created_at < NOW() - INTERVAL 48 HOUR) AS overdue
            FROM seller_applications
           WHERE status IN ('submitted', 'in_review', 'more_info_required')`,
  },
  {
    key: 'products',
    label: 'Listings to review',
    link: '/product-approvals',
    permission: 'catalog.product.approve',
    slaHours: 24,
    blurb: 'Nothing sells while it waits.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(updated_at < NOW() - INTERVAL 24 HOUR) AS overdue
            FROM products
           WHERE status = 'pending_review' AND deleted_at IS NULL`,
  },
  {
    key: 'returnDisputes',
    label: 'Disputed returns',
    link: '/return-disputes',
    permission: 'order.return.adjudicate',
    slaHours: 48,
    blurb: 'A buyer has appealed a seller’s decision and is waiting on Mirwal.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(escalated_at < NOW() - INTERVAL 48 HOUR) AS overdue
            FROM return_requests
           WHERE status = 'escalated'`,
  },
  {
    key: 'cases',
    label: 'Trust & safety',
    link: '/cases',
    permission: 'case.read',
    slaHours: 24,
    blurb: 'Reports of counterfeits, fraud and abuse.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(created_at < NOW() - INTERVAL 24 HOUR) AS overdue
            FROM cases
           WHERE status IN ('reported', 'under_review')`,
  },
  {
    key: 'reviews',
    label: 'Reported reviews',
    link: '/reviews',
    permission: 'review.moderate',
    slaHours: 72,
    blurb: 'A review somebody says should not stand.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(created_at < NOW() - INTERVAL 72 HOUR) AS overdue
            FROM review_reports
           WHERE status IN ('open', 'reviewing')`,
  },
  {
    key: 'brandAuthorizations',
    label: 'Brand authorisations',
    link: '/brands',
    permission: 'catalog.product.approve',
    slaHours: 72,
    blurb: 'A seller wants to list against a protected brand.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(created_at < NOW() - INTERVAL 72 HOUR) AS overdue
            FROM brand_authorizations
           WHERE status = 'pending'`,
  },
  {
    key: 'payouts',
    label: 'Payouts to approve',
    link: '/payouts',
    permission: 'payout.manage',
    slaHours: 48,
    blurb: 'Money a seller has already earned.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(created_at < NOW() - INTERVAL 48 HOUR) AS overdue
            FROM payouts
           WHERE status IN ('requested', 'on_hold')`,
  },
  {
    key: 'tickets',
    label: 'Seller support',
    link: '/support',
    permission: 'order.read',
    slaHours: 24,
    blurb: 'Sellers waiting on an answer.',
    sql: `SELECT COUNT(*) AS open,
                 SUM(created_at < NOW() - INTERVAL 24 HOUR) AS overdue
            FROM support_tickets
           WHERE status IN ('open', 'pending')`,
  },
]

/**
 * The whole board.
 *
 * Filtered to what this operator may actually act on. Showing a verification agent that
 * fourteen payouts are overdue is noise at best — they cannot approve one — and at worst it
 * spreads responsibility so thinly that nobody feels it is theirs.
 *
 * A queue whose table does not exist yet is reported as unavailable rather than as zero.
 * "Nothing waiting" and "we could not look" are different answers, and conflating them is how
 * a queue quietly stops being worked.
 */
export async function getWorkQueue(permissions = []) {
  const held = new Set(permissions)
  const visible = QUEUES.filter((queue) => held.has(queue.permission))

  const rows = await withSnapshot(async (read) => {
    const results = []
    for (const queue of visible) {
      try {
        const [row] = await read(queue.sql)
        results.push({
          key: queue.key,
          label: queue.label,
          link: queue.link,
          blurb: queue.blurb,
          slaHours: queue.slaHours,
          open: Number(row?.open ?? 0),
          overdue: Number(row?.overdue ?? 0),
        })
      } catch {
        results.push({
          key: queue.key, label: queue.label, link: queue.link, blurb: queue.blurb,
          slaHours: queue.slaHours, open: null, overdue: null, unavailable: true,
        })
      }
    }
    return results
  })

  // Overdue first, then largest. Somebody reading top to bottom should be working in the right
  // order without having to think about it.
  rows.sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0) || (b.open ?? 0) - (a.open ?? 0))

  return {
    queues: rows,
    totals: {
      open: rows.reduce((sum, row) => sum + (row.open ?? 0), 0),
      overdue: rows.reduce((sum, row) => sum + (row.overdue ?? 0), 0),
    },
  }
}
