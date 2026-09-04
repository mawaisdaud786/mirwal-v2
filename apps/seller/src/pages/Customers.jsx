import SellerLayout from '../SellerLayout'
import { StatCard, DataTable, EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from '../api'
import '../pages/finance.css'
import '../pages/finance-extra.css'
import Icon from '@mirwal/shared/Icon'

/**
 * Customer list was entirely fabricated — invented names, phone numbers, order counts and
 * spend totals with no real orders system behind any of it. Real now: every row is a buyer
 * who has actually ordered from this seller, aggregated from their own order_items the same
 * way finance.service.js computes real revenue (server/src/modules/sellers/customers.service.js).
 * "Total spent" only counts delivered items, so a cancelled order never inflates a customer's
 * spend.
 */
function CustomersTable({ customers }) {
  return <DataTable
    columns={[
      { key: 'name', label: 'Customer' },
      { key: 'email', label: 'Email' },
      { key: 'orderCount', label: 'Orders' },
      { key: 'totalSpent', label: 'Total Spent', render: (value) => value.display },
      { key: 'lastOrderAt', label: 'Last Order', render: (value) => new Date(value).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) },
    ]}
    data={customers}
  />
}

const Customers = () => {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.seller.customers(signal), [])

  return (
    <SellerLayout activeItem="customers" breadcrumbs={[{ label: 'Dashboard' }, { label: 'Customers' }]}>
      <div className="finance-container">
        <div className="finance-header">
          <div>
            <h1>Customers</h1>
            <p>Buyers who have actually ordered from your store.</p>
          </div>
        </div>

        {isLoading && <LoadingState label="Loading customers" />}
        {error && !isLoading && <ErrorState title="We could not load your customers" description={describeApiError(error)} onRetry={refetch} />}

        {data && <>
          <div className="finance-stat-grid">
            <StatCard label="Total Customers" value={data.summary.totalCustomers} icon={<Icon name="users" />} />
            <StatCard label="Repeat Customers" value={data.summary.repeatCustomers} icon={<Icon name="rotate" />} change={data.summary.totalCustomers > 0 ? `${Math.round((data.summary.repeatCustomers / data.summary.totalCustomers) * 100)}% of customers` : null} />
            <StatCard label="Total Spent (delivered)" value={data.summary.totalSpent.display} icon={<Icon name="sack-dollar" />} />
          </div>

          <section className="finance-panel">
            <h2>All Customers</h2>
            {data.customers.length === 0
              ? <EmptyState icon={<Icon name="users" />} title="No customers yet" text="Once someone orders from your store, they'll show up here." />
              : <CustomersTable customers={data.customers} />}
          </section>
        </>}
      </div>
    </SellerLayout>
  )
}

export default Customers
