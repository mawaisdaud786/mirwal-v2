import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { Heading, Table } from './AdminComponents'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { Pagination } from './AdminComponents'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import './order-pages.css'
import AdminOrderIntervention from './AdminOrderIntervention'

/**
 * Orders, Order Details and Disputes, backed by `server/src/modules/admin`. Disputes reads the
 * same `return_requests`/`refunds` tables the seller and buyer views already use (migrations
 * 005/008) — platform-wide, read-only oversight, since approving or rejecting a return is the
 * seller's own decision, not an admin action.
 *
 * The per-item return, refund and dispute views used to be not-connected stubs here. They now
 * live in `AdminFulfilmentPages.jsx`, which has queues for both and the one real admin action:
 * settling a refund that has to be paid by hand.
 *
 * `orders.status` itself is never updated after checkout — only each `order_items.status` is,
 * since a multi-seller order is fulfilled per seller — so the list's Status column is a
 * server-computed rollup (see `listOrdersForAdmin`), the same one `ProfileOrdersPage.jsx`
 * computes for the buyer's own view, not the raw column.
 */

const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' }
// order_items carry two extra pre-fulfillment statuses (pending/confirmed) that the
// order-level rollup never shows — order-pages.css only has a style for "processing", so
// both map onto it rather than falling back to the unstyled default (which would render as
// the same green as "delivered," implying success prematurely).
const STATUS_CLASS = { pending: 'processing', confirmed: 'processing' }
function Status({ value }) { return <span className={`order-status ${STATUS_CLASS[value] ?? value}`}>{STATUS_LABEL[value] ?? value}</span> }

