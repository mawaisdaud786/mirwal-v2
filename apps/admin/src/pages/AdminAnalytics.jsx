import { useState } from 'react'
import AdminLayout from './AdminLayout'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from '../api'
import './analytics.css'

/**
 * Real platform analytics — every number here comes from server/src/modules/admin/
 * analytics.service.js, which aggregates real orders/refunds/sellers/products in MariaDB.
 *
 * This page previously rendered entirely hard-coded numbers: a fixed "Rs. 12,84,50,000" GMV,
 * "85,421" orders, a fabricated top-products table, and panels (Traffic Sources, User
 * Behavior, Top Pages, Device Breakdown) that would need a web-analytics/session-tracking
 * pipeline Mirwal has never had. Those panels are gone rather than left fake — there is
 * nothing real to show in them yet. Only "Business Overview" is wired up for the same
 * reason; the other seven tabs are disabled rather than pretending to switch to a view that
 * doesn't exist.
 */

const RANGE_OPTIONS = [
  ['7d', '7 Days'],
  ['30d', '30 Days'],
  ['90d', '3 Months'],
  ['1y', '12 Months'],
]

const TABS = ['Business Overview', 'Sales Analytics', 'Customer Analytics', 'Seller Analytics', 'Product Analytics', 'Marketing Analytics', 'AI Analytics', 'Financial Analytics']

const LEGEND_COLORS = ['#f04b1c', '#ef4052', '#48a9d7', '#70bb79', '#9164d6', '#f5a92d']

function Panel({ title, children, className = '' }) {
  return <section className={`analytics-panel ${className}`}><h2>{title}</h2>{children}</section>
}

/** `null` (no prior-period baseline) is shown honestly as "no prior period" rather than as a
 * fabricated 0%/100% swing. */
function ChangeBadge({ changePercent, periodLabel }) {
  if (changePercent == null) return <em className="is-neutral">New — no prior period yet</em>
  const up = changePercent >= 0
  return <em className={up ? '' : 'is-down'}><Icon name={up ? 'arrow-up' : 'arrow-down'} /> {up ? '+' : ''}{changePercent}% <i>{periodLabel}</i></em>
}

function GrowthBadge({ newInPeriod, periodLabel }) {
  if (!newInPeriod) return <em className="is-neutral">None new {periodLabel}</em>
  return <em><Icon name="arrow-up" /> +{newInPeriod.toLocaleString('en-PK')} <i>{periodLabel}</i></em>
}

