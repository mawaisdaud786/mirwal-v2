import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState, Pagination } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from '../api'
import './reviews.css'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'

/**
 * Real reviews on this seller's own products (GET /seller/me/reviews).
 *
 * Everything below the aggregate used to be fabricated: reviewer names and emails, a fake AI
 * sentiment breakdown ("82% Positive"), a fake "Reviews Over Time" chart, and an AI-written
 * summary describing feedback nobody had left — because there was no reviews table at all,
 * and the aggregate itself came from the mock catalogue rather than from any buyer.
 *
 * `product_reviews` is real now (migration 011) and verified-purchase only, so every row here
 * is a real review from someone who actually bought and received the product. What is still
 * deliberately absent: replying to a review, "helpful" votes and sentiment analysis — none of
 * those have any backing, and a reply box that posts nowhere would be the same fake control
 * this page just stopped shipping.
 */

const Stars = ({ rating }) => (
  <span className="review-stars" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((star) => (
      <i key={star} className={`fa-solid fa-star${star <= rating ? '' : ' is-empty'}`} aria-hidden="true" />
    ))}
  </span>
)

function ReviewRow({ review }) {
  return (
    <article className="review-row">
      <header>
        <div>
          <Stars rating={review.rating} />
          <button type="button" className="review-product" onClick={() => navigateTo(`/product/${review.productSlug}`)}>
            {review.productName}
          </button>
        </div>
        <small>{new Date(review.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</small>
      </header>
      {review.title && <h3>{review.title}</h3>}
      <p>{review.body}</p>
      <footer>
        <span className="review-author">{review.author}</span>
        <span className="review-verified"><Icon name="circle-check" /> Verified purchase</span>
      </footer>
    </article>
  )
}

const Reviews = () => {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [needsAttention, setNeedsAttention] = useState(false)

  /**
   * Paged by the server, with the one filter that matters.
   *
   * "Needs attention" is the one- and two-star reviews. It is a separate flag rather than a
   * rating dropdown because a seller opening this page is almost always answering a complaint,
   * not browsing by star count.
   */
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.seller.reviews({ page, pageSize: perPage, ...(needsAttention ? { needsAttention: true } : {}) }, signal),
    [page, perPage, needsAttention],
  )

  return <SellerLayout activeItem="reviews" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Reviews' }]}>
    <div className="reviews-container">
      <div className="reviews-header">
        <div><h1>Product Reviews</h1><p>Real reviews from buyers who received your products.</p></div>
      </div>

      {isLoading && <LoadingState label="Loading reviews" />}
      {error && !isLoading && <ErrorState title="We could not load your reviews" description={describeApiError(error)} onRetry={refetch} />}

      {data && <>
        <div className="review-stats">
          <article>
            <span className="review-stat-icon orange"><Icon name="star" /></span>
            <span>Average Rating</span>
            <strong>{data.summary.count > 0 ? data.summary.average.toFixed(1) : '—'}</strong>
            <small>{data.summary.count > 0 ? `Across ${data.summary.count} review${data.summary.count === 1 ? '' : 's'}` : 'No reviews yet'}</small>
          </article>
          <article>
            <span className="review-stat-icon blue"><Icon name="comment" /></span>
            <span>Total Reviews</span>
            <strong>{data.summary.count}</strong>
            <small>All verified purchases</small>
          </article>
          <article>
            <span className="review-stat-icon red"><Icon name="triangle-exclamation" /></span>
            <span>Needs Attention</span>
            <strong>{data.summary.needsAttention}</strong>
            <small>Rated 2 stars or below</small>
          </article>
        </div>

        {/* The one filter worth having: a seller opening this page is usually answering a
            complaint rather than browsing by star count. */}
        <div className="review-filters">
          <button type="button" className={needsAttention ? '' : 'active'} aria-pressed={!needsAttention} onClick={() => { setNeedsAttention(false); setPage(1) }}>
            All reviews ({data.summary.count})
          </button>
          <button type="button" className={needsAttention ? 'active' : ''} aria-pressed={needsAttention} onClick={() => { setNeedsAttention(true); setPage(1) }}>
            Needs attention ({data.summary.needsAttention})
          </button>
        </div>

        {data.reviews.length === 0
          ? <EmptyState
              icon={<Icon name="star" />}
              title={needsAttention ? 'Nothing needs attention' : 'No reviews yet'}
              text={needsAttention
                ? 'No review of your products is rated two stars or below.'
                : 'A buyer can leave a review once their order has been delivered. Reviews for your products will appear here.'}
            />
          : (
            <>
              <div className="review-list">{data.reviews.map((review) => <ReviewRow key={review.id} review={review} />)}</div>
              <Pagination
                currentPage={data.pagination.page}
                totalPages={data.pagination.totalPages}
                perPage={data.pagination.pageSize}
                total={data.pagination.total}
                onPageChange={setPage}
                onPerPageChange={(size) => { setPerPage(size); setPage(1) }}
              />
            </>
          )}
      </>}
    </div>
  </SellerLayout>
}

export default Reviews
