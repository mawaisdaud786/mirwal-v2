import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { Pagination } from './AdminComponents'
import { useAdminSession } from '../AdminSession'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import { LoadingState, ErrorState, EmptyState } from './AdminStates'

/**
 * Moderating reviews.
 *
 * Verified purchase was already enforced by the database — `product_reviews.order_item_id` is
 * NOT NULL and UNIQUE, so there is no code path to a review from someone who never bought the
 * thing. That is the hard half, and it does not change here.
 *
 * What was missing was everything after it. A review had no status, so a defamatory or
 * obviously fake one could not be taken down; `AUDIT.REVIEW_DELETED` existed as a constant with
 * no endpoint behind it, and the admin Reviews page was a read-only list.
 *
 * The distinction the three states carry:
 *
 *   published — visible, counted in the product's rating
 *   hidden    — not visible, still counted; for a review that breaks a presentation rule
 *               (a phone number in the text) but is an honest assessment
 *   removed   — not visible, not counted; for a review that should never have existed
 *
 * That split matters because hiding a genuine one-star review and *also* deleting its rating
 * would let a seller launder their score by reporting every bad review. Removal is the heavier
 * action and is recorded as such.
 */

const TABS = [
  ['reported', 'Reported'],
  ['published', 'Published'],
  ['hidden', 'Hidden'],
  ['removed', 'Removed'],
]

const MODERATION_CODES = [
  ['offensive', 'Abusive or offensive language'],
  ['personal_information', 'Contains personal information'],
  ['fake', 'Not a genuine experience'],
  ['incentivised', 'Written in exchange for something'],
  ['off_topic', 'Not about this product'],
  ['spam', 'Spam or advertising'],
  ['other', 'Other'],
]

