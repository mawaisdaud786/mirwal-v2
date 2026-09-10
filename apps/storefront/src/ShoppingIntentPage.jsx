import { Link, useParams } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'
import SEOHead from './components/SEOHead'
import PromoBanner from './components/PromoBanner'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from './api'
import './shopping-intents.css'

/**
 * "Problem to solution" shopping guides (`/shopping/:intentSlug`).
 *
 * The curated title/problem/solution copy per intent is genuinely editorial content, not a
 * factual claim about the catalogue, so it stays as static local content rather than something
 * pulled from a database that doesn't have an equivalent concept. What's converted is the
 * product matching: it used to filter the mock array with `product.type.includes(term)` and a
 * mock `product.category` name; it's a real catalog query now (`q` full-text search, real
 * category slugs).
 *
 * `home-office-setup` maps to two terms ("laptop", "mouse"). The catalog's full-text `q` filter
 * requires every word to match the same product (`+laptop* +mouse*` in boolean mode), which
 * would wrongly return zero results for a product that is only a laptop, or only a mouse —
 * the terms are meant as alternatives, not requirements of one product. Each term is queried
 * separately and the results are merged, matching the mock version's `.some(term => ...)` OR
 * semantics instead of silently becoming an AND.
 */

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const intents = {
  'gaming-laptop': { title: 'Gaming laptops for your next session', problem: 'You need a laptop that can keep up with demanding games and everyday work.', solution: 'Start with performance, then compare display, memory, storage and price to find a practical fit.', terms: ['laptop'], categorySlug: 'mobile-and-tech-accessories', guide: '/guides/top-gadgets-for-everyday-life' },
  'student-laptop': { title: 'Student laptops for study and work', problem: 'You need dependable performance, portability and value for classes, research and projects.', solution: 'Focus on battery, weight, keyboard comfort and enough memory for the tools you use every day.', terms: ['laptop'], categorySlug: 'mobile-and-tech-accessories', guide: '/guides/smart-shopping-tips' },
  'home-office-setup': { title: 'A practical home office setup', problem: 'You want a comfortable, productive workspace without buying more than you need.', solution: 'Build around your daily tasks, then compare the technology and accessories that make work easier.', terms: ['laptop', 'mouse'], categorySlug: 'mobile-and-tech-accessories', guide: '/guides/top-gadgets-for-everyday-life' },
  'kitchen-storage-solutions': { title: 'Solutions for a small kitchen', problem: 'Limited space makes it harder to keep cooking tools and appliances organised.', solution: 'Choose compact, multi-purpose products and compare dimensions before ordering.', terms: ['appliance'], categorySlug: 'kitchen-and-small-appliances', guide: '/guides/upgrade-your-home-on-a-budget' },
}

function ProductCard({ product }) {
  const image = product.images[0]
  return (
    <article className="intent-product">
      <Link to={`/product/${product.slug}`}>
        <img src={image?.url} alt={image?.alt ?? product.name} loading="lazy" />
        <span>{product.subtitle}</span>
        <h3>{product.name}</h3>
        <p>{product.rating.count > 0 ? <><Icon name="star" /> {product.rating.average.toFixed(1)}</> : 'No reviews yet'}</p>
        <strong>{product.price.display}</strong>
      </Link>
      <Link className="intent-compare" to={`/compare?product=${product.slug}`}><Icon name="scale-balanced" /> Compare</Link>
    </article>
  )
}

export default function ShoppingIntentPage() {
  const { intentSlug } = useParams()
  const intent = intents[intentSlug]

  const { data } = useApiQuery(
    (signal) => Promise.all(
      (intent.terms.length ? intent.terms : [undefined]).map((term) =>
        api.products.list({ q: term, category: intent.categorySlug, pageSize: 8 }, signal)),
    ).then((results) => {
      const seen = new Map()
      for (const result of results) for (const product of result.items) seen.set(product.id, product)
      return [...seen.values()].slice(0, 8)
    }),
    [intentSlug],
    { enabled: Boolean(intent) },
  )
  const matched = data ?? []
  // The one real product this intent's own catalog mapping actually returns first — never
  // a fixed image, since intent.terms is editorial copy but the match itself is a real query.
  const spotlight = matched[0] ?? null

  if (!intent) return <NotFoundPage />

  return (
    <main className="shopping-intent-page">
      <SEOHead title={`${intent.title} | Mirwal`} description={`${intent.problem} ${intent.solution}`} />
      <div className="shopping-intent-container">
        <nav aria-label="Breadcrumb"><Link to="/">Home</Link><Icon name="chevron-right" /><Link to="/guides">Shopping guides</Link><Icon name="chevron-right" /><span aria-current="page">{intent.title}</span></nav>

        <header className="intent-header">
          <span>PROBLEM TO SOLUTION SHOPPING</span>
          <h1>{intent.title}</h1>
          <p>{intent.problem}</p>
        </header>

        <PromoBanner
          eyebrow="A place to start"
          title={spotlight ? spotlight.name : intent.title}
          subtitle={spotlight ? `${spotlight.price.display}${spotlight.rating.count > 0 ? ` · ${spotlight.rating.average.toFixed(1)} (${spotlight.rating.count})` : ''}` : intent.solution}
          ctaLabel={spotlight ? 'View product' : 'Explore products'}
          onCta={() => navigateTo(spotlight ? `/product/${spotlight.slug}` : `/explore?category=${encodeURIComponent(intent.categorySlug)}`)}
          image={spotlight?.images[0]?.url}
          imageAlt={spotlight?.images[0]?.alt ?? spotlight?.name}
        />

        <section className="intent-flow" aria-label="Shopping intent">
          <article><span>01</span><h2>The need</h2><p>{intent.problem}</p></article>
          <Icon name="arrow-right" />
          <article><span>02</span><h2>A useful approach</h2><p>{intent.solution}</p></article>
          <Icon name="arrow-right" />
          <article><span>03</span><h2>Compare and choose</h2><p>Review the shortlist, open product details and compare the options side by side.</p></article>
        </section>

        <section className="intent-actions">
          <div><h2>Want a more personal shortlist?</h2><p>Describe your situation to Mirwal AI. The AI service will be connected when the backend is available.</p></div>
          <Link to="/ai-shopping">Ask Mirwal AI <Icon name="arrow-right" /></Link>
        </section>

        <section className="intent-products">
          <div className="intent-section-heading">
            <div><span>START WITH THESE OPTIONS</span><h2>Relevant products</h2><p>{matched.length} products match this intent's current catalogue mapping.</p></div>
            <Link to={`/explore?category=${encodeURIComponent(intent.categorySlug)}`}>Refine results <Icon name="arrow-right" /></Link>
          </div>
          {matched.length ? (
            <div className="intent-product-grid">{matched.map((product) => <ProductCard product={product} key={product.id} />)}</div>
          ) : (
            <div className="intent-empty"><Icon name="box-open" /><h2>No mapped products yet</h2><p>Browse the full marketplace while this intent is connected to more catalogue data.</p><Link to="/explore">Explore products</Link></div>
          )}
        </section>

        <section className="intent-guide">
          <div><span>HELPFUL READING</span><h2>Go deeper before you choose</h2><p>Use practical guidance to understand trade-offs, then return to the marketplace when you are ready to compare.</p></div>
          <Link to={intent.guide}>Read the guide <Icon name="arrow-right" /></Link>
        </section>
      </div>
    </main>
  )
}
