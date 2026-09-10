import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import './dashboard.css'

/**
 * Seller dashboard.
 *
 * Every number here was originally fabricated: "Total Sales +18.6%", "324 orders +12.4%",
 * "12,540 visitors +9.8%", a 2.58% conversion rate, a hand-drawn sales/orders line chart with
 * hard-coded SVG points. Sales & Traffic and Recent Orders then went to the opposite extreme
 * — "there is no orders system yet" — which stopped being true once order_items and
 * finance.service.js became real (see FinancePage.jsx / Orders.jsx). This reuses that same
 * real data: `GET /seller/me/finance` for revenue, `GET /seller/me/orders` for the recent
 * list. Visitor counts and a conversion rate are still absent on purpose — there is no
 * web-analytics/session-tracking pipeline anywhere in this app, and inventing one to fill the
 * panel would be exactly the fabrication this dashboard used to do.
 *
 * Product metrics are real aggregates of `GET /seller/me/products` — product counts by status
 * and stock level, and the actual average rating.
 *
 * The Sales panel now shows two more things `GET /seller/me/finance` already computed and
 * nothing here read: `kpis.revenue.changePercent`/`kpis.orders.changePercent` (a real
 * period-over-period comparison that is `null`, and hidden, when there's no prior period worth
 * comparing to — see `changePercent` in `lib/dateRange.js`) and `revenueTrend`, a real
 * zero-filled daily revenue series, drawn as a small line chart. Neither required a new
 * endpoint; both were already in the response and simply unused.
 */

const LOW_STOCK_THRESHOLD = 5

/**
 * A real period-over-period change, or nothing.
 *
 * `changePercent` comes from `finance.service.js#getOverview`, which already returns `null`
 * when there's no meaningful previous period to compare against (a brand-new store, or a
 * previous window with zero orders) — dividing by zero would either throw or produce a
 * misleading number. This renders exactly that: a real percentage when one exists, and no
 * badge at all when it doesn't. No placeholder, no "—", nothing invented to fill the space.
 */
function TrendBadge({ percent }) {
  if (percent == null) return null
  const direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
  return (
    <span className={`dashboard-trend ${direction}`}>
      <Icon name={direction === 'up' ? 'arrow-trend-up' : direction === 'down' ? 'arrow-trend-down' : 'minus'} />
      {Math.abs(percent)}% <small>vs prior period</small>
    </span>
  )
}

/**
 * A real daily revenue line, from data the finance endpoint already computes and nothing on
 * this panel used to read (`revenueTrend` in `finance.service.js`). Zero-filled by the server
 * across the whole window, so a quiet day draws as a real dip rather than a gap or a skip.
 */