/** The rolled-up item status, which is what an operator scanning this list actually means. */
const ORDER_TABS = [
  ['', 'All'],
  ['processing', 'Processing'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
]

function AdminOrdersList() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  /**
   * The list is paged and filtered by the server.
   *
   * `GET /admin/orders` used to return every order on the marketplace in one response, and the
   * search box filtered that array in the browser — fine at seven hundred orders, untenable at
   * seventy thousand, and the reason there was no way to reach anything past what had arrived.
   */
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.admin.orders.list(
      {
        page, pageSize,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(status ? { status } : {}),
        ...(paymentStatus ? { paymentStatus } : {}),
      },
      signal,
    ),
    [page, pageSize, search, status, paymentStatus],
  )
  const counts = useApiQuery((signal) => api.admin.orders.counts(signal), [])

  const orders = data?.items ?? []
  const pagination = data?.pagination ?? { page, pageSize, total: 0 }
  const totals = counts.data ?? {}

  // Changing what is listed sends the reader back to page one; staying on page 40 of a result
  // set that now has two shows an empty table and reads as a bug.
  const refine = (apply) => { apply(); setPage(1) }

  const rows = orders.map((order) => [
    order.orderNumber,
    order.buyer.name,
    order.itemCount,
    order.total.display,
    order.paymentMethod === 'cod' ? 'Cash on Delivery' : order.paymentMethod,
    order.status,
    new Date(order.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }),
  ])

  const byOrderNumber = new Map(orders.map((order) => [order.orderNumber, order]))

  return (
    <AdminLayout>
      <div className="order-page">
        <Heading section="order" crumb="Orders" title="All Orders" />

        {!counts.isLoading && (
          <div className="order-kpis">
            <article><span className="order-kpi-icon"><Icon name="bag-shopping" /></span><small>Total Orders</small><strong>{totals.total ?? 0}</strong></article>
            <article><span className="order-kpi-icon tone-2"><Icon name="clock" /></span><small>Processing</small><strong>{totals.processing ?? 0}</strong></article>
            <article><span className="order-kpi-icon tone-2"><Icon name="truck" /></span><small>Shipped</small><strong>{totals.shipped ?? 0}</strong></article>
            <article><span className="order-kpi-icon tone-1"><Icon name="circle-check" /></span><small>Delivered</small><strong>{totals.delivered ?? 0}</strong></article>
          </div>
        )}

        <section className="order-panel">
          <nav className="order-status-tabs">
            {ORDER_TABS.map(([value, label]) => (
              <button type="button" key={value || 'all'} className={status === value ? 'active' : ''} onClick={() => refine(() => setStatus(value))}>
                {label}
                {value && totals[value] > 0 && <em>{totals[value]}</em>}
              </button>
            ))}
          </nav>

          <div className="order-filters">
            <label>
              <Icon name="magnifying-glass" />
              <input
                value={search}
                onChange={(event) => refine(() => setSearch(event.target.value))}
                placeholder="Search by order number, buyer name or email..."
                aria-label="Search orders"
              />
            </label>
            <select aria-label="Payment status" value={paymentStatus} onChange={(event) => refine(() => setPaymentStatus(event.target.value))}>
              <option value="">Any payment status</option>
              <option value="paid">Paid</option>
              <option value="pending">Unpaid</option>
              <option value="partially_refunded">Partly refunded</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed</option>
            </select>
            <button type="button" onClick={() => refine(() => { setSearch(''); setStatus(''); setPaymentStatus('') })}>
              <Icon name="rotate-left" /> Reset
            </button>
          </div>

          {isLoading && <LoadingState label="Loading orders" />}
          {error && !isLoading && <ErrorState onRetry={refetch} />}

          {!isLoading && !error && (
            <>
              <Table
                section="order"
                headers={['Order ID', 'Buyer', 'Items', 'Total', 'Payment', 'Status', 'Date']}
                rows={rows}
                statusIndex={[5]}
                StatusComponent={Status}
                linkClass="order-link"
                /**
                 * Two doors: the order, and the person who placed it. Reaching a buyer from
                 * their order previously meant going to Customers and searching by name.
                 */
                links={{
                  0: (row) => navigateTo(`/orders/${byOrderNumber.get(row[0])?.id}`),
                  1: (row) => {
                    const buyerId = byOrderNumber.get(row[0])?.buyer?.id
                    if (buyerId) navigateTo(`/customers/${buyerId}`)
                  },
                }}
                emptyIcon="bag-shopping"
                emptyLabel="orders"
                // The rows are one server page already; paging them again in the browser would
                // page a page.
                paginate={false}
              />

              <Pagination
                section="order"
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                onPage={setPage}
                onPageSize={(size) => { setPageSize(size); setPage(1) }}
              />
            </>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}

function Info({ rows }) { return <div className="info-list">{rows.map(([label, value]) => <p key={label}><span>{label}</span><b>{value}</b></p>)}</div> }

function AdminOrderDetail() {
  const location = useLocation()
  const orderId = location.pathname.split('/').filter(Boolean).pop()
  const { data: order, error, isLoading, refetch } = useApiQuery((signal) => api.admin.orders.get(orderId, signal), [orderId])

  return (
    <AdminLayout>
      <div className="order-page">
        <Heading section="order" crumb="Orders" title={order ? `Order ${order.orderNumber}` : 'Order Details'} />

        {isLoading && <LoadingState label="Loading order" />}
        {error && !isLoading && <ErrorState onRetry={refetch} />}

        {!isLoading && !error && order && (
          <>
            <div className="detail-grid three">
              <div className="detail-card">
                <h2>Order Summary</h2>
                <Info rows={[
                  ['Order ID', order.orderNumber],
                  ['Placed', new Date(order.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-PK')],
                  ['Payment Method', order.paymentMethod === 'cod' ? 'Cash on Delivery' : order.paymentMethod],
                  ['Payment Status', order.paymentStatus === 'paid' ? 'Paid' : 'Pending'],
                  ['Total Amount', order.total.display],
                ]} />
              </div>
              <div className="detail-card">
                <h2>Buyer</h2>
                <Info rows={[['Name', order.buyer.name], ['Email', order.buyer.email]]} />
              </div>
              <div className="detail-card">
                <h2>Shipping Address</h2>
                <Info rows={[
                  [order.shippingAddress.fullName, order.shippingAddress.phone],
                  [order.shippingAddress.line1, `${order.shippingAddress.city}${order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ''}`],
                ]} />
              </div>
            </div>

            <div className="detail-card">
              <h2>Order Items</h2>
              <Table
                section="order"
                headers={['Product', 'Seller', 'Price', 'Qty', 'Total', 'Status']}
                rows={order.items.map((item) => [
                  item.product.name, item.seller?.name ?? '—', item.unitPrice.display, item.quantity, item.lineTotal.display, item.status,
                ])}
                statusIndex={[5]}
                StatusComponent={Status}
                paginate={false}
              />
            </div>

            {/* Cancelling for someone, refunding without a return, and reading what the two
                parties actually said. None of it was reachable from here. */}
            <AdminOrderIntervention order={order} onChanged={refetch} />
          </>
        )}
      </div>
    </AdminLayout>
  )
}

const DISPUTE_STATUS_LABEL = { requested: 'Pending Review', approved: 'Approved', rejected: 'Rejected' }
const DISPUTE_STATUS_CLASS = { requested: 'processing', approved: 'delivered', rejected: 'cancelled' }
function DisputeStatus({ value }) { return <span className={`order-status ${DISPUTE_STATUS_CLASS[value] ?? value}`}>{DISPUTE_STATUS_LABEL[value] ?? value}</span> }

/**
 * Real return requests + the refunds they caused, across every seller (server/src/modules/
 * admin/disputes.service.js). This is oversight only — approving/rejecting a return is the
 * seller's own decision (ReturnsRefunds.jsx), so there is no action here, only visibility
 * into every dispute on the platform and which ones still owe the buyer a manual refund.
 */
function AdminDisputesList() {
  const [search, setSearch] = useState('')
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.admin.disputes.list(signal), [])

  const rows = useMemo(() => (data?.disputes ?? [])
    .filter((dispute) => `${dispute.orderNumber} ${dispute.buyerName} ${dispute.sellerName} ${dispute.productName}`.toLowerCase().includes(search.toLowerCase()))
    .map((dispute) => [
      dispute.orderNumber,
      dispute.productName,
      dispute.buyerName,
      dispute.sellerName,
      dispute.reason,
      dispute.amount.display,
      dispute.refund ? (dispute.refund.status === 'manual_required' ? 'Refund owed' : dispute.refund.status === 'succeeded' ? 'Refunded' : dispute.refund.status) : '—',
      dispute.status,
    ]), [data, search])

  return (
    <AdminLayout>
      <div className="order-page">
        <Heading section="order" crumb="Orders" title="Disputes" />

        {isLoading && <LoadingState label="Loading disputes" />}
        {error && !isLoading && <ErrorState title="We could not load disputes" description={describeApiError(error)} onRetry={refetch} />}

        {data && <>
          <div className="order-kpis">
            <article><span className="order-kpi-icon"><Icon name="rotate-left" /></span><small>Total Disputes</small><strong>{data.summary.total}</strong></article>
            {/* "Pending review" and "Approved" counted three of the ten states a return can be
                in, so every return awaiting a photograph, in transit, received or escalated was
                missing from the figures printed above the list it disagreed with. */}
            <article><span className="order-kpi-icon tone-2"><Icon name="clock" /></span><small>Still Open</small><strong>{data.summary.open}</strong></article>
            <article><span className="order-kpi-icon tone-3"><Icon name="scale-balanced" /></span><small>Escalated to Mirwal</small><strong>{data.summary.escalated}</strong></article>
            <article><span className="order-kpi-icon tone-3"><Icon name="triangle-exclamation" /></span><small>Refunds Owed</small><strong>{data.summary.refundsOwed}</strong></article>
          </div>

          <div className="order-filters">
            <label><Icon name="magnifying-glass" /><input placeholder="Search by order, buyer, seller or product" aria-label="Search disputes" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          </div>

          <section className="order-panel">
            {rows.length === 0
              ? <EmptyState icon="rotate-left" title="No disputes" description="Return requests filed by buyers will show up here, across every seller." />
              : <Table
                  section="order"
                  headers={['Order', 'Product', 'Buyer', 'Seller', 'Reason', 'Amount', 'Refund', 'Status']}
                  rows={rows}
                  statusIndex={[7]}
                  StatusComponent={DisputeStatus}
                  emptyIcon="rotate-left"
                  emptyLabel="disputes"
                  total={rows.length}
                />}
          </section>
        </>}
      </div>
    </AdminLayout>
  )
}

export default function AdminOrderPages({ type = 'orders', detail = false }) {
  if (detail) return <AdminOrderDetail />
  return type === 'orders' ? <AdminOrdersList /> : <AdminDisputesList />
}
