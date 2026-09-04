import { useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './ai-pages.css'
import './finance-pages.css'

/**
 * Mirwal AI: overview, shopping queries, recommendations, comparisons and analytics.
 *
 * These five pages were fabricated — invented queries attributed to real-looking names, fake
 * click-through rates — and were then correctly collapsed to a not-connected state, because
 * nothing recorded what a shopper searched for.
 *
 * Migration 018 adds `search_queries`, and the catalogue search and assistant both write to
 * it. Everything below is counted from those rows.
 *
 * What deliberately did NOT get built: a per-shopper profile. The table records the search,
 * how many results it returned and whether a product was opened. It stores no IP address, no
 * user agent and no session id, so an anonymous search stays anonymous and no visitor is
 * stitched together across searches. That is why there is no "user journey" screen here.
 *
 * "Recommendations" means co-occurrence in real baskets — the products most often bought in
 * the same order. It is a count, not a model, so an empty marketplace produces an empty list
 * rather than plausible noise.
 */

const RANGE_OPTIONS = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['all', 'All time']]

const TITLES = {
  overview: 'AI Overview',
  queries: 'Shopping Queries',
  recommendations: 'Recommendations',
  comparisons: 'Comparisons',
  analytics: 'AI Analytics',
}

const number = (value) => Number(value ?? 0).toLocaleString('en-PK')
const percent = (value) => (value === null || value === undefined ? '—' : `${value}%`)

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PK', { dateStyle: 'medium' })
}

function Kpi({ label, value, icon, tone = 0, hint }) {
  return (
    <article>
      <span className={`tone-${tone}`}><Icon name={icon} /></span>
      <small>{label}</small>
      <strong>{value}</strong>
      {hint && <em><i>{hint}</i></em>}
    </article>
  )
}

