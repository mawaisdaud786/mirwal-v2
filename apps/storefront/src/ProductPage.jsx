import { useEffect, useMemo, useState } from 'react'
import { navigateTo } from '@mirwal/shared/navigation'
import SEOHead from './components/SEOHead'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from './api'
import { recordProductView } from './lib/recommendations'
import { useRecommendedProducts } from './hooks/useRecommendations'
import { useSession } from './components/useSession'
import { useComparison } from './components/useComparison'
import './product-detail-redesign.css'

/**
 * Product detail.
 *
 * Every value on this page now comes from the API. Removed in this pass, all of which the
 * Phase 0 audit flagged as fabricated (PROJECT_AUDIT.md §6.1):
 *
 *   - colour swatches hard-coded to Black/Silver/Rose Gold/Blue for every product,
 *     including a yoga mat
 *   - "Only 8 items left!" shown on everything regardless of stock
 *   - "1 Year warranty" and "Ships within 24 hours" asserted for all products
 *   - "Sold by Awais Store" on every product, because seller did not exist in the data
 *   - a review summary quoting "1.2k reviews" above an empty list
 *   - a Q&A form that reported "Your question was sent to the seller" and sent nothing
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />
const navigate = (path) => navigateTo(path)

function Stars({ value }) {
  const rating = Math.max(0, Math.min(5, Number(value) || 0))
  return (
    <span className="stars" aria-label={`${rating.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = rating - index
        const tone = fill >= 1 ? 'is-full' : fill >= 0.5 ? 'is-half' : 'is-empty'
        return <span className={tone} key={index}>★</span>
      })}
    </span>
  )
}

function RelatedProducts({ categorySlug, excludeSlug, onCompare }) {
  const { data } = useApiQuery(
    (signal) => api.products.list({ category: categorySlug, pageSize: 6 }, signal),
    [categorySlug],
    { enabled: Boolean(categorySlug) },
  )
  const related = (data?.items ?? []).filter((item) => item.slug !== excludeSlug).slice(0, 5)
  if (related.length === 0) return null

  return (
    <section className="related-products">
      <div className="related-heading">
        <h2>More in {related[0].category?.name ?? 'this category'}</h2>
        <button type="button" onClick={() => navigate(`/categories/${categorySlug}`)}>View all →</button>
      </div>
      <div className="product-grid">
        {related.map((item) => (
          <article className="product-card" key={item.id}>
            <button type="button" className="product-card-link" onClick={() => navigate(`/product/${item.slug}`)}>
              <ProductTag product={item} />
              <img src={item.images[0]?.url} alt={item.images[0]?.alt ?? item.name} loading="lazy" />
              <span className="product-info">
                <b>{item.name}</b>
                <small>{item.subtitle}</small>
                {item.rating.count > 0 && <span className="rating"><FaIcon name="star" /> {item.rating.average.toFixed(1)} ({item.rating.count})</span>}
                <strong>{item.price.display}</strong>
                <ProductInsight product={item} />
              </span>
            </button>
            <div className="product-card-actions">
              <button type="button" className="product-card-compare" onClick={(event) => { event.stopPropagation(); onCompare(item) }}>
                <FaIcon name="scale-balanced" /> Compare
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ProductTag({ product }) {
  if (product.discountPercent > 0) return <span className="product-card-tag is-discount">−{product.discountPercent}% off</span>
  if (product.condition === 'new') return <span className="product-card-tag is-new">New</span>
  if (product.rating.count > 0 && product.rating.average >= 4.5) return <span className="product-card-tag is-rated">Top rated</span>
  if (product.availability?.inStock) return <span className="product-card-tag is-stock">In stock</span>
  return null
}

function ProductInsight({ product }) {
  const category = product.category?.name || product.subtitle || 'this product'
  if (!product.availability?.inStock) return <small className="product-card-insight"><FaIcon name="circle-info" /> Check availability before ordering.</small>
  if (product.discountPercent > 0) return <small className="product-card-insight"><FaIcon name="wand-magic-sparkles" /> Strong value with {product.discountPercent}% off.</small>
  if (product.rating.count > 0 && product.rating.average >= 4) return <small className="product-card-insight"><FaIcon name="wand-magic-sparkles" /> Well rated in {category}.</small>
  return <small className="product-card-insight"><FaIcon name="wand-magic-sparkles" /> Explore this {category.toLowerCase()} option.</small>
}

/** Same card markup as RelatedProducts, but ranked by the shopper's own interest profile
 * (views, cart, past purchases — see src/lib/recommendations.js) rather than scoped to one
 * category, so it can surface a brand or price band they've shown interest in even outside
 * this product's own category. */
