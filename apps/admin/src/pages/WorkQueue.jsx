import Icon from '@mirwal/shared/Icon'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import './work-queue.css'

/**
 * What needs doing right now.
 *
 * Mirwal grew a queue at a time, each with its own screen — seller applications, listings to
 * review, trust-and-safety cases, reported reviews, brand authorisations, disputed returns,
 * payouts, support. Opening the admin panel told you the GMV for the last thirty days and
 * nothing at all about the eleven people currently waiting on a decision. Answering "what is
 * late" meant visiting eight screens and remembering the ninth.
 *
 * Two things this insists on:
 *
 *   * **Overdue is its own number, and it comes first.** Forty open with none late is a
 *     healthy queue; three open where all three have blown their service level is not. Sorted
 *     so that reading top to bottom is working in the right order.
 *
 *   * **It only shows what you can act on.** The API filters by permission, so a verification
 *     agent does not see the payout backlog. Work everybody can see is work nobody owns.
 */
export default function WorkQueue() {
  const { data, error, isLoading } = useApiQuery((signal) => api.admin.workQueue(signal), [])

  // Silent on failure and silent when there is nothing to do. This sits above a dashboard
  // that has its own job; an error card for a summary panel would displace the page's actual
  // content to say something nobody can act on.
  if (isLoading || error) return null

  const queues = (data?.queues ?? []).filter((queue) => queue.unavailable || queue.open > 0)
  const { open = 0, overdue = 0 } = data?.totals ?? {}

  if (queues.length === 0) {
    return (
      <section className="workqueue workqueue-clear">
        <Icon name="circle-check" />
        <p>Nothing is waiting on a decision.</p>
      </section>
    )
  }

  return (
    <section className="workqueue">
      <header>
        <h2>Needs a decision</h2>
        <p>
          {open} waiting
          {overdue > 0 && <> &middot; <b>{overdue} past their service level</b></>}
        </p>
      </header>

      <ul>
        {queues.map((queue) => (
          <li key={queue.key} className={queue.overdue > 0 ? 'workqueue-late' : ''}>
            <button type="button" onClick={() => navigateTo(queue.link)}>
              <span className="workqueue-count">
                {queue.unavailable ? '—' : queue.open}
              </span>
              <span className="workqueue-label">
                <b>{queue.label}</b>
                <small>
                  {/* "Could not look" and "nothing waiting" are different answers, and a queue
                      that quietly reports zero when it is really unreadable is one that stops
                      being worked. */}
                  {queue.unavailable
                    ? 'This queue could not be read.'
                    : queue.overdue > 0
                      ? `${queue.overdue} over ${queue.slaHours}h`
                      : queue.blurb}
                </small>
              </span>
              <Icon name="chevron-right" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