function Table({ columns, rows, empty }) {
  if (!rows?.length) return <p className="finance-note">{empty}</p>
  return (
    <div className="finance-table-wrap">
      <table className="finance-table">
        <thead><tr>{columns.map((column) => <th key={column.key} className={column.numeric ? 'num' : ''}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.term ?? index}>
              {columns.map((column) => <td key={column.key} className={column.numeric ? 'num' : ''}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Trend({ points }) {
  if (!points?.length) return <p className="finance-note">No searches in this period.</p>
  const max = Math.max(...points.map((point) => point.searches), 1)
  const step = Math.max(1, Math.ceil(points.length / 8))
  return (
    <div className="finance-bars" role="img" aria-label="Searches by day">
      <div className="finance-bars-plot">
        {points.map((point) => (
          <div
            key={point.date}
            className={point.searches > 0 ? 'bar' : 'bar empty'}
            style={{ height: `${Math.max(2, (point.searches / max) * 100)}%` }}
            title={`${point.date}: ${point.searches} searches, ${point.empty} with no results`}
          />
        ))}
      </div>
      <div className="finance-bars-axis">
        {points.filter((_, index) => index % step === 0).map((point) => <span key={point.date}>{point.date.slice(5)}</span>)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search-backed views
// ---------------------------------------------------------------------------

function SearchView({ type }) {
  const [range, setRange] = useState('30d')
  const query = useApiQuery((signal) => api.admin.insights.search({ range }, signal), [range])

  if (query.isLoading) return <LoadingState label="Loading search activity" />
  if (query.isError) {
    return (
      <section className="ai-panel">
        <p className="finance-note error">{describeApiError(query.error)}</p>
        <ErrorState onRetry={query.refetch} />
      </section>
    )
  }

  const data = query.data
  const totals = data.totals

  const ranges = (
    <div className="finance-ranges">
      {RANGE_OPTIONS.map(([value, label]) => (
        <button type="button" key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{label}</button>
      ))}
    </div>
  )

  if (totals.searches === 0) {
    return (
      <>
        {ranges}
        <section className="ai-panel">
          <EmptyState
            icon="magnifying-glass"
            title="No searches in this period"
            description="Every search made through the storefront or the shopping assistant is counted here. Widen the date range, or search the storefront and reload this page."
          />
        </section>
      </>
    )
  }

  return (
    <>
      {ranges}
      <div className="ai-kpis">
        <Kpi label="Searches" value={number(totals.searches)} icon="magnifying-glass" tone={0} />
        <Kpi label="Distinct terms" value={number(totals.distinctTerms)} icon="tag" tone={4} />
        <Kpi label="Found nothing" value={number(totals.zeroResult)} icon="circle-exclamation" tone={3} hint={`${percent(totals.zeroResultRate)} of searches`} />
        <Kpi label="Opened a product" value={percent(totals.clickThroughRate)} icon="arrow-pointer" tone={1} />
        <Kpi label="Asked the assistant" value={number(totals.assistantSearches)} icon="robot" tone={2} hint={`median ${totals.averageDurationMs}ms`} />
      </div>

      {(type === 'overview' || type === 'analytics') && (
        <section className="ai-panel">
          <h2>Searches by day</h2>
          <Trend points={data.trend} />
        </section>
      )}

      <div className="finance-grid top">
        <section className="ai-panel">
          <h2>Most searched</h2>
          <Table
            empty="Nothing searched in this period."
            rows={data.topTerms}
            columns={[
              { key: 'term', label: 'Term', render: (row) => row.term },
              { key: 'searches', label: 'Searches', numeric: true, render: (row) => number(row.searches) },
              { key: 'results', label: 'Avg results', numeric: true, render: (row) => row.averageResults },
              { key: 'clicks', label: 'Opened', numeric: true, render: (row) => number(row.clicks) },
            ]}
          />
        </section>

        <section className="ai-panel">
          <h2>Found nothing</h2>
          <p className="finance-note">
            The actionable half. These are things people looked for and Mirwal does not sell, or sells under a
            name nobody searches for — invisible in a plain popularity ranking.
          </p>
          <Table
            empty="Every search in this period returned something."
            rows={data.zeroResultTerms}
            columns={[
              { key: 'term', label: 'Term', render: (row) => row.term },
              { key: 'searches', label: 'Times', numeric: true, render: (row) => number(row.searches) },
              { key: 'last', label: 'Last seen', numeric: true, render: (row) => formatWhen(row.lastSeen) },
            ]}
          />
        </section>
      </div>

      <section className="ai-panel">
        <h2>Products opened from search</h2>
        <Table
          empty="No product has been opened from a search result in this period."
          rows={data.topClickedProducts}
          columns={[
            { key: 'name', label: 'Product', render: (row) => row.name },
            { key: 'slug', label: 'Slug', render: (row) => <code>{row.slug}</code> },
            { key: 'clicks', label: 'Opened', numeric: true, render: (row) => number(row.clicks) },
          ]}
        />
      </section>
    </>
  )
}

/**
 * Bought together, from real baskets.
 *
 * `basketRate` is shown because it is the honest caveat: when almost every order has one
 * item, co-occurrence has nothing to learn from, and the page says so instead of ranking
 * three coincidences.
 */
function RecommendationsView() {
  const query = useApiQuery((signal) => api.admin.insights.recommendations(signal), [])

  if (query.isLoading) return <LoadingState label="Reading baskets" />
  if (query.isError) {
    return (
      <section className="ai-panel">
        <p className="finance-note error">{describeApiError(query.error)}</p>
        <ErrorState onRetry={query.refetch} />
      </section>
    )
  }

  const { pairs, coverage } = query.data

  return (
    <>
      <div className="ai-kpis">
        <Kpi label="Orders" value={number(coverage.totalOrders)} icon="bag-shopping" tone={0} />
        <Kpi label="With more than one item" value={number(coverage.multiItemOrders)} icon="layer-group" tone={4} hint={`${percent(coverage.basketRate)} of orders`} />
        <Kpi label="Product pairs found" value={number(pairs.length)} icon="link" tone={1} />
      </div>

      <section className="ai-panel">
        <h2>Bought together</h2>
        <p className="finance-note">
          Counted from real orders — how often two products appear in the same basket. This is a count, not a
          model: with {number(coverage.multiItemOrders)} multi-item order{coverage.multiItemOrders === 1 ? '' : 's'} to
          learn from, treat a low pair count as coincidence rather than a pattern.
        </p>
        <Table
          empty="No order yet contains two different products, so there is nothing to pair."
          rows={pairs}
          columns={[
            { key: 'product', label: 'Product', render: (row) => row.product.name },
            { key: 'peer', label: 'Bought with', render: (row) => row.peer.name },
            { key: 'together', label: 'Orders', numeric: true, render: (row) => number(row.together) },
          ]}
        />
      </section>
    </>
  )
}

/**
 * Comparisons.
 *
 * The storefront's compare tray is entirely client-side — it lives in the shopper's own
 * browser and is never sent anywhere. Nothing is logged, so there is nothing to report, and
 * the page says which of those two things is true rather than implying data is missing.
 */
function ComparisonsView() {
  return (
    <section className="ai-panel">
      <EmptyState
        icon="scale-balanced"
        title="Comparisons are not tracked"
        description="The storefront's compare tray lives entirely in the shopper's own browser and is never sent to Mirwal, so there is nothing recorded to report on. Shopping Queries covers what people search for."
      />
      <p className="finance-note">
        This is a deliberate choice rather than a gap: comparing two products reveals intent, and logging it
        would mean building the per-shopper profile that Shopping Queries is specifically designed to avoid.
      </p>
    </section>
  )
}

export default function AdminAIPages({ type = 'overview' }) {
  const title = TITLES[type] || TITLES.overview
  return (
    <AdminLayout>
      <div className="ai-page">
        <Heading section="ai" crumb="Mirwal AI" title={title} />
        {type === 'recommendations' ? <RecommendationsView />
          : type === 'comparisons' ? <ComparisonsView />
            : <SearchView type={type} />}
      </div>
    </AdminLayout>
  )
}