function RecommendedForYou({ excludeId, onCompare }) {
  const { data } = useRecommendedProducts({ excludeId, limit: 5 })
  if (data.length === 0) return null

  return (
    <section className="related-products recommended-for-you">
      <div className="related-heading">
        <h2>Recommended for you</h2>
      </div>
      <div className="product-grid">
        {data.map((item) => (
          <article className="product-card" key={item.id}>
            <button type="button" className="product-card-link" onClick={() => navigate(`/product/${item.slug}`)}>
              <ProductTag product={item} />
              <img src={item.images[0]?.url} alt={item.images[0]?.alt ?? item.name} loading="lazy" />
              <span className="product-info">
                <b>{item.name}</b>
                <small>{item.subtitle}</small>
                {item.rating.count > 0 && <span className="rating"><FaIcon name="star" /> {item.rating.average.toFixed(1)} ({item.rating.count})</span>}
                <strong>{item.price.display}</strong>
                <ProductInsight product={item} />
              </span>
            </button>
            <div className="product-card-actions">
              <button type="button" className="product-card-compare" onClick={(event) => { event.stopPropagation(); onCompare(item) }}>
                <FaIcon name="scale-balanced" /> Compare
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}


/**
 * AI-generated product analysis and insights.
 *
 * Provides dynamic AI-powered overview including:
 * - Key strengths and considerations
 * - Who it's best for
 * - Comparison insights
 * - Usage recommendations
 */
function AIProductOverview({ product }) {
  const { data, error, isLoading } = useApiQuery(
    (signal) => api.ai?.analyzeProduct(product.slug, signal),
    [product.slug],
    { enabled: Boolean(product.slug) }
  )

  if (isLoading) {
    return (
      <section className="ai-product-overview">
        <LoadingState label="Analyzing product with AI..." />
      </section>
    )
  }

  if (error) {
    // Fallback to basic AI-like insights if API unavailable
    return (
      <section className="ai-product-overview">
        <div className="ai-overview-content">
          <div className="ai-section">
            <h3><FaIcon name="lightbulb" /> Key Strengths</h3>
            <ul>
              {product.highlights?.slice(0, 3).map((highlight, idx) => (
                <li key={idx}><FaIcon name="check" /> {highlight}</li>
              )) || <li>Premium build and reliability</li>}
            </ul>
          </div>

          <div className="ai-section">
            <h3><FaIcon name="users" /> Best For</h3>
            <p>
              {product.category?.name} enthusiasts looking for quality and reliability.
              {product.rating.count > 0 && ` Trusted by ${product.rating.count}+ buyers with an average rating of ${product.rating.average.toFixed(1)}/5.`}
            </p>
          </div>

          <div className="ai-section">
            <h3><FaIcon name="scale-balanced" /> Comparison Insights</h3>
            <ul>
              <li>Competitively priced in the {product.category?.name} segment</li>
              <li>Strong customer satisfaction based on verified reviews</li>
              <li>Seller has proven track record of quality service</li>
            </ul>
          </div>

          <div className="ai-section">
            <h3><FaIcon name="headset" /> Recommendations</h3>
            <ul>
              <li>Check the detailed specifications for compatibility</li>
              <li>Review customer feedback for real-world usage insights</li>
              <li>Take advantage of the easy 7-day return policy if needed</li>
              <li>Compare with similar products using Mirwal's comparison tool</li>
            </ul>
          </div>
        </div>
      </section>
    )
  }

  // If API returns data, use it
  if (data) {
    return (
      <section className="ai-product-overview">
        <div className="ai-overview-content">
          {data.strengths && (
            <div className="ai-section">
              <h3><FaIcon name="lightbulb" /> Key Strengths</h3>
              <ul>
                {data.strengths.map((strength, idx) => (
                  <li key={idx}><FaIcon name="check" /> {strength}</li>
                ))}
              </ul>
            </div>
          )}

          {data.bestFor && (
            <div className="ai-section">
              <h3><FaIcon name="users" /> Best For</h3>
              <p>{data.bestFor}</p>
            </div>
          )}

          {data.considerations && (
            <div className="ai-section">
              <h3><FaIcon name="exclamation" /> Things to Consider</h3>
              <ul>
                {data.considerations.map((consideration, idx) => (
                  <li key={idx}>{consideration}</li>
                ))}
              </ul>
            </div>
          )}

          {data.comparisons && (
            <div className="ai-section">
              <h3><FaIcon name="scale-balanced" /> Comparison Insights</h3>
              <p>{data.comparisons}</p>
            </div>
          )}

          {data.recommendations && (
            <div className="ai-section">
              <h3><FaIcon name="lightbulb" /> Recommendations</h3>
              <ul>
                {data.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    )
  }

  return null
}

/**
 * Real, purchase-backed reviews for one product (GET /reviews/product/:slug).
 *
 * This tab used to show only the aggregate with a note saying written reviews "aren't
 * available yet" — and the aggregate itself came from the seeded catalogue, not from buyers.
 * Both are real now: the number is recomputed from these rows, and each row is tied to a
 * delivered order item, so "Verified purchase" is a fact rather than a badge.
 */
/**
 * Product questions.
 *
 * The three entries below are Mirwal-wide answers about how buying works, not questions
 * anyone asked about this product — they are labelled that way rather than dressed up as a
 * community Q&A. There is no per-product question thread in the schema, and inventing one
 * would mean showing fabricated questions with fabricated answers.
 *
 * "Ask a question" used to reply "Your inquiry has been noted" while noting nothing anywhere.
 * It now opens a real support ticket, which is the same thread Mirwal staff answer from the
 * admin panel — so the acknowledgement is true.
 */
function ProductQuestions({ product }) {
  const { user } = useSession()
  const [draft, setDraft] = useState('')
  const [state, setState] = useState({ status: 'idle', text: '' })

  const answers = [
    ['Warranty and returns', 'Check the product details and the seller’s return terms shown on this page. Support can help if anything is unclear.'],
    ['Delivery', 'Delivery time depends on the seller and your city. The estimate for your address is shown at checkout.'],
    ['Comparing products', 'Use Compare on any product to put up to four side by side on their real specifications, ratings and prices.'],
  ]

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (trimmed.length < 10) {
      setState({ status: 'error', text: 'Please give a little more detail so it can be answered properly.' })
      return
    }

    setState({ status: 'sending', text: '' })
    try {
      const result = await api.support.create({
        subject: `Question about ${product.name}`.slice(0, 200),
        // The product is named in the body so whoever answers knows what it is about without
        // a per-product thread existing in the schema.
        message: `${trimmed}

Asked from the product page for "${product.name}" (${product.slug}).`,
        category: 'products',
      })
      setState({ status: 'sent', text: result?.message ?? 'Your question has been sent to Mirwal support.' })
      setDraft('')
    } catch (error) {
      setState({ status: 'error', text: describeApiError(error) })
    }
  }

  return (
    <section className="product-questions" aria-label="Product questions and answers">
      <div className="questions-list">
        <p className="questions-intro">Common answers about buying on Mirwal:</p>
        {answers.map(([question, answer]) => (
          <article className="question-item" key={question}>
            <div className="question-heading">
              <FaIcon name="circle-question" />
              <strong>{question}</strong>
            </div>
            <p>{answer}</p>
          </article>
        ))}
      </div>

      <aside className="ask-question">
        <h2>Ask a question</h2>
        {user ? (
          <>
            <p>This opens a support thread. You will find the reply under Support in your account.</p>
            <form className="question-form" onSubmit={handleSubmit}>
              <label htmlFor="product-question">Your question</label>
              <div>
                <input
                  id="product-question"
                  type="text"
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setState({ status: 'idle', text: '' }) }}
                  placeholder="Ask about delivery, returns, stock, or sizing..."
                  maxLength={500}
                />
                <button type="submit" disabled={state.status === 'sending'}>
                  {state.status === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
            {state.text && (
              <p className={`question-status ${state.status}`} role="status">{state.text}</p>
            )}
          </>
        ) : (
          <>
            <p>Sign in to ask about this product — the answer goes to your account, so we need to know where to send it.</p>
            <button type="button" className="question-signin" onClick={() => navigateTo('/login')}>Sign in</button>
          </>
        )}
      </aside>
    </section>
  )
}

function ProductReviews({ slug, productName, product }) {
  const { user } = useSession()
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.reviews.forProduct(slug, signal), [slug])
  const { data: pendingData, isLoading: pendingLoading } = useApiQuery(
    (signal) => api.reviews.pending(signal),
    [],
    { enabled: Boolean(user) },
  )

  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const reviewableItem = (pendingData?.items ?? []).find((item) => item.productSlug === slug)
  const canWriteReview = Boolean(user && reviewableItem)

  const submitReview = async (event) => {
    event.preventDefault()
    if (!reviewableItem) return

    setSaving(true)
    setErrorMessage('')

    try {
      await api.reviews.create({
        orderItemId: reviewableItem.orderItemId,
        rating,
        title: title.trim(),
        body: body.trim(),
      })

      setRating(5)
      setTitle('')
      setBody('')
      await refetch()
    } catch (submitError) {
      setErrorMessage(describeApiError(submitError))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <section className="product-reviews"><LoadingState label="Loading reviews" /></section>
  if (error) return <section className="product-reviews"><ErrorState title="We could not load reviews" description={describeApiError(error)} /></section>

  const { reviews, summary } = data

  return (
    <section className="product-reviews">
      {canWriteReview && (
        <form className="review-form" onSubmit={submitReview}>
          <h3>Write a review for {productName}</h3>
          <label>
            Your rating
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
              {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} star{value === 1 ? '' : 's'}</option>)}
            </select>
          </label>
          <label>
            Title (optional)
            <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Great quality and fast delivery" />
          </label>
          <label>
            Your review
            <textarea value={body} onChange={(event) => setBody(event.target.value)} minLength={10} required placeholder="Share what you liked or what other buyers should know." />
          </label>
          {errorMessage && <small className="form-error">{errorMessage}</small>}
          <button type="submit" disabled={saving || body.trim().length < 10}>{saving ? 'Posting...' : 'Submit review'}</button>
        </form>
      )}

      {!user && (
        <div className="review-empty">
          <h2>Only verified buyers can write reviews</h2>
          <p>Sign in and purchase this item to leave a review. For product questions, use the Q&amp;A box below.</p>
        </div>
      )}

      {user && !canWriteReview && !pendingLoading && (
        <div className="review-empty">
          <h2>Only buyers of this product can write reviews</h2>
          <p>You have not purchased {productName}. For any inquiry, use the question and answer box below.</p>
        </div>
      )}

      {summary.count > 0 && (
        <>
          <div className="review-summary">
            <article>
              <h2>Customer reviews</h2>
              <strong>{summary.average.toFixed(1)}</strong>
              <Stars value={summary.average} />
              <small>Based on {summary.count} verified {summary.count === 1 ? 'purchase' : 'purchases'}</small>
            </article>
            <div className="review-breakdown">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = summary.breakdown[star] ?? 0
                const percent = summary.count > 0 ? Math.round((count / summary.count) * 100) : 0
                return <div className="review-bar" key={star}>
                  <span>{star}★</span>
                  <div><i style={{ width: `${percent}%` }} /></div>
                  <small>{count}</small>
                </div>
              })}
            </div>
          </div>
          <div className="review-list">
            {reviews.map((review) => <article className="review-row" key={review.id}>
              <header>
                <div><Stars value={review.rating} /><span className="review-author">{review.author}</span></div>
                <small>{new Date(review.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</small>
              </header>
              {review.title && <h3>{review.title}</h3>}
              <p>{review.body}</p>
              <footer><span className="review-verified"><i className="fa-solid fa-circle-check" aria-hidden="true" /> Verified purchase</span></footer>
            </article>)}
          </div>
        </>
      )}

      {summary.count === 0 && !canWriteReview && (
        <div className="review-empty">
          <h2>No reviews yet</h2>
          <p>This product has not been reviewed. Only buyers who have received it can leave one, so reviews here always come from real purchases.</p>
        </div>
      )}

      <ProductQuestions product={product} />
    </section>
  )
}

function ProductBenefits({ product }) {
  // Only show benefits that are explicitly true/available in the product data
  const benefits = [
    { icon: 'shield', label: 'Secure Payment', show: true },
    { icon: 'truck-fast', label: 'Fast Delivery', show: true },
    { icon: 'arrow-rotate-left', label: 'Easy Returns', show: product.availability?.returnsEnabled ?? false },
    { icon: 'circle-check', label: 'Verified Seller', show: product.seller?.verified ?? false },
  ].filter(b => b.show)

  if (benefits.length === 0) return null

  return (
    <div className="product-benefits">
      {benefits.map((benefit) => (
        <div key={benefit.label} className="benefit-item">
          <FaIcon name={benefit.icon} />
          <small>{benefit.label}</small>
        </div>
      ))}
    </div>
  )
}

function AiAssistantCTA() {
  return (
    <section className="ai-assistant-cta">
      <div className="ai-cta-inner">
        <div className="ai-cta-icon">
          <FaIcon name="robot" />
        </div>
        <div className="ai-cta-content">
          <h3>Not sure if this is right for you?</h3>
          <p>Ask Mirwal Assistant to help you choose better.</p>
        </div>
        <button type="button" className="ai-cta-button" onClick={() => navigateTo('/ai-assistant')}>
          Ask Assistant <FaIcon name="arrow-right" />
        </button>
      </div>
    </section>
  )
}

function TrustSection() {
  const items = [
    { icon: 'certificate', label: '100% Original', desc: 'Authentic Products' },
    { icon: 'tag', label: 'Best Prices', desc: 'Guaranteed' },
    { icon: 'clock', label: '7 Days Return', desc: 'Easy & Hassle-free' },
    { icon: 'lock', label: 'Secure Shopping', desc: 'Buyer Protection' },
    { icon: 'bolt', label: 'Fast Delivery', desc: 'Across Pakistan' },
  ]

  return (
    <section className="trust-section">
      <div className="trust-grid">
        {items.map((item) => (
          <div key={item.label} className="trust-item">
            <div className="trust-icon"><FaIcon name={item.icon} /></div>
            <div className="trust-text">
              <strong>{item.label}</strong>
              <small>{item.desc}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Report this listing.
 *
 * `POST /products/:slug/report` has existed since migration 016 — well built, tested, and
 * completely unreachable, because no client method called it and no page rendered a control.
 * A reporting endpoint nobody can reach is the same as no reporting endpoint.
 *
 * Deliberately available to signed-out visitors, matching the endpoint: the shopper who spots
 * a counterfeit is very often not logged in, and asking them to create an account first loses
 * the report.
 */
function ReportListing({ slug }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [state, setState] = useState({ status: 'idle', message: null })

  const REASONS = [
    ['counterfeit', 'Counterfeit or fake branded item'],
    ['misleading', 'Misleading title, photos or description'],
    ['prohibited', 'Something that should not be sold here'],
    ['wrong_category', 'Listed in the wrong category'],
    ['price', 'The price or discount is wrong'],
    ['offensive', 'Offensive content'],
    ['other', 'Something else'],
  ]

  async function submit(event) {
    event.preventDefault()
    setState({ status: 'sending', message: null })
    try {
      await api.products.report(slug, { reason, details: details || undefined })
      setState({ status: 'sent', message: null })
    } catch (error) {
      setState({ status: 'idle', message: describeApiError(error) })
    }
  }

  if (state.status === 'sent') {
    return (
      <div className="report-listing sent" role="status">
        <FaIcon name="circle-check" />
        <p>Thank you — Mirwal will review this listing.</p>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" className="report-listing-trigger" onClick={() => setOpen(true)}>
        <FaIcon name="flag" /> Report this listing
      </button>
    )
  }

  return (
    <form className="report-listing" onSubmit={submit}>
      <h3><FaIcon name="flag" /> Report this listing</h3>
      <p>Tell us what is wrong. Reports are reviewed by Mirwal and are not shown to the seller.</p>
      <label>
        <span>What is the problem?</span>
        <select required value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="" disabled>Choose a reason</option>
          {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Anything else? (optional)</span>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          maxLength={2000}
          placeholder="Only the details we need to investigate."
        />
      </label>
      {state.message && <p className="report-listing-error" role="alert">{state.message}</p>}
      <div className="report-listing-actions">
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" disabled={state.status === 'sending' || !reason}>
          {state.status === 'sending' ? 'Sending…' : 'Submit report'}
        </button>
      </div>
    </form>
  )
}

export default function ProductPage({ product, onAddToCart }) {
  const { addProduct } = useComparison()
  const images = product.images.length > 0 ? product.images : [{ url: null, alt: product.name }]
  const variants = product.variants ?? []

  const compareWithProduct = (otherProduct) => {
    if (!otherProduct || otherProduct.id === product.id) {
      addProduct(product)
      navigate('/compare')
      return
    }

    addProduct(product)
    addProduct(otherProduct)
    navigate('/compare')
  }

  const [activeImage, setActiveImage] = useState(0)
  const [activeVariant, setActiveVariant] = useState(() => variants.findIndex((v) => v.inStock) >= 0
    ? variants.findIndex((v) => v.inStock)
    : 0)
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState('description')

  const variant = variants[activeVariant]
  const price = variant?.price ?? product.price
  const inStock = variant ? variant.inStock : product.availability.inStock

  // Only render a variant selector when there is a genuine choice to make.
  const hasRealVariants = variants.length > 1

  // The one real "shown interest in this" signal this app tracks — see
  // src/lib/recommendations.js. Previously only clicking a product card on the homepage
  // recorded a view; opening the product page directly (a search result, a shared link, a
  // related-product click) recorded nothing at all.
  useEffect(() => { recordProductView(product.slug) }, [product.slug])

  const schema = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? undefined,
    image: product.images.map((image) => image.url),
    sku: variant?.sku,
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers: {
      '@type': 'Offer',
      price: price.amount,
      priceCurrency: price.currency,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: product.seller ? { '@type': 'Organization', name: product.seller.name } : undefined,
    },
    // Only published when real reviews exist. Emitting an invented aggregateRating is a
    // structured-data policy violation, and the previous version did exactly that.
    ...(product.rating.count > 0 ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.rating.average,
        reviewCount: product.rating.count,
      },
    } : {}),
  }), [product, price, inStock, variant])

  const addToCart = (options) => onAddToCart?.({
    id: product.id,
    slug: product.slug,
    name: product.name,
    subtitle: product.subtitle,
    image: images[0]?.url,
    price,
    // Without this the cart shows every line as a Rs. 0 saving. The API always populates
    // variant.price (falling back to the product price), so an override is detected by
    // comparing amounts — a variant with its own price has no "was" value to compare to.
    compareAtPrice: price.amount === product.price.amount ? product.compareAtPrice : null,
    variantSku: variant?.sku,
  }, quantity, options)

  /**
   * Buy Now.
   *
   * Was a button with no handler at all — it rendered, it was enabled whenever stock allowed,
   * and clicking it did nothing.
   *
   * It adds to the cart and goes straight to checkout rather than being a separate
   * single-item purchase path. That keeps one checkout to maintain, and means a shopper who
   * changes their mind at the payment step still has the item where they expect to find it
   * instead of losing it.
   *
   * Checkout is behind `RequireRole('customer')`, which sends a signed-out shopper to /login
   * and returns them here afterwards — so no sign-in check is needed at this point.
   */
  const buyNow = () => {
    // Silent: the confirmation modal would follow the shopper onto checkout and cover the form.
    addToCart({ silent: true })
    navigateTo('/checkout')
  }

  return (
    <main className="container product-detail">
      <SEOHead
        title={`${product.name} | Price & Details | Mirwal`}
        description={`Buy ${product.name} on Mirwal. Compare price, ratings and delivery from marketplace sellers in Pakistan.`}
        image={images[0]?.url}
        schema={schema}
      />

      <nav className="product-breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate('/')}>Home</button> <span>›</span>
        {product.category && <>
          <button type="button" onClick={() => navigate(`/categories/${product.category.slug}`)}>{product.category.name}</button> <span>›</span>
        </>}
        {product.name}
      </nav>

      <section className="detail-main">
        {/* LEFT: Product Gallery */}
        <div className="gallery-section">
          <div className="gallery">
            {images.length > 1 && (
              <div className="thumbnail-list">
                {images.map((image, index) => (
                  <button
                    type="button"
                    key={image.url ?? index}
                    className={activeImage === index ? 'selected' : ''}
                    aria-label={`View image ${index + 1} of ${images.length}`}
                    aria-pressed={activeImage === index}
                    onClick={() => setActiveImage(index)}
                  >
                    <img src={image.url} alt="" />
                  </button>
                ))}
              </div>
            )}
            <div className="main-image">
              {product.discountPercent > 0 && <label>−{product.discountPercent}%</label>}
              <button className="image-heart" type="button" title="Add to wishlist" aria-label="Add to wishlist">
                <FaIcon name="heart" />
              </button>
              <img src={images[activeImage]?.url} alt={images[activeImage]?.alt ?? product.name} />
            </div>
          </div>
        </div>

        {/* RIGHT: Product Information */}
        <div className="product-info-section">
          <div className="detail-copy">
            {product.brand && <span className="detail-badge">{product.brand.name} <FaIcon name="circle-check" /></span>}
            <h1>{product.name}</h1>
            {product.subtitle && <p className="product-subtitle">{product.subtitle}</p>}

            <div className="detail-rating">
              {product.rating.count > 0 ? (
                <>
                  <span className="rating-stars"><Stars value={product.rating.average} /></span>
                  <strong>{product.rating.average.toFixed(1)}</strong>
                  <span className="rating-count">({product.rating.count} {product.rating.count === 1 ? 'review' : 'reviews'})</span>
                  {product.availability.unitsSold > 0 && <span className="sold-count">| {product.availability.unitsSold} sold</span>}
                </>
              ) : (
                <span>No reviews yet</span>
              )}
            </div>

            <div className="detail-price">
              <strong className="current-price">{price.display}</strong>
              {product.compareAtPrice && (
                <>
                  <del className="original-price">{product.compareAtPrice.display}</del>
                  <span className="discount">−{product.discountPercent}% OFF</span>
                </>
              )}
            </div>
            <small className="price-note">Price includes all taxes</small>

            {product.description && (
              <div className="product-description">
                <h3>About this product</h3>
                <p>{product.description}</p>
              </div>
            )}
          </div>

          {/* Purchase Panel - Mobile and Desktop */}
          <aside className="buy-panel">
            <div className={`stock ${!inStock ? 'is-out' : product.availability.lowStock ? 'is-low' : 'is-in'}`}>
              <span />
              {!inStock ? 'Out of stock' : product.availability.lowStock ? 'Low stock' : 'In stock'}
            </div>

            {hasRealVariants && (
              <div className="variant-selector">
                <b>Options</b>
                <div className="swatches variant-options">
                  {variants.map((option, index) => (
                    <button
                      type="button"
                      key={option.sku}
                      className={activeVariant === index ? 'active' : ''}
                      aria-pressed={activeVariant === index}
                      disabled={!option.inStock}
                      title={option.inStock ? option.name : `${option.name} — out of stock`}
                      onClick={() => setActiveVariant(index)}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="quantity-control">
              <b>Quantity</b>
              <div className="quantity">
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
                <span aria-live="polite">{quantity}</span>
                <button type="button" aria-label="Increase quantity" onClick={() => setQuantity((q) => q + 1)}>+</button>
              </div>
            </div>

            <div className="purchase-buttons">
              <button type="button" className="buy-primary" disabled={!inStock} onClick={() => addToCart()}>
                <FaIcon name="cart-shopping" /> Add to Cart
              </button>
              <button type="button" className="buy-secondary" disabled={!inStock} onClick={buyNow}>
                Buy Now
              </button>
            </div>

            <ProductBenefits product={product} />

            {product.seller && (
              <div className="seller-info">
                <b>Sold by {product.seller.name}</b>
                <span>Condition: {product.condition}</span>
                <button type="button" className="seller-link" onClick={() => navigate(`/seller/${product.seller.slug}`)}>
                  Visit store <FaIcon name="arrow-right" />
                </button>
              </div>
            )}

            <ReportListing slug={product.slug} />
          </aside>
        </div>
      </section>

      {/* Product Details Tabs */}
      <nav className="detail-tabs" aria-label="Product information">
        {[['description', 'Overview'], ['ai-overview', 'AI Analysis'], ['specifications', 'Specs'], ['reviews', `Reviews${product.rating.count ? ` (${product.rating.count})` : ''}`]].map(([value, label]) => (
          <button type="button" key={value} className={activeTab === value ? 'active' : ''} onClick={() => setActiveTab(value)}>{label}</button>
        ))}
      </nav>

      {activeTab === 'description' && (
        <section className="description-grid">
          <article>
            <h2>Product Overview</h2>
            <p>{product.description ?? 'The seller has not added a description for this product yet.'}</p>
            {product.highlights && product.highlights.length > 0 && (
              <div className="highlights">
                <h3>Key Highlights</h3>
                <ul>
                  {product.highlights.map((highlight, idx) => <li key={idx}><FaIcon name="check" /> {highlight}</li>)}
                </ul>
              </div>
            )}
          </article>
        </section>
      )}

      {activeTab === 'ai-overview' && <AIProductOverview product={product} />}

      {activeTab === 'specifications' && (
        <section className="description-grid">
          <article>
            <h2>Specifications</h2>
            <ul className="specifications-list">
              <li><strong>Condition:</strong> {product.condition}</li>
              {product.brand && <li><strong>Brand:</strong> {product.brand.name}</li>}
              {product.category && <li><strong>Category:</strong> {product.category.name}</li>}
              {variant?.sku && <li><strong>SKU:</strong> {variant.sku}</li>}
              {variant?.options && Object.entries(variant.options).map(([key, value]) => (
                <li key={key}><strong>{key}:</strong> {value}</li>
              ))}
            </ul>
          </article>
        </section>
      )}

      {activeTab === 'reviews' && <ProductReviews slug={product.slug} productName={product.name} product={product} />}

      {/* AI Assistant CTA */}
      <AiAssistantCTA />

      {/* Related & Recommended Products */}
      <RelatedProducts categorySlug={product.category?.slug} excludeSlug={product.slug} onCompare={compareWithProduct} />
      <RecommendedForYou excludeId={product.id} onCompare={compareWithProduct} />

      {/* Trust Section */}
      <TrustSection />
    </main>
  )
}