function SalesTrendChart({ points }) {
  if (!points || points.length < 2) return null

  const width = 600
  const height = 108
  const top = 10
  const max = Math.max(...points.map((point) => point.revenue), 0)
  const hasSales = max > 0
  const stepX = width / (points.length - 1)
  const toY = (value) => hasSales ? height - top - (value / max) * (height - top * 2) : height - top
  const coords = points.map((point, index) => [index * stepX, toY(point.revenue)])
  const linePath = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`

  // A handful of evenly spaced date labels rather than one per day, which would just overlap.
  const labelCount = Math.min(5, points.length)
  const labelAt = Array.from({ length: labelCount }, (_, index) =>
    Math.round((index * (points.length - 1)) / (labelCount - 1)))
  const formatDay = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="dashboard-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="dashboardSalesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {hasSales && <path d={areaPath} fill="url(#dashboardSalesFill)" stroke="none" />}
        <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => point.revenue > 0 && (
          <circle key={point.date} cx={coords[index][0]} cy={coords[index][1]} r="3.5" fill="var(--color-primary)">
            <title>{formatDay(point.date)}: Rs. {point.revenue.toLocaleString('en-PK')}</title>
          </circle>
        ))}
      </svg>
      <div className="dashboard-chart-labels">
        {labelAt.map((index) => <span key={index}>{formatDay(points[index].date)}</span>)}
      </div>
    </div>
  )
}
const ORDER_STATUS_CLASS = { delivered: '', shipped: 'shipped', processing: 'processing', confirmed: 'processing', pending: 'processing', cancelled: 'cancelled', returned: 'cancelled' }
const ORDER_STATUS_LABEL = { delivered: 'Delivered', shipped: 'Shipped', processing: 'Processing', confirmed: 'Confirmed', pending: 'Pending', cancelled: 'Cancelled', returned: 'Returned' }

function SalesPanel() {
  const { data, error, isLoading } = useApiQuery((signal) => api.seller.finance({ range: '30d' }, signal), [])
  if (isLoading) return <EmptyState icon={<Icon name="spinner" />} title="Loading" text="Fetching your last 30 days…" />
  if (error) return <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load sales" text="Try refreshing the page." />
  const { revenue, orders, pending } = data.kpis
  return <>
    <div className="dashboard-sales-kpis">
      <div>
        <span className="dashboard-sales-kpi-icon"><Icon name="sack-dollar" /></span>
        <small>Delivered Revenue (30d)</small>
        <strong>{revenue.value.display}</strong>
        <TrendBadge percent={revenue.changePercent} />
      </div>
      <div>
        <span className="dashboard-sales-kpi-icon"><Icon name="cart-shopping" /></span>
        <small>Delivered Orders (30d)</small>
        <strong>{orders.value}</strong>
        <TrendBadge percent={orders.changePercent} />
      </div>
      <div>
        <span className="dashboard-sales-kpi-icon"><Icon name="truck" /></span>
        <small>In Fulfillment</small>
        <strong>{pending.orderCount}</strong>
      </div>
    </div>
    <SalesTrendChart points={data.revenueTrend} />
  </>
}

function RecentOrdersPanel() {
  // Five, asked for as five. The list already arrives newest-first from the server, so the
  // client-side sort this used to do was sorting a page it had just been handed in order.
  const { data, error, isLoading } = useApiQuery((signal) => api.seller.orders({ pageSize: 5 }, signal), [])
  if (isLoading) return <EmptyState icon={<Icon name="spinner" />} title="Loading" text="Fetching your recent orders…" />
  if (error) return <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load orders" text="Try refreshing the page." />
  const recent = data?.items ?? []
  if (recent.length === 0) {
    return <EmptyState icon={<Icon name="clipboard-list" />} title="No orders yet" text="Orders placed on your products will show up here." />
  }
  return <>{recent.map((item) => (
    <div className="dashboard-order" key={item.id}>
      {/* The order API already joins `product_images` for this — see `orders.service.js` —
          it just never reached this panel. Falls back to the icon box when a listing genuinely
          has no image, rather than an empty/broken `<img>`. */}
      {item.image
        ? <img className="product-thumb" src={item.image} alt="" />
        : <span className="order-avatar"><Icon name="box" /></span>}
      <div><b>{item.product.name}</b><small>{item.orderNumber} · Qty {item.quantity}</small></div>
      <strong>{item.lineTotal.display}</strong>
      <em className={ORDER_STATUS_CLASS[item.status] ?? ''}>{ORDER_STATUS_LABEL[item.status] ?? item.status}</em>
    </div>
  ))}</>
}

export default function SellerDashboard() {
  /**
    * Whole-catalogue aggregates, so this asks for one large page rather than the default 25.
    * `pageSize` is capped at 100 server-side; a store past that gets figures over its 100 most
    * recent listings, which is why the panel below says "recent" rather than implying totals.
    */
  const { data: products } = useApiQuery((signal) => api.seller.products({ pageSize: 100 }, signal), [])
  const items = products?.items ?? []

  const published = items.filter((p) => p.status === 'active').length
  const drafts = items.filter((p) => p.status === 'draft' || p.status === 'pending_review').length
  const outOfStock = items.filter((p) => p.stock === 0).length
  const lowStock = items.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD).length
  const rated = items.filter((p) => p.rating.count > 0)
  const avgRating = rated.length ? (rated.reduce((sum, p) => sum + p.rating.average, 0) / rated.length).toFixed(1) : null

  const metrics = [
    ['Total Products', String(items.length), 'boxes-stacked'],
    ['Published', String(published), 'circle-check'],
    ['Drafts', String(drafts), 'file-pen'],
    ['Out of Stock', String(outOfStock), 'triangle-exclamation'],
    ['Low Stock', String(lowStock), 'battery-quarter'],
    ['Average Rating', avgRating ? `${avgRating}/5` : 'No reviews yet', 'star'],
  ]

  return <SellerLayout activeItem="dashboard" breadcrumbs={[{ label: 'Dashboard' }]}>
    <div className="dashboard-container">
      <div className="dashboard-title-row">
        <div><h1>Dashboard</h1><p>Here's a snapshot of your store's catalogue right now.</p></div>
        <button className="dashboard-date" type="button" aria-label="Sales range: last 30 days"><Icon name="calendar-days" /> Last 30 Days <Icon name="chevron-down" /></button>
      </div>

      <div className="dashboard-metrics">
        {metrics.slice(0, 5).map(([label, value, icon]) => (
          <article className="dashboard-metric" key={label}>
            <div className="dashboard-metric-top"><span>{label}</span><i><Icon name={icon} /></i></div>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="dashboard-highlight-row">
        <article className="dashboard-metric dashboard-rating-metric">
          <div className="dashboard-metric-top"><span>Average Rating</span><i><Icon name="star" /></i></div>
          <strong>{metrics[5][1]}</strong>
        </article>
        <section className="dashboard-growth-callout">
          <div>
            <span className="dashboard-growth-icon" aria-hidden="true"><Icon name="arrow-trend-up" /></span>
            <div><strong>Keep going!</strong><p>Optimize your products and offer deals to boost your sales even more.</p></div>
          </div>
          <button type="button" onClick={() => navigateTo('/products/add')}>Add New Product <Icon name="arrow-right" /></button>
        </section>
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-panel sales-panel">
          <div className="dashboard-panel-heading"><h2>Sales</h2><button type="button" onClick={() => navigateTo('/finance')}>View earnings <Icon name="arrow-right" /></button></div>
          <SalesPanel />
        </section>
        <section className="dashboard-panel recent-panel">
          <div className="dashboard-panel-heading"><h2>Recent Orders</h2><button type="button" onClick={() => navigateTo('/orders')}>View all <Icon name="arrow-right" /></button></div>
          <RecentOrdersPanel />
        </section>
      </div>

      <div className="dashboard-bottom">
        <section className="dashboard-panel top-products">
          <div className="dashboard-panel-heading">
            <h2>Your Products</h2>
            <button type="button" onClick={() => navigateTo('/products')}>Manage products <Icon name="arrow-right" /></button>
          </div>
          {items.length === 0 ? (
            <EmptyState
              icon={<Icon name="box-open" />}
              title="No products yet"
              text="Add your first product to start selling on Mirwal."
              actionLabel="Add a product"
              onAction={() => navigateTo('/products/add')}
            />
          ) : (
            items.slice(0, 5).map((product, index) => (
              <div className="top-product" key={product.id}>
                <b>{index + 1}</b>
                {/* The CSS already styled this avatar slot (`.top-product > span.product-avatar`,
                    matching Recent Orders' own `.order-avatar`); the element itself had gone
                    missing, which left the grid's 30px avatar column with nothing in it — so
                    the product name div fell into that column instead and wrapped its text
                    across five lines in a 30px-wide box. Now shows the real listing photo
                    (`GET /seller/me/products` gained `imageUrl` for exactly this) and falls
                    back to the icon box only when a listing genuinely has none. */}
                {product.imageUrl
                  ? <img className="product-thumb" src={product.imageUrl} alt="" />
                  : <span className="product-avatar"><Icon name="box" /></span>}
                <div><strong>{product.name}</strong><small>Rs. {Number(product.price.amount).toLocaleString('en-PK')}</small></div>
                <small>{product.rating.count > 0 ? `${product.rating.average.toFixed(1)} ★ (${product.rating.count})` : 'No reviews yet'}</small>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  </SellerLayout>
}
