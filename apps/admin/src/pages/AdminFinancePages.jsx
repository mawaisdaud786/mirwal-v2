import { useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './finance-pages.css'

/**
 * Finance, Business, Marketplace, Seller and Customer analytics.
 *
 * All five said the same thing until now — that no orders or payments system existed to
 * compute from. That was written before migration 003; `orders`, `payments`, `refunds` and
 * `payouts` have been real for a long time, and every figure on these pages is now an
 * aggregate over rows the marketplace actually created.
 *
 * The original template drew a hand-written SVG trend line that never changed and a donut
 * with a fixed "Rs. 24,568,750" total. Both are gone. What replaces them is smaller on
 * purpose: a real trend, real totals, and nothing where there is nothing.
 *
 * Two display rules, both inherited from the existing analytics page:
 *  - a percentage change with no prior period shows as "no comparison", never "+100%".
 *  - a rate over zero events shows "—", never 0%.
 */

const RANGE_OPTIONS = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['all', 'All time']]

const CONFIG = {
  finance: {
    title: 'Finances Overview',
    crumb: 'Finances',
    fetch: (params, signal) => api.admin.insights.finance(params, signal),
  },
  business: {
    title: 'Business Analytics',
    crumb: 'Finances',
    fetch: (params, signal) => api.admin.insights.finance(params, signal),
  },
  marketplace: {
    title: 'Marketplace Analytics',
    crumb: 'Analytics',
    fetch: (params, signal) => api.admin.insights.marketplace(params, signal),
  },
  seller: {
    title: 'Seller Analytics',
    crumb: 'Analytics',
    fetch: (params, signal) => api.admin.insights.sellers(params, signal),
  },
  customer: {
    title: 'Customer Analytics',
    crumb: 'Analytics',
    fetch: (params, signal) => api.admin.insights.customers(params, signal),
  },
}

const number = (value) => Number(value ?? 0).toLocaleString('en-PK')
const percent = (value) => (value === null || value === undefined ? '—' : `${value}%`)

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PK', { dateStyle: 'medium' })
}

function Change({ value, label }) {
  // null means there was no comparable prior period — said plainly rather than shown as 0%.
  if (value === null || value === undefined) return <em><i>no comparison</i></em>
  const up = value >= 0
  return (
    <em style={{ color: up ? 'var(--admin-success)' : 'var(--admin-danger)' }}>
      <Icon name={up ? 'arrow-up' : 'arrow-down'} /> {Math.abs(value)}% <i>vs previous {label}</i>
    </em>
  )
}

function Kpi({ label, value, icon, tone = 0, change, changeLabel, hint }) {
  return (
    <article>
      <span className={`tone-${tone}`}><Icon name={icon} /></span>
      <small>{label}</small>
      <strong>{value}</strong>
      {change !== undefined ? <Change value={change} label={changeLabel} /> : hint ? <em><i>{hint}</i></em> : null}
    </article>
  )
}

/**
 * A bar trend rather than the template's smooth line.
 *
 * A line implies a continuous quantity between points; these are daily totals, and a day with
 * no orders is a real zero, not a dip on the way somewhere. Bars say that correctly.
 */
