import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import Icon from '@mirwal/shared/Icon'
import { Heading } from './AdminComponents'
import { LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import './customer-pages.css'

/**
 * One buyer.
 *
 * `/admin/customers/*` was a route that bounced straight back to the list, because there was no
 * detail endpoint behind it — a name in a table was the end of the road, and answering "why is
 * this person complaining" meant searching Orders by name and hoping the spelling matched.
 *
 * Deliberately a support and risk view rather than a profile editor. An operator has no
 * business rewriting somebody's name, address or phone number, so nothing here writes: there is
 * no endpoint that would let it, which is the honest way to express that rule.
 *
 * The return rate is shown as a rate rather than a count on purpose. Ten returns out of a
 * thousand items is an ordinary shopper; ten out of twelve is a pattern — and a raw count
 * invites exactly the wrong conclusion about the marketplace's best customers, who by
 * definition return the most things.
 */
export default function AdminCustomerDetail() {
  const location = useLocation()
  const customerId = location.pathname.split('/').filter(Boolean).pop()

  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.admin.customer(customerId, signal),
    [customerId],
  )

  if (isLoading) return <AdminLayout><LoadingState label="Loading customer" /></AdminLayout>
  if (error) {
    return (
      <AdminLayout>
        <p className="customer-flash error" role="alert">{describeApiError(error)}</p>
        <ErrorState onRetry={refetch} />
      </AdminLayout>
    )
  }

  const customer = data
  const { totals } = customer

  return (
    <AdminLayout>
      <div className="customer-page">
        <button type="button" className="table-link" onClick={() => navigateTo('/customers')}>
          <Icon name="chevron-left" /> All customers
        </button>
        <Heading section="customer" crumb="Customers" title={customer.name} />

        <div className="customer-detail-grid">
          <section className="customer-panel">
            <h2>Contact</h2>
            <dl className="customer-facts">
              <dt>Email</dt>
              <dd>
                {customer.email}
                {/* Whether Mirwal can actually reach them is the first thing support needs. */}
                {customer.emailVerified
                  ? <span className="customer-verified"><Icon name="circle-check" /> verified</span>
                  : <span className="customer-unverified">not verified</span>}
              </dd>
              <dt>Phone</dt>
              <dd>
                {customer.phone ?? '—'}
                {customer.phone && (customer.phoneVerified
                  ? <span className="customer-verified"><Icon name="circle-check" /> verified</span>
                  : <span className="customer-unverified">not verified</span>)}
              </dd>
              <dt>Location</dt><dd>{[customer.city, customer.country].filter(Boolean).join(', ') || '—'}</dd>
              <dt>Account</dt><dd>{customer.status}</dd>
              <dt>Joined</dt><dd>{new Date(customer.joinedAt).toLocaleDateString('en-PK')}</dd>
              <dt>Last seen</dt><dd>{customer.lastLoginAt ? new Date(customer.lastLoginAt).toLocaleDateString('en-PK') : 'Never signed in'}</dd>
            </dl>
          </section>

          <section className="customer-panel">
            <h2>Trading</h2>
            <div className="customer-stats">
              <article><small>Orders</small><strong>{totals.orders}</strong></article>
              {/* Delivered only, matching the seller-side figure, so a cancelled basket is
                  never counted as money spent. */}
              <article><small>Spent (delivered)</small><strong>{totals.spent.display}</strong></article>
              <article><small>Items cancelled</small><strong>{totals.cancelledItems}</strong></article>
              <article className={totals.returnRate >= 30 ? 'tone-warn' : ''}>
                <small>Return rate</small>
                <strong>{totals.returnRate}%</strong>
                <em>{totals.returnedItems} of {totals.items} items</em>
              </article>
            </div>
          </section>
        </div>

        <section className="customer-panel">
          <h2>Orders</h2>
          {customer.orders.length === 0
            ? <p className="customer-empty">No orders yet.</p>
            : (
              <table className="customer-table">
                <thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Status</th><th>Payment</th><th>Placed</th></tr></thead>
                <tbody>
                  {customer.orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <button type="button" className="table-link" onClick={() => navigateTo(`/orders/${order.id}`)}>
                          {order.orderNumber}
                        </button>
                      </td>
                      <td>{order.itemCount}</td>
                      <td>{order.total.display}</td>
                      <td>{String(order.status).replace(/_/g, ' ')}</td>
                      <td>{String(order.paymentStatus).replace(/_/g, ' ')}</td>
                      <td>{new Date(order.placedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          {customer.totals.orders > customer.orders.length && (
            <p className="customer-empty">Showing the {customer.orders.length} most recent of {customer.totals.orders}.</p>
          )}
        </section>

        {customer.returns.length > 0 && (
          <section className="customer-panel">
            <h2>Returns</h2>
            <table className="customer-table">
              <thead><tr><th>Product</th><th>Reason</th><th>Status</th><th>Filed</th></tr></thead>
              <tbody>
                {customer.returns.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.product}</td>
                    <td>{String(entry.reason).replace(/_/g, ' ')}</td>
                    <td>{String(entry.status).replace(/_/g, ' ')}</td>
                    <td>{new Date(entry.at.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AdminLayout>
  )
}
