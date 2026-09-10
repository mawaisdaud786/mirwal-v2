import AdminLayout from './AdminLayout'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import WorkQueue from './WorkQueue'
import './dashboard.css'

/**
 * Admin dashboard.
 *
 * This page was entirely fabricated at first (GMV, orders, an activity feed, a seller
 * leaderboard — none backed by any system), then swung to the opposite honest extreme:
 * "there is no admin backend module at all yet." Both were true when written; neither is
 * true now. `server/src/modules/admin` has real analytics (GMV, orders, refunds, revenue by
 * category, top products), a real order list, and a real customer list — this reuses exactly
 * those, the same data AdminAnalytics.jsx and AdminOrderPages.jsx already render, rather than
 * inventing a second copy.
 *
 * Kept deliberately restrained rather than one panel per metric that could theoretically
 * exist: KPIs, one real trend, one real breakdown, real recent orders, and a single honest
 * list of what genuinely isn't built yet (seller approvals, an activity/audit log, AI query
 * tracking, commission/payouts) — one card, not four empty ones.
 */

const STATUS_CLASS = { pending: 'processing', confirmed: 'processing', processing: 'processing', shipped: 'shipped', delivered: '', cancelled: 'cancelled' }

function buildSparkline(points, width = 100, height = 100) {
  if (points.length === 0) return ''
  const max = Math.max(...points, 1)
  const step = width / Math.max(points.length - 1, 1)
  return points.map((value, index) => `${index === 0 ? 'M' : 'L'} ${(index * step).toFixed(1)} ${(height - (value / max) * height).toFixed(1)}`).join(' ')
}

function DashboardContent() {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.admin.analytics({ range: '30d' }, signal), [])
  const { data: customers } = useApiQuery((signal) => api.admin.customers(signal), [])
  const { data: orders } = useApiQuery((signal) => api.admin.orders.list(signal), [])

  if (isLoading) return <LoadingState label="Loading dashboard" />
  if (error) return <ErrorState onRetry={refetch} />

  const { kpis, revenueTrend, revenueByCategory, topProducts } = data
  const recentOrders = [...(orders ?? [])].slice(0, 6)

  const kpiCards = [
    ['Sellers', kpis.sellers.value, 'store', 'green'],
    ['Products', kpis.products.value, 'cube', 'amber'],
    ['Customers', customers?.summary.totalCustomers ?? '—', 'users', 'blue'],
    ['GMV (30d)', kpis.gmv.value.display, 'sack-dollar', 'orange'],
    ['Orders (30d)', kpis.orders.value, 'bag-shopping', 'violet'],
    ['Refunded (30d)', kpis.refunded.value.display, 'rotate-left', 'pink'],
  ]

  const trendValues = revenueTrend.map((point) => point.revenue)
  const totalCategoryRevenue = revenueByCategory.reduce((sum, category) => sum + Number(category.revenue.amount), 0)

  return <>
    {/* Above the KPIs on purpose: thirty-day GMV is worth knowing, but it is not what anyone
        opening this page at nine in the morning actually needs to act on. */}
    <WorkQueue />

    <div className="kpi-grid">
      {kpiCards.map(([label, value, icon, color]) => (
        <article className={`kpi-card ${color}`} key={label}>
          <div><small>{label}</small><strong>{value}</strong></div>
          <span><Icon name={icon} /></span>
        </article>
      ))}
    </div>

    <div className="dashboard-grid lower-grid">
      <section className="admin-panel">
        <div className="panel-title"><h2>Revenue — Last 30 Days</h2><button type="button" onClick={() => navigateTo('/analytics')}>Full analytics <Icon name="arrow-right" /></button></div>
        {trendValues.every((v) => v === 0)
          ? <EmptyState icon="chart-line" title="No revenue yet" description="Real orders placed in the last 30 days will show up here." />
          : <svg className="dashboard-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none">
              <path d={buildSparkline(trendValues, 100, 40)} fill="none" stroke="var(--color-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>}
      </section>
      <section className="admin-panel">
        <div className="panel-title"><h2>Revenue by Category</h2></div>
        {revenueByCategory.length === 0
          ? <EmptyState icon="chart-pie" title="No sales yet" description="Category revenue appears once orders are placed." />
          : <div className="category-table">
              {revenueByCategory.slice(0, 5).map((category) => (
                <div key={category.slug}>
                  <span>{category.name}<i style={{ width: `${totalCategoryRevenue > 0 ? Math.round((Number(category.revenue.amount) / totalCategoryRevenue) * 100) : 0}%` }} /></span>
                  <span>{category.orders} orders</span>
                  <span>{category.revenue.display}</span>
                </div>
              ))}
            </div>}
      </section>
    </div>

    <div className="dashboard-grid lower-grid">
      <section className="admin-panel">
        <div className="panel-title"><h2>Top Products</h2><button type="button" onClick={() => navigateTo('/products')}>All products <Icon name="arrow-right" /></button></div>
        {topProducts.length === 0
          ? <EmptyState icon="box" title="No sales yet" description="Best-selling products appear once orders are placed." />
          : <div className="activity-list">
              {topProducts.slice(0, 5).map((product) => (
                <div key={product.slug}><i><Icon name="box" /></i><span>{product.name}<small> · {product.category}</small></span><small>{product.revenue.display}</small></div>
              ))}
            </div>}
      </section>
      <section className="admin-panel">
        <div className="panel-title"><h2>Recent Orders</h2><button type="button" onClick={() => navigateTo('/orders')}>All orders <Icon name="arrow-right" /></button></div>
        {recentOrders.length === 0
          ? <EmptyState icon="cart-shopping" title="No orders yet" description="Real orders will appear here as they come in." />
          : <div className="orders-table"><div className="orders-row orders-head"><span>Order</span><span>Buyer</span><span>Status</span></div>
              {recentOrders.map((order) => (
                <div className="orders-row" key={order.id} style={{ gridTemplateColumns: '1fr 1.4fr 1fr' }}>
                  <span>{order.orderNumber}</span><span>{order.buyer.name}</span>
                  <span className={`status ${STATUS_CLASS[order.status] ? `status-${STATUS_CLASS[order.status]}` : ''}`}>{order.status}</span>
                </div>
              ))}
            </div>}
      </section>
    </div>

    <section className="admin-panel">
      <div className="panel-title"><h2>Not built yet</h2></div>
      <ul className="not-built-list">
        <li><Icon name="user-plus" /> Seller applications &amp; verification — every seller is live as soon as it registers, there is no review queue.</li>
        <li><Icon name="clock-rotate-left" /> Activity / audit log — listing changes and admin actions aren't tracked.</li>
        <li><Icon name="wand-magic-sparkles" /> AI shopping-query analytics — no queries are logged.</li>
        <li><Icon name="file-invoice-dollar" /> Commission &amp; payouts — there is no payout system to report on.</li>
      </ul>
    </section>
  </>
}

export default function AdminDashboard() {
  return (
    <AdminLayout>
      <div className="admin-dashboard">
        <div className="dashboard-heading">
          <div>
            <h1>Dashboard</h1>
            <p>A snapshot of what's actually on the marketplace right now.</p>
          </div>
        </div>
        <DashboardContent />
      </div>
    </AdminLayout>
  )
}
