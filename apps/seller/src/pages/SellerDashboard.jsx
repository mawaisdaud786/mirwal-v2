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
 */

const LOW_STOCK_THRESHOLD = 5
const ORDER_STATUS_CLASS = { delivered: '', shipped: 'shipped', processing: 'processing', confirmed: 'processing', pending: 'processing', cancelled: 'cancelled', returned: 'cancelled' }
const ORDER_STATUS_LABEL = { delivered: 'Delivered', shipped: 'Shipped', processing: 'Processing', confirmed: 'Confirmed', pending: 'Pending', cancelled: 'Cancelled', returned: 'Returned' }

function SalesPanel() {
  const { data, error, isLoading } = useApiQuery((signal) => api.seller.finance({ range: '30d' }, signal), [])
  if (isLoading) return <EmptyState icon={<Icon name="spinner" />} title="Loading" text="Fetching your last 30 days…" />
  if (error) return <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load sales" text="Try refreshing the page." />
  const { revenue, orders, pending } = data.kpis
  return <div className="dashboard-sales-kpis">
    <div><small>Delivered Revenue (30d)</small><strong>{revenue.value.display}</strong></div>
    <div><small>Delivered Orders (30d)</small><strong>{orders.value}</strong></div>
    <div><small>In Fulfillment</small><strong>{pending.orderCount}</strong></div>
  </div>
}

function RecentOrdersPanel() {
  const { data: items, error, isLoading } = useApiQuery((signal) => api.seller.orders(signal), [])
  if (isLoading) return <EmptyState icon={<Icon name="spinner" />} title="Loading" text="Fetching your recent orders…" />
  if (error) return <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load orders" text="Try refreshing the page." />
  const recent = [...(items ?? [])].sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt)).slice(0, 5)
  if (recent.length === 0) {
    return <EmptyState icon={<Icon name="clipboard-list" />} title="No orders yet" text="Orders placed on your products will show up here." />
  }
  return <>{recent.map((item) => (
    <div className="dashboard-order" key={item.id}>
      <span className="order-avatar"><Icon name="box" /></span>
      <div><b>{item.product.name}</b><small>{item.orderNumber} · Qty {item.quantity}</small></div>
      <strong>{item.lineTotal.display}</strong>
      <em className={ORDER_STATUS_CLASS[item.status] ?? ''}>{ORDER_STATUS_LABEL[item.status] ?? item.status}</em>
    </div>
  ))}</>
}

export default function SellerDashboard() {
  const { data: products } = useApiQuery((signal) => api.seller.products(signal), [])
  const items = products ?? []

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
      </div>

      <div className="dashboard-metrics">
        {metrics.map(([label, value, icon]) => (
          <article className="dashboard-metric" key={label}>
            <div className="dashboard-metric-top"><span>{label}</span><i><Icon name={icon} /></i></div>
            <strong>{value}</strong>
          </article>
        ))}
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
