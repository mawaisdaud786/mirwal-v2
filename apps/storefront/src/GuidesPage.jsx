import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'
import SEOHead from './components/SEOHead'
import PromoBanner from './components/PromoBanner'
import { navigateTo } from '@mirwal/shared/navigation'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from './api'
import './guides.css'

/**
 * Shopping guides — editorial content, not catalogue data, so `guides` stays local. Only
 * `RelatedProducts` (a mock `products.slice(0, 4)`) is converted, to real recommended products.
 */

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const guides = [
  { title: '10 Smart Shopping Tips to Save Money Online', slug: 'smart-shopping-tips', category: 'Shopping Guide', excerpt: 'Learn how to compare offers, use budgets wisely and get more value from every purchase.', date: '2025-05-18', read: '5 min read', image: 'https://images.unsplash.com/photo-1586880244406-556ebe35f282?w=900&q=85', body: ['Good shopping starts before you add an item to your cart. Compare the full price, seller information, delivery terms and return policy together.', 'Use Mirwal to narrow your search by product type, price and rating. A short, comparable list is more useful than an endless catalogue.', 'Before checkout, review the final total and choose the option that best fits your needs rather than simply the biggest discount.'] },
  { title: 'Top Gadgets for Work and Everyday Life', slug: 'top-gadgets-for-everyday-life', category: 'Tech & Gadgets', excerpt: 'Explore useful technology that makes work, communication and daily routines simpler.', date: '2025-05-15', read: '6 min read', image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=900&q=85', body: ['The best gadget is the one that solves a real problem in your day. Start with the task, then compare the features that support it.', 'Look for durable design, practical compatibility and clear warranty information. Ratings can help, but the details should make the final decision.'] },
  { title: 'Easy Ways to Upgrade Your Home on a Budget', slug: 'upgrade-your-home-on-a-budget', category: 'Home & Lifestyle', excerpt: 'Simple, affordable ideas to make your home more comfortable and useful.', date: '2025-05-12', read: '4 min read', image: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=900&q=85', body: ['Small improvements can change how a space feels and works. Begin with the areas you use most and choose upgrades that remove daily friction.', 'Compare dimensions, materials and maintenance needs before buying. Practical details are what make a budget upgrade last.'] },
]

function GuideCard({ guide }) {
  return (
    <Link className="guide-card" to={`/guides/${guide.slug}`}>
      <img src={guide.image} alt="" loading="lazy" />
      <div>
        <span>{guide.category}</span>
        <h2>{guide.title}</h2>
        <p>{guide.excerpt}</p>
        <small><Icon name="calendar-days" /> {guide.date} <Icon name="clock" /> {guide.read}</small>
      </div>
    </Link>
  )
}

function RelatedProducts() {
  const { data } = useApiQuery((signal) => api.products.list({ sort: 'recommended', pageSize: 4 }, signal), [])
  const items = data?.items ?? []
  if (!items.length) return null
  return (
    <section className="guide-products">
      <div className="guide-section-heading"><h2>Related products</h2><Link to="/explore">Browse all <Icon name="arrow-right" /></Link></div>
      <div>
        {items.map((product) => (
          <Link to={`/product/${product.slug}`} key={product.id}>
            <img src={product.images[0]?.url} alt={product.name} loading="lazy" />
            <span>{product.name}<strong>{product.price.display}</strong></span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function GuidesPage() {
  const { guideSlug } = useParams()
  const [query, setQuery] = useState('')
  const selected = guides.find((guide) => guide.slug === guideSlug)
  const filtered = useMemo(() => guides.filter((guide) => `${guide.title} ${guide.category} ${guide.excerpt}`.toLowerCase().includes(query.toLowerCase())), [query])

  if (guideSlug && !selected) return <NotFoundPage />

  return (
    <main className="guides-page">
      <SEOHead
        title={selected ? `${selected.title} | Mirwal Guides` : 'Shopping Guides | Mirwal'}
        description={selected?.excerpt || 'Practical shopping guides to help you compare products and choose with confidence on Mirwal.'}
        image={selected?.image}
      />
      <div className="guides-container">
        <nav className="guides-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link><Icon name="chevron-right" /><Link to="/guides">Guides</Link>
          {selected && <><Icon name="chevron-right" /><span aria-current="page">{selected.title}</span></>}
        </nav>

        {selected ? (
          <article className="guide-detail">
            <img className="guide-cover" src={selected.image} alt="" />
            <span>{selected.category} · {selected.read}</span>
            <h1>{selected.title}</h1>
            <p className="guide-excerpt">{selected.excerpt}</p>
            <small>Published {selected.date} · Mirwal Editorial</small>
            <div className="guide-detail-layout">
              <div>
                <h2>In this guide</h2>
                <ol>{selected.body.map((paragraph, index) => <li key={paragraph}><a href={`#guide-section-${index + 1}`}>Section {index + 1}</a></li>)}</ol>
                {selected.body.map((paragraph, index) => (
                  <section id={`guide-section-${index + 1}`} key={paragraph}>
                    <h2>{index === 0 ? 'Start with what matters' : index === 1 ? 'Compare the details' : 'Choose with confidence'}</h2>
                    <p>{paragraph}</p>
                  </section>
                ))}
              </div>
              <aside>
                <h2>Shop the guide</h2>
                <p>Turn practical advice into a shortlist of products to compare.</p>
                <Link className="guide-cta" to="/explore">Explore products <Icon name="arrow-right" /></Link>
              </aside>
            </div>
            <RelatedProducts />
          </article>
        ) : (
          <>
            <header className="guides-heading">
              <div>
                <span>PRACTICAL SHOPPING KNOWLEDGE</span>
                <h1>Shopping guides for better decisions</h1>
                <p>Useful, concise advice to help you compare products, understand trade-offs and shop with confidence.</p>
              </div>
              <label><Icon name="magnifying-glass" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search guides" aria-label="Search guides" /></label>
            </header>
            <PromoBanner
              eyebrow="Not sure where to start?"
              title="Turn advice into a shortlist"
              subtitle="Compare real products, prices and ratings on Mirwal while you read."
              ctaLabel="Explore products"
              onCta={() => navigateTo('/explore')}
            />
            <section className="guides-list">
              <div className="guide-section-heading"><h2>Latest guides</h2><span>{filtered.length} guides</span></div>
              {filtered.length ? filtered.map((guide) => <GuideCard guide={guide} key={guide.slug} />) : <div className="guides-empty"><Icon name="book-open" /><h2>No guides found</h2><p>Try another topic.</p></div>}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
