import { Link, useParams } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'
import SEOHead from './components/SEOHead'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from './api'

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

export default function DealPage() {
  const { dealSlug } = useParams()
  const { data: product, error, isLoading, refetch } = useApiQuery((signal) => api.products.get(dealSlug, signal), [dealSlug])

  if (isLoading) return <LoadingState label="Loading deal" />
  if (error && error.code !== 'PRODUCT_NOT_FOUND') {
    return <ErrorState title="We could not load this deal" description={describeApiError(error)} onRetry={refetch} />
  }
  // A product that exists but carries no discount isn't a deal — same 404 as a missing slug.
  if (!product || !product.compareAtPrice) return <NotFoundPage />

  const image = product.images[0]
  const description = `${product.name} on offer at Mirwal. Compare this deal with other marketplace options.`
  return <main className="deal-detail-page container">
    <SEOHead title={`${product.name} deal | Mirwal`} description={description} image={image?.url} />
    <nav aria-label="Breadcrumb"><Link to="/">Home</Link><Icon name="chevron-right" /><Link to="/deals">Deals</Link><Icon name="chevron-right" /><span aria-current="page">{product.name}</span></nav>
    <article className="deal-detail-card">
      <img src={image?.url} alt={image?.alt ?? product.name} />
      <div>
        <span className="deal-detail-badge">{product.discountPercent}% OFF</span>
        <small>{product.subtitle}</small>
        <h1>{product.name}</h1>
        <p>{product.rating.count > 0 ? <><Icon name="star" /> {product.rating.average.toFixed(1)}</> : 'No reviews yet'}</p>
        <strong>{product.price.display}</strong> <del>{product.compareAtPrice.display}</del>
        <p>This offer is currently listed in the Mirwal marketplace. Review seller and delivery details before checkout.</p>
        <Link className="deal-detail-action" to={`/product/${product.slug}`}>View product <Icon name="arrow-right" /></Link>
      </div>
    </article>
  </main>
}