function Trend({ points, valueKey, label, format }) {
  if (!points?.length) return <p className="finance-note">No activity in this period.</p>
  const max = Math.max(...points.map((point) => Number(point[valueKey]) || 0), 1)
  const step = Math.max(1, Math.ceil(points.length / 8))

  return (
    <div className="finance-bars" role="img" aria-label={`${label} by day`}>
      <div className="finance-bars-plot">
        {points.map((point) => {
          const value = Number(point[valueKey]) || 0
          return (
            <div
              key={point.date}
              className={value > 0 ? 'bar' : 'bar empty'}
              style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
              title={`${point.date}: ${format ? format(value) : number(value)}`}
            />
          )
        })}
      </div>
      <div className="finance-bars-axis">
        {points.filter((_, index) => index % step === 0).map((point) => (
          <span key={point.date}>{point.date.slice(5)}</span>
        ))}
      </div>
    </div>
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
            <tr key={row.id ?? row.name ?? row.term ?? index}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'num' : ''}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-view bodies
// ---------------------------------------------------------------------------

function FinanceView({ data }) {
  const totals = data.totals
  return (
    <>
      <div className="finance-kpis">
        <Kpi label="Gross revenue" value={totals.grossRevenue.display} icon="sack-dollar" tone={0} hint="Excludes cancelled orders" />
        <Kpi label="Collected" value={totals.collected.display} icon="circle-check" tone={1} hint={`${number(totals.orders)} orders`} />
        <Kpi label="Refunded" value={totals.refunded.display} icon="rotate-left" tone={3} hint={`${number(totals.refundsNeedingAction)} need action`} />
        <Kpi label="Net revenue" value={totals.netRevenue.display} icon="chart-line" tone={4} hint="Gross less settled refunds" />
        <Kpi label="Owed to sellers" value={totals.owedToSellers.display} icon="hand-holding-dollar" tone={2} hint={`${totals.paidToSellers.display} already paid`} />
      </div>

      <div className="finance-grid top">
        <section className="finance-panel">
          <h2>Revenue by day</h2>
          <Trend points={data.trend} valueKey="revenue" label="Revenue" format={(value) => `Rs. ${number(Math.round(value))}`} />
        </section>
        <section className="finance-panel">
          <h2>Commission earned</h2>
          <p className="finance-figure">{totals.commissionEarned.display}</p>
          <p className="finance-note">
            Read from the payout rows that recorded it, not recalculated from today&rsquo;s rate — a rate change
            must not retroactively rewrite what a seller was charged.
          </p>
          <p className="finance-note">{number(totals.payouts)} payouts in this period.</p>
        </section>
      </div>

      <section className="finance-panel">
        <h2>Payments</h2>
        <Table
          empty="No payments in this period."
          rows={data.byPaymentMethod}
          columns={[
            { key: 'method', label: 'Method', render: (row) => row.method.toUpperCase() },
            { key: 'status', label: 'Status', render: (row) => <span className={`finance-pill ${row.status}`}>{row.status}</span> },
            { key: 'orders', label: 'Orders', numeric: true, render: (row) => number(row.orders) },
            { key: 'value', label: 'Value', numeric: true, render: (row) => row.value.display },
          ]}
        />
      </section>
    </>
  )
}

function MarketplaceView({ data, rangeLabel }) {
  const totals = data.totals
  return (
    <>
      <div className="finance-kpis">
        <Kpi label="GMV" value={totals.gmv.display} icon="sack-dollar" tone={0} change={data.change.gmv} changeLabel={rangeLabel} />
        <Kpi label="Orders" value={number(totals.orders)} icon="bag-shopping" tone={4} change={data.change.orders} changeLabel={rangeLabel} />
        <Kpi label="Average order" value={totals.averageOrderValue.display} icon="receipt" tone={1} hint={`${number(totals.buyers)} buyers`} />
        <Kpi label="Shipping collected" value={totals.shippingCollected.display} icon="truck" tone={2} />
        <Kpi label="Cancelled" value={number(totals.cancelledOrders)} icon="circle-xmark" tone={3} hint={totals.cancelledValue.display} />
      </div>

      <div className="finance-grid top">
        <section className="finance-panel">
          <h2>GMV by day</h2>
          <Trend points={data.trend} valueKey="gmv" label="GMV" format={(value) => `Rs. ${number(Math.round(value))}`} />
        </section>
        <section className="finance-panel">
          <h2>Orders by status</h2>
          <div className="finance-legend">
            {data.byStatus.length === 0 ? <p className="finance-note">No orders in this period.</p>
              : data.byStatus.map((row) => (
                <div key={row.status}>{row.status}<b>{number(row.orders)}</b></div>
              ))}
          </div>
        </section>
      </div>

      <section className="finance-panel">
        <h2>Top categories</h2>
        <Table
          empty="No sales in this period."
          rows={data.topCategories}
          columns={[
            { key: 'name', label: 'Category', render: (row) => row.name },
            { key: 'orders', label: 'Orders', numeric: true, render: (row) => number(row.orders) },
            { key: 'units', label: 'Units', numeric: true, render: (row) => number(row.units) },
            { key: 'revenue', label: 'Revenue', numeric: true, render: (row) => row.revenue.display },
          ]}
        />
      </section>
    </>
  )
}

function SellerView({ data }) {
  return (
    <>
      <div className="finance-kpis">
        <Kpi label="Approved sellers" value={number(data.totals.sellers)} icon="store" tone={0} />
        <Kpi label="Trading in period" value={number(data.totals.trading)} icon="chart-line" tone={1} />
        <Kpi label="Seller revenue" value={data.totals.revenue.display} icon="sack-dollar" tone={4} hint="Sum of order lines, not order totals" />
      </div>

      <section className="finance-panel">
        <h2>By store</h2>
        <p className="finance-note">
          Revenue is summed from order lines, not order totals: a basket with items from three sellers belongs
          to three sellers, and none of them earned all of it.
        </p>
        <Table
          empty="No approved sellers have traded in this period."
          rows={data.sellers}
          columns={[
            { key: 'name', label: 'Store', render: (row) => row.name },
            { key: 'orders', label: 'Orders', numeric: true, render: (row) => number(row.orders) },
            { key: 'units', label: 'Units', numeric: true, render: (row) => number(row.units) },
            { key: 'revenue', label: 'Revenue', numeric: true, render: (row) => row.revenue.display },
            { key: 'aov', label: 'Avg order', numeric: true, render: (row) => row.averageOrderValue.display },
            { key: 'returns', label: 'Returns', numeric: true, render: (row) => number(row.returns) },
            // "—" where nothing has reached a terminal state yet: a seller whose only order is
            // still in transit has no fulfilment rate, and 0% would be a lie.
            { key: 'fulfilment', label: 'Fulfilled', numeric: true, render: (row) => percent(row.fulfilmentRate) },
            { key: 'paid', label: 'Paid out', numeric: true, render: (row) => row.paidOut.display },
          ]}
        />
      </section>
    </>
  )
}

function CustomerView({ data, rangeLabel }) {
  const totals = data.totals
  return (
    <>
      <div className="finance-kpis">
        <Kpi label="New customers" value={number(totals.newCustomers)} icon="user-plus" tone={0} change={data.change.newCustomers} changeLabel={rangeLabel} />
        <Kpi label="Bought in period" value={number(totals.buyersInPeriod)} icon="users" tone={4} />
        <Kpi label="Repeat buyers" value={number(totals.repeatBuyers)} icon="rotate-right" tone={1} hint={`${percent(totals.repeatRate)} of buyers`} />
        <Kpi label="Avg lifetime value" value={totals.averageLifetimeValue.display} icon="sack-dollar" tone={2} hint="All time, per buyer" />
      </div>

      <section className="finance-panel">
        <h2>Highest lifetime value</h2>
        <p className="finance-note">Lifetime figures cover all time; the date range above governs which period the counters describe.</p>
        <Table
          empty="No customer has placed an order yet."
          rows={data.topCustomers}
          columns={[
            { key: 'name', label: 'Customer', render: (row) => <><b>{row.name}</b><small>{row.email}</small></> },
            { key: 'orders', label: 'Orders', numeric: true, render: (row) => number(row.orders) },
            { key: 'ltv', label: 'Lifetime value', numeric: true, render: (row) => row.lifetimeValue.display },
            { key: 'refunded', label: 'Refunded', numeric: true, render: (row) => row.refunded.display },
            { key: 'last', label: 'Last order', numeric: true, render: (row) => formatWhen(row.lastOrderAt) },
          ]}
        />
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------

export default function AdminFinancePages({ type = 'finance' }) {
  const config = CONFIG[type] ?? CONFIG.finance
  const [range, setRange] = useState('30d')
  const query = useApiQuery((signal) => config.fetch({ range }, signal), [type, range])

  const rangeLabel = RANGE_OPTIONS.find(([value]) => value === range)?.[1]?.toLowerCase() ?? range
  const data = query.data

  return (
    <AdminLayout>
      <div className="finance-page">
        <div className="finance-heading">
          <div>
            <h1>{config.title}</h1>
            <p>Home <Icon name="chevron-right" /> {config.crumb} <Icon name="chevron-right" /> {config.title}</p>
          </div>
          <div className="finance-ranges">
            {RANGE_OPTIONS.map(([value, label]) => (
              <button type="button" key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{label}</button>
            ))}
          </div>
        </div>

        {query.isLoading && <LoadingState label="Loading figures" />}
        {query.isError && !query.isLoading && (
          <section className="finance-panel">
            <p className="finance-note error">{describeApiError(query.error)}</p>
            <ErrorState onRetry={query.refetch} />
          </section>
        )}

        {!query.isLoading && !query.isError && data && (
          type === 'marketplace' ? <MarketplaceView data={data} rangeLabel={rangeLabel} />
            : type === 'seller' ? <SellerView data={data} />
              : type === 'customer' ? <CustomerView data={data} rangeLabel={rangeLabel} />
                : <FinanceView data={data} />
        )}

        {!query.isLoading && !query.isError && !data && (
          <section className="finance-panel">
            <EmptyState icon="money-bill" title="Nothing to report yet" description="Figures appear here once the marketplace has traded." />
          </section>
        )}
      </div>
    </AdminLayout>
  )
}