function compactMoney(amount) {
  if (amount >= 10_000_000) return `${(amount / 10_000_000).toFixed(1)}Cr`
  if (amount >= 100_000) return `${(amount / 100_000).toFixed(1)}L`
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`
  return String(Math.round(amount))
}

function buildLinePath(values, max, width, height) {
  if (values.length === 0) return ''
  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  return values.map((value, index) => {
    const x = index * stepX
    const y = max > 0 ? height - (value / max) * height : height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

function RevenueTrendChart({ points, range, onRangeChange }) {
  const width = 700
  const height = 150
  const maxRevenue = Math.max(1, ...points.map((point) => point.revenue))
  const maxOrders = Math.max(1, ...points.map((point) => point.orders))
  const linePath = buildLinePath(points.map((point) => point.revenue), maxRevenue, width, height)
  const orderPath = buildLinePath(points.map((point) => point.orders), maxOrders, width, height)
  const fillPath = linePath ? `${linePath} L${width} ${height} L0 ${height}Z` : ''

  // Labels crowd out past ~10 points, so a longer range only labels a spread-out subset.
  const labelEvery = Math.max(1, Math.ceil(points.length / 7))
  const totalRevenue = points.reduce((sum, point) => sum + point.revenue, 0)

  return (
    <Panel title="Revenue & Orders Trend" className="trend-panel">
      <div className="analytics-chart-tools">
        <span><b /> Revenue (Rs.) <b className="gray" /> Orders</span>
        <div>{RANGE_OPTIONS.map(([value, label]) => <button type="button" key={value} className={range === value ? 'active' : ''} onClick={() => onRangeChange(value)}>{label}</button>)}</div>
      </div>
      {totalRevenue === 0 ? (
        <p className="analytics-empty-note">No orders in this period yet.</p>
      ) : (
        <div className="analytics-line-chart">
          <div className="analytics-y-axis">
            {[4, 3, 2, 1, 0].map((step) => <span key={step}>{step === 0 ? '0' : compactMoney((maxRevenue * step) / 4)}<br /></span>)}
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Revenue and orders trend">
            <path className="analytics-fill" d={fillPath} />
            <path className="analytics-line" d={linePath} />
            <path className="analytics-order-line" d={orderPath} />
          </svg>
          <div className="analytics-x-axis">
            {points.map((point, index) => (
              (index % labelEvery === 0 || index === points.length - 1)
                ? <span key={point.date}>{new Date(point.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</span>
                : null
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

function RevenueByCategoryPanel({ categories }) {
  if (categories.length === 0) {
    return <Panel title="Revenue by Category"><p className="analytics-empty-note">No sales in this period yet.</p></Panel>
  }
  const segments = categories.slice(0, 6).reduce((acc, category, index) => {
    const start = acc.cursor
    const end = start + category.percent
    return { cursor: end, stops: [...acc.stops, `${LEGEND_COLORS[index]} ${start}% ${end}%`] }
  }, { cursor: 0, stops: [] })
  const stops = segments.cursor < 100 ? [...segments.stops, `#d9e0e4 ${segments.cursor}% 100%`] : segments.stops
  const topCategory = categories[0]

  return (
    <Panel title="Revenue by Category">
      <div className="donut-layout">
        <div className="analytics-donut" style={{ background: `conic-gradient(${stops.join(', ')})` }}>
          <div><strong>{topCategory.percent}%</strong><small>{topCategory.name}</small></div>
        </div>
        <div className="legend-list">
          {categories.slice(0, 6).map((category, index) => (
            <div key={category.slug}><i className={`legend-${index}`} />{category.name}<b>{category.percent}%</b></div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function TopCategoriesPanel({ categories }) {
  return (
    <Panel title="Top Performing Categories">
      {categories.length === 0 ? <p className="analytics-empty-note">No sales in this period yet.</p> : (
        <div className="mini-table">
          <div><b>Category</b><b>Orders</b><b>Revenue</b></div>
          {categories.slice(0, 5).map((category) => (
            <div key={category.slug}><span>{category.name}</span><span>{category.orders}</span><span>{category.revenue.display}</span></div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function TopProductsPanel({ products }) {
  return (
    <Panel title="Top Products by Revenue" className="products-panel">
      {products.length === 0 ? <p className="analytics-empty-note">No sales in this period yet.</p> : (
        <div className="product-table">
          <div><b>#</b><b>Product</b><b>Category</b><b>Sold</b><b>Revenue</b><b>% of Revenue</b></div>
          {products.map((product, index) => (
            <div key={product.slug}>
              <span>{index + 1}</span>
              <span>{product.name}</span>
              <span>{product.category}</span>
              <span>{product.unitsSold}</span>
              <span>{product.revenue.display}</span>
              <span>{product.percentOfRevenue}%</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function RevenueHeatmapPanel({ heatmap }) {
  const timeLabels = ['12 AM - 4 AM', '4 AM - 8 AM', '8 AM - 12 PM', '12 PM - 4 PM', '4 PM - 8 PM', '8 PM - 12 AM']
  const hasActivity = heatmap.buckets.some((bucket) => bucket.cells.some((cell) => cell.count > 0))
  return (
    <Panel title="Order Activity Heatmap (Last 7 Days)" className="heatmap-panel">
      <div className="heatmap-head">
        <span>Time</span>
        {heatmap.days.map((day) => <b key={day}>{new Date(day).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</b>)}
      </div>
      {heatmap.buckets.map((bucket) => (
        <div className="heatmap-row" key={bucket.bucket}>
          <span>{timeLabels[bucket.bucket]}</span>
          {bucket.cells.map((cell) => (
            <i key={cell.day} className={`heat-${Math.round(cell.intensity * 4)}`} title={`${cell.count} order${cell.count === 1 ? '' : 's'}`} />
          ))}
        </div>
      ))}
      {!hasActivity && <p className="analytics-panel-note">No orders in the last 7 days yet.</p>}
      <div className="heatmap-legend"><span />Fewer orders <i />More orders</div>
    </Panel>
  )
}

export default function AdminAnalytics() {
  const [activeTab, setActiveTab] = useState('Business Overview')
  const [range, setRange] = useState('7d')

  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.admin.analytics({ range }, signal),
    [range],
  )

  const rangeLabel = RANGE_OPTIONS.find(([value]) => value === range)?.[1] ?? range
  const periodLabel = `vs previous period`

  return <AdminLayout><div className="analytics-page">
    <div className="analytics-heading">
      <div><h1>Analytics Overview <Icon name="circle-info" /></h1><p>Real metrics computed from Mirwal's own orders, refunds, sellers and products.</p></div>
      <div className="analytics-actions">
        <button type="button" onClick={refetch} aria-label="Refresh analytics"><Icon name="rotate-right" /> Refresh</button>
      </div>
    </div>

    {isLoading && <LoadingState label="Loading analytics" />}
    {error && !isLoading && <ErrorState title="We could not load analytics" description={describeApiError(error)} onRetry={refetch} />}

    {data && <>
      <div className="analytics-kpis">
        <article className="analytics-kpi orange"><span><Icon name="bag-shopping" /></span><small>GMV (Gross Merchandise Value)</small><strong>{data.kpis.gmv.value.display}</strong><ChangeBadge changePercent={data.kpis.gmv.changePercent} periodLabel={periodLabel} /></article>
        <article className="analytics-kpi violet"><span><Icon name="cart-shopping" /></span><small>Total Orders</small><strong>{data.kpis.orders.value.toLocaleString('en-PK')}</strong><ChangeBadge changePercent={data.kpis.orders.changePercent} periodLabel={periodLabel} /></article>
        <article className="analytics-kpi blue"><span><Icon name="users" /></span><small>Total Customers</small><strong>{data.kpis.customers.value.toLocaleString('en-PK')}</strong><GrowthBadge newInPeriod={data.kpis.customers.newInPeriod} periodLabel={rangeLabel} /></article>
        <article className="analytics-kpi green"><span><Icon name="store" /></span><small>Total Sellers</small><strong>{data.kpis.sellers.value.toLocaleString('en-PK')}</strong><GrowthBadge newInPeriod={data.kpis.sellers.newInPeriod} periodLabel={rangeLabel} /></article>
        <article className="analytics-kpi orange"><span><Icon name="cube" /></span><small>Total Products</small><strong>{data.kpis.products.value.toLocaleString('en-PK')}</strong><GrowthBadge newInPeriod={data.kpis.products.newInPeriod} periodLabel={rangeLabel} /></article>
        <article className="analytics-kpi pink"><span><Icon name="rotate-left" /></span><small>Total Refunded</small><strong>{data.kpis.refunded.value.display}</strong><ChangeBadge changePercent={data.kpis.refunded.changePercent} periodLabel={periodLabel} /></article>
      </div>

      <nav className="analytics-tabs" aria-label="Analytics views">
        {TABS.map((tab) => tab === 'Business Overview'
          ? <button type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}</button>
          : <button type="button" key={tab} disabled title="Not built yet">{tab}<small>Soon</small></button>)}
      </nav>

      <div className="analytics-grid analytics-top">
        <RevenueTrendChart points={data.revenueTrend} range={range} onRangeChange={setRange} />
        <RevenueByCategoryPanel categories={data.revenueByCategory} />
        <TopCategoriesPanel categories={data.revenueByCategory} />
      </div>

      <div className="analytics-grid analytics-bottom">
        <TopProductsPanel products={data.topProducts} />
        <RevenueHeatmapPanel heatmap={data.revenueHeatmap} />
      </div>
    </>}
  </div></AdminLayout>
}
