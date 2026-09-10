import { useEffect, useMemo, useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading, Table } from './AdminComponents'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import './customer-pages.css'

/**
 * Customers and Reviews are real now, backed by `server/src/modules/admin` — every buyer who
 * has placed a real order, aggregated from order_items the same way the seller-scoped
 * Customers page is (server/src/modules/admin/customers.service.js), and every real,
 * verified-purchase review platform-wide (product_reviews, migration 011).
 *
 * "Customer Details" used to be a wildcard route with no id param to read, showing the same
 * hard-coded "Ali Hassan" profile for every row — removed rather than kept as a second fake
 * page; clicking a customer now opens Explore filtered to nothing useful is worse than not
 * linking at all, so rows are informational only until a real detail endpoint exists.
 *
 * Complaints and Blocked Accounts stay honest not-connected pages: there is still no
 * complaints/ticketing system and no account-blocking/moderation system anywhere in this
 * schema, and building either is a new feature, not a wiring fix.
 */

function AdminCustomersList() {
  const [search, setSearch] = useState('')
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.admin.customers(signal), [])

  const rows = useMemo(() => (data?.customers ?? [])
    .filter((customer) => `${customer.name} ${customer.email}`.toLowerCase().includes(search.toLowerCase()))
    .map((customer) => [
      customer.name,
      customer.email,
      customer.orderCount,
      customer.totalSpent.display,
      new Date(customer.lastOrderAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }),
    ]), [data, search])

  const idByEmail = useMemo(
    () => new Map((data?.customers ?? []).map((customer) => [customer.email, customer.id])),
    [data],
  )

  return <AdminLayout>
    <div className="customer-page">
      <Heading section="customer" crumb="Customers" title="Customers" />

      {isLoading && <LoadingState label="Loading customers" />}
      {error && !isLoading && <ErrorState title="We could not load customers" description={describeApiError(error)} onRetry={refetch} />}

      {data && <>
        <div className="customer-kpis">
          <article><span className="customer-kpi-icon"><Icon name="users" /></span><small>Total Customers</small><strong>{data.summary.totalCustomers}</strong></article>
          <article><span className="customer-kpi-icon tone-1"><Icon name="rotate" /></span><small>Repeat Customers</small><strong>{data.summary.repeatCustomers}</strong></article>
          <article><span className="customer-kpi-icon tone-4"><Icon name="sack-dollar" /></span><small>Total Spend (delivered)</small><strong>{data.summary.totalSpent.display}</strong></article>
        </div>

        <div className="customer-filters">
          <label><Icon name="magnifying-glass" /><input placeholder="Search by name or email" aria-label="Search customers" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>

        <section className="customer-panel">
          <Table
            section="customer"
            headers={['Customer', 'Email', 'Orders', 'Total Spent', 'Last Order']}
            rows={rows}
            /* The name is a door now. `/admin/customers/:id` exists, so the row is no longer
               the end of the road. */
            links={{ 0: (row) => { const id = idByEmail.get(row[1]); if (id) navigateTo(`/customers/${id}`) } }}
            emptyIcon="users"
            emptyLabel="customers"
            total={rows.length}
          />
        </section>
      </>}
    </div>
  </AdminLayout>
}

function AdminReviewsList() {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.admin.reviews.list({ pageSize: 50 }, signal), [])

  const rows = useMemo(() => (data?.reviews ?? []).map((review) => [
    review.productName,
    review.sellerName,
    review.author,
    '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating),
    review.body.length > 90 ? `${review.body.slice(0, 90)}…` : review.body,
    new Date(review.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }),
  ]), [data])

  return <AdminLayout>
    <div className="customer-page">
      <Heading section="customer" crumb="Reviews" title="Seller Reviews" />

      {isLoading && <LoadingState label="Loading reviews" />}
      {error && !isLoading && <ErrorState title="We could not load reviews" description={describeApiError(error)} onRetry={refetch} />}

      {data && <>
        <div className="customer-kpis">
          <article><span className="customer-kpi-icon"><Icon name="star" /></span><small>Total Reviews</small><strong>{data.summary.count}</strong></article>
          <article><span className="customer-kpi-icon tone-4"><Icon name="star-half-stroke" /></span><small>Average Rating</small><strong>{data.summary.count > 0 ? data.summary.average.toFixed(1) : '—'}</strong></article>
          <article><span className="customer-kpi-icon tone-3"><Icon name="triangle-exclamation" /></span><small>Needs Attention</small><strong>{data.summary.needsAttention}</strong></article>
        </div>

        <section className="customer-panel">
          {data.reviews.length === 0
            ? <EmptyState icon="star" title="No reviews yet" description="Reviews will appear here once buyers start reviewing delivered orders." />
            : <Table section="customer" headers={['Product', 'Seller', 'Buyer', 'Rating', 'Review', 'Date']} rows={rows} emptyIcon="star" emptyLabel="reviews" total={rows.length} />}
        </section>
      </>}
    </div>
  </AdminLayout>
}

/**
 * The old `/admin/customers/*` detail route was an unnamed wildcard with no id param to
 * read — it rendered the same hard-coded profile for every row. Rather than build a second
 * fake page, a visit here bounces back to the real list.
 */
function CustomerDetailRedirect() {
  useEffect(() => { navigateTo('/customers') }, [])
  return null
}

export default function AdminCustomerPages({ type = 'customers', detail = false }) {
  if (detail) return <CustomerDetailRedirect />
  return type === 'reviews' ? <AdminReviewsList /> : <AdminCustomersList />
}
