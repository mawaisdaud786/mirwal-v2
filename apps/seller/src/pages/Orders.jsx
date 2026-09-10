import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState, Pagination } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import './orders.css'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import ShipItemDialog from '../components/ShipItemDialog'
import OrderItemActions from '../components/OrderItemActions'

/**
 * Seller order management. Previously fully fabricated: fake customers with invented names,
 * emails and phone numbers (the same phone number on every row), fake payment methods and
 * transaction IDs, "324 total orders" attached to a table of 7 fake rows, and a status-change
 * dropdown that updated only local component state.
 *
 * Now backed by the real order system (see server/src/modules/orders): every row is a real
 * order item that actually belongs to this seller (`GET /seller/me/orders`, filtered by
 * `seller_id` server-side — never trusted from the client), and the status dropdown calls the
 * real `PATCH /seller/me/orders/:id/status`, which enforces both ownership and the forward-only
 * fulfillment state machine server-side.
 *
 * Search, status tabs and column sort added here on top of that real data — the table had none
 * of the filtering the redesign brief asked for, and all three are cheap to do honestly since
 * the full real list is already in hand (no new endpoint needed).
 */

const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' }
const NEXT_STATUS = { pending: ['pending', 'confirmed', 'cancelled'], confirmed: ['confirmed', 'processing', 'cancelled'], processing: ['processing', 'shipped', 'cancelled'], shipped: ['shipped', 'delivered'], delivered: ['delivered'], cancelled: ['cancelled'] }