export default function AdminReviewModeration() {
  const [tab, setTab] = useState('reported')
  const [acting, setActing] = useState(null)

  const query = tab === 'reported' ? { reportedOnly: true } : { status: tab }
  /**
   * Paged rather than capped at fifty.
   *
   * A fixed `pageSize: 50` is a cap wearing a page's clothes — the fifty-first report in the
   * queue was unreachable and nothing on screen admitted it.
   */
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const list = useApiQuery(
    (signal) => api.admin.reviews.queue({ ...query, page, pageSize }, signal),
    [tab, page, pageSize],
  )
  const patterns = useApiQuery((signal) => api.admin.reviews.patterns(signal), [])

  // Without `review.moderate` this is a read-only queue: the reports are visible, the actions
  // are not, matching the route that would refuse them.
  const { can } = useAdminSession()
  const canModerate = can('review.moderate')

  const reviews = list.data?.items ?? []

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1>Reviews</h1>
          <p>Every review here is from a confirmed purchase — that is enforced by the database, not by moderation.</p>
        </div>
      </header>

      {/* Signals worth a human look, rather than individual reviews to action. A cluster is
          what manipulation looks like; one bad review is just a bad review. */}
      {patterns.data?.length > 0 && (
        <section className="mod-patterns">
          <h2><Icon name="triangle-exclamation" /> Worth a look</h2>
          <ul>
            {patterns.data.map((signal) => (
              <li key={signal.label ?? signal.type}>
                <b>{signal.label ?? signal.type}</b>
                {signal.detail && <span>{signal.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="app-tabs">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => { setPage(1); setTab(value) }}>
            {label}
          </button>
        ))}
      </nav>

      {list.isLoading && <LoadingState label="Loading reviews" />}
      {list.error && (
        <>
          <p className="app-error" role="alert">{describeApiError(list.error)}</p>
          <ErrorState onRetry={list.refetch} />
        </>
      )}

      {!list.isLoading && !list.error && (
        reviews.length === 0
          ? <EmptyState
            title={tab === 'reported' ? 'Nothing reported' : 'Nothing here'}
            description={tab === 'reported'
              ? 'No review has been reported. Reports from buyers and sellers appear here.'
              : `No reviews are ${tab}.`}
          />
          : (
            <>
            <ul className="mod-list">
              {reviews.map((review) => (
                <li key={review.id} className="mod-card">
                  <div className="mod-head">
                    <span className="mod-stars" aria-label={`${review.rating} out of 5`}>
                      {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                    </span>
                    {/* Three doors on one card: the listing, the store that sold it and the
                        person who wrote the review. Judging a review usually means looking at
                        at least one of them. */}
                    {review.product.id
                      ? <button type="button" className="table-link" onClick={() => navigateTo(`/products/${review.product.id}`)}><b>{review.product.name}</b></button>
                      : <b>{review.product.name}</b>}
                    <em className={`mod-status mod-${review.status}`}>{review.status}</em>
                    {review.reportCount > 0 && (
                      <span className="mod-reports"><Icon name="flag" /> {review.reportCount}</span>
                    )}
                  </div>

                  {review.title && <p className="mod-title">{review.title}</p>}
                  <p className="mod-body">{review.body}</p>

                  <p className="mod-meta">
                    {review.author?.id
                      ? <button type="button" className="table-link" onClick={() => navigateTo(`/customers/${review.author.id}`)}>{review.author.name}</button>
                      : review.author?.name}
                    {' '}&middot; {new Date(`${review.at}Z`).toLocaleDateString()}
                    {review.seller?.storeName && (
                      <>
                        {' · sold by '}
                        {review.seller.id
                          ? <button type="button" className="table-link" onClick={() => navigateTo(`/sellers/${review.seller.id}`)}>{review.seller.storeName}</button>
                          : review.seller.storeName}
                      </>
                    )}
                  </p>

                  {review.moderation && (
                    <p className="mod-previous">
                      Previously actioned: <b>{review.moderation.code}</b>
                      {review.moderation.reason ? ` — ${review.moderation.reason}` : ''}
                    </p>
                  )}

                  {canModerate && <ModerationActions
                    review={review}
                    isOpen={acting === review.id}
                    onOpen={() => setActing(review.id)}
                    onClose={() => setActing(null)}
                    onDone={() => { setActing(null); list.refetch(); patterns.refetch() }}
                  />}
                </li>
              ))}
            </ul>
            <Pagination
              section="admin"
              page={list.data?.pagination?.page ?? page}
              pageSize={list.data?.pagination?.pageSize ?? pageSize}
              total={list.data?.pagination?.total ?? 0}
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1) }}
            />
            </>
          )
      )}
    </div>
  )
}

function ModerationActions({ review, isOpen, onOpen, onClose, onDone }) {
  const [status, setStatus] = useState('hidden')
  const [code, setCode] = useState('offensive')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.admin.reviews.moderate(review.id, { status, code, note: note || null })
      onDone()
    } catch (moderateError) {
      setError(describeApiError(moderateError))
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen) {
    return (
      <div className="mod-actions">
        <button type="button" onClick={onOpen}>Moderate</button>
        {review.status !== 'published' && (
          // Reinstating is one click, because a wrongly removed honest review is the more
          // damaging mistake and should be the easier one to undo.
          <button
            type="button"
            onClick={async () => {
              await api.admin.reviews.moderate(review.id, { status: 'published', code: null, note: 'Reinstated.' })
              onDone()
            }}
          >
            Reinstate
          </button>
        )}
      </div>
    )
  }

  return (
    <form className="mod-form" onSubmit={submit}>
      <label>
        <span>Action</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="hidden">Hide — keeps the rating, removes the text</option>
          <option value="removed">Remove — also drops it from the product&rsquo;s rating</option>
          <option value="published">Publish — leave it up</option>
        </select>
      </label>

      {status !== 'published' && (
        <label>
          <span>Reason</span>
          <select value={code} onChange={(event) => setCode(event.target.value)}>
            {MODERATION_CODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      )}

      <label>
        <span>Note <em>(internal)</em></span>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Why, for the record" />
      </label>

      {error && <p className="app-error" role="alert">{error}</p>}

      <div>
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Apply'}</button>
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}