function StatusSelect({ item, onChange, disabled }) {
  const options = NEXT_STATUS[item.status] ?? [item.status]
  return (
    <select
      className={`order-status-select ${item.status}`}
      value={item.status}
      disabled={disabled || options.length <= 1}
      onChange={(event) => onChange(item, event.target.value)}
    >
      {options.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
    </select>
  )
}

const Orders = () => {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  // The tab labels are the seller's language; `processing` is the pre-dispatch group rather
  // than a single status, and the API understands it as that.
  const statusParam = status === 'all' ? undefined : status
  /**
   * Paged and filtered by the server.
   *
   * This used to fetch every order line the store had ever sold and filter that array in the
   * browser, so working today's dispatches meant downloading years of history, and the tab
   * counts described only what had arrived.
   */
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.seller.orders(
      { page, pageSize: perPage, ...(statusParam ? { status: statusParam } : {}), ...(search.trim() ? { search: search.trim() } : {}) },
      signal,
    ),
    [page, perPage, statusParam, search],
  )
  const orderCounts = useApiQuery((signal) => api.seller.orderCounts(signal), [])
  const items = data?.items ?? []
  const pagination = data?.pagination ?? { page, pageSize: perPage, total: 0, totalPages: 1 }
  const [updatingId, setUpdatingId] = useState(null)
  const [updateError, setUpdateError] = useState('')

  async function changeStatus(item, nextStatus) {
    if (nextStatus === item.status) return
    /**
     * Shipping is not a status change.
     *
     * The API refuses `shipped` on this endpoint: it is what a shipment means, and a shipment
     * carries the carrier and tracking number the buyer needs. Opening the dialog here rather
     * than letting the request fail means the seller never sees an error for picking a legal
     * option out of a dropdown.
     */
    if (nextStatus === 'shipped') { setShipping(item); return }
    setUpdatingId(item.id)
    setUpdateError('')
    try {
      await api.seller.updateOrderItemStatus(item.id, nextStatus)
      refetch()
    } catch (requestError) {
      setUpdateError(describeApiError(requestError))
    } finally {
      setUpdatingId(null)
    }
  }

  const [shipping, setShipping] = useState(null)

  // Counts over the whole store, not the visible page — the previous version counted the
  // fetched array, so every tab silently described one page.
  const counts = orderCounts.data ?? {}

  const filtered = items

  const refine = (apply) => { apply(); setPage(1) }
  const resetFilters = () => refine(() => { setSearch(''); setStatus('all') })

  return <SellerLayout activeItem="all-orders" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Orders' }]}>
    <div className="orders-container">
      <div className="orders-header">
        <div><h1>Orders</h1><p>Manage and fulfill customer orders from your store.</p></div>
      </div>

      {updateError && <p className="orders-alert" role="alert">{updateError}</p>}

      {isLoading && <EmptyState icon={<Icon name="spinner" />} title="Loading orders" text="Fetching your order items…" />}
      {error && !isLoading && <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load orders" text={describeApiError(error)} actionLabel="Try again" onAction={refetch} />}

      {!isLoading && !error && (
        <div className="orders-workspace">
          <div className="orders-filters">
            <label><Icon name="magnifying-glass" /><input value={search} onChange={(event) => refine(() => setSearch(event.target.value))} placeholder="Search by order, buyer or product…" aria-label="Search orders" /></label>
            <button type="button" onClick={resetFilters}><Icon name="rotate-left" /> Reset</button>
          </div>
          <div className="order-tabs">
            {shipping && (
              <ShipItemDialog
                item={shipping}
                onClose={() => setShipping(null)}
                onShipped={() => { setShipping(null); refetch() }}
              />
            )}
            {[['all', 'All', counts.all], ['processing', 'Processing', counts.processing], ['shipped', 'Shipped', counts.shipped], ['delivered', 'Delivered', counts.delivered], ['cancelled', 'Cancelled', counts.cancelled]].map(([value, label, count]) => (
              <button type="button" className={status === value ? 'active' : ''} key={value} onClick={() => refine(() => setStatus(value))}>{label} ({count ?? 0})</button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Icon name="bag-shopping" />}
              title={items?.length ? 'No orders match your filters' : 'No orders yet'}
              text={items?.length ? 'Try adjusting your search or status filter.' : "When a shopper buys one of your products, it will show up here for you to fulfill."}
              actionLabel={items?.length ? 'Reset filters' : undefined}
              onAction={items?.length ? resetFilters : undefined}
            />
          ) : (
            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th className="plain-th">Order</th>
                    <th className="plain-th">Ship To</th>
                    <th className="plain-th">Product</th>
                    <th className="plain-th">Qty</th>
                    <th className="plain-th">Amount</th>
                    <th className="plain-th">Status</th>
                    <th className="plain-th">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      {/*
                        Every `<td>` below carries `data-label`, matched to the header it sits
                        under. Below `orders-table-mobile-breakpoint` (orders.css) the table
                        stops being a table at all — each row becomes its own card and each cell
                        becomes a labelled line, so a phone screen shows every column stacked
                        rather than a table wider than the screen with most of it scrolled out
                        of view. `data-label` is what supplies that line's label via CSS
                        `content: attr(data-label)`, so the two can never drift out of sync the
                        way a hard-coded second copy of "Date" elsewhere in this file could.
                      */}
                      <td data-label="Order">
                        {/* The order number opens the order: its lines, its buyer and the
                            conversation attached to it. */}
                        <button type="button" className="table-link" onClick={() => navigateTo(`/orders/${item.orderId}`)}>
                          <strong>{item.orderNumber}</strong>
                        </button>
                      </td>
                      <td className="order-customer" data-label="Ship To"><span>{item.shipTo?.name?.charAt(0) ?? '?'}</span><span><strong>{item.shipTo?.name ?? 'Unknown'}</strong><small>{item.shipTo?.city ?? ''}</small></span></td>
                      <td className="product-cell" data-label="Product">
                        {/* The API already returns this — `orders.service.js` joins `product_images`
                            for exactly this — the table just never rendered it. */}
                        {item.image
                          ? <img className="product-thumb" src={item.image} alt="" />
                          : <span className="product-thumb product-thumb-empty"><i className="fa-solid fa-image" aria-hidden="true" /></span>}
                        <span><strong>{item.product.name}</strong>{item.variantName && <small>{item.variantName}</small>}</span>
                      </td>
                      <td data-label="Qty">
                        {item.quantity}
                        {item.cancelled && <small className="order-qty-cancelled">{item.cancelled.quantity} cancelled</small>}
                      </td>
                      <td data-label="Amount">{item.lineTotal.display}</td>
                      <td data-label="Status" className="order-status-cell">
                        <StatusSelect item={item} onChange={changeStatus} disabled={updatingId === item.id} />
                        {/* Cancelling and answering the buyer both used to be impossible from
                            here: an item with no stock behind it sat in `processing`, and a
                            question could only reach Mirwal. */}
                        <OrderItemActions item={item} onChanged={refetch} />
                      </td>
                      <td data-label="Date">{new Date(item.placedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                currentPage={pagination.page}
                totalPages={pagination.totalPages ?? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}
                perPage={pagination.pageSize}
                total={pagination.total}
                onPageChange={setPage}
                onPerPageChange={(size) => { setPerPage(size); setPage(1) }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  </SellerLayout>
}
export default Orders
