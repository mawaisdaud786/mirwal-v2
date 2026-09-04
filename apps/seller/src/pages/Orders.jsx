import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'
import './orders.css'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'

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
const SORTERS = {
  order: (a, b) => a.orderNumber.localeCompare(b.orderNumber),
  amount: (a, b) => Number(a.lineTotal.amount) - Number(b.lineTotal.amount),
  date: (a, b) => new Date(b.placedAt) - new Date(a.placedAt),
}

function SortHeader({ id, label, sort, onSort }) {
  const active = sort.key === id
  return <th>
    <button type="button" className={`sort-header${active ? ' active' : ''}`} onClick={() => onSort(id)}>
      {label}
      <i className={`fa-solid fa-arrow-${active && sort.dir === 'asc' ? 'up' : 'down'}${active ? '' : ' is-idle'}`} aria-hidden="true" />
    </button>
  </th>
}

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
  const { data: items, error, isLoading, refetch } = useApiQuery((signal) => api.seller.orders(signal), [])
  const [updatingId, setUpdatingId] = useState(null)
  const [updateError, setUpdateError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const toggleSort = (key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  async function changeStatus(item, nextStatus) {
    if (nextStatus === item.status) return
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

  const counts = useMemo(() => {
    const list = items ?? []
    return {
      all: list.length,
      processing: list.filter((i) => ['pending', 'confirmed', 'processing'].includes(i.status)).length,
      shipped: list.filter((i) => i.status === 'shipped').length,
      delivered: list.filter((i) => i.status === 'delivered').length,
      cancelled: list.filter((i) => i.status === 'cancelled').length,
    }
  }, [items])

  const filtered = useMemo(() => {
    const matched = (items ?? []).filter((item) => {
      const matchesStatus = status === 'all'
        || (status === 'processing' && ['pending', 'confirmed', 'processing'].includes(item.status))
        || item.status === status
      const query = search.toLowerCase()
      const matchesSearch = !query || `${item.orderNumber} ${item.shipTo?.name ?? ''} ${item.product.name}`.toLowerCase().includes(query)
      return matchesStatus && matchesSearch
    })
    const sorted = [...matched].sort(SORTERS[sort.key])
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [items, search, status, sort])

  const resetFilters = () => { setSearch(''); setStatus('all') }

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
            <label><Icon name="magnifying-glass" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by order, buyer or product…" aria-label="Search orders" /></label>
            <button type="button" onClick={resetFilters}><Icon name="rotate-left" /> Reset</button>
          </div>
          <div className="order-tabs">
            {[['all', 'All', counts.all], ['processing', 'Processing', counts.processing], ['shipped', 'Shipped', counts.shipped], ['delivered', 'Delivered', counts.delivered], ['cancelled', 'Cancelled', counts.cancelled]].map(([value, label, count]) => (
              <button type="button" className={status === value ? 'active' : ''} key={value} onClick={() => setStatus(value)}>{label} ({count})</button>
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
                    <SortHeader id="order" label="Order" sort={sort} onSort={toggleSort} />
                    <th className="plain-th">Ship To</th>
                    <th className="plain-th">Product</th>
                    <th className="plain-th">Qty</th>
                    <SortHeader id="amount" label="Amount" sort={sort} onSort={toggleSort} />
                    <th className="plain-th">Status</th>
                    <SortHeader id="date" label="Date" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.orderNumber}</strong></td>
                      <td className="order-customer"><span>{item.shipTo?.name?.charAt(0) ?? '?'}</span><span><strong>{item.shipTo?.name ?? 'Unknown'}</strong><small>{item.shipTo?.city ?? ''}</small></span></td>
                      <td><strong>{item.product.name}</strong>{item.variantName && <small>{item.variantName}</small>}</td>
                      <td>{item.quantity}</td>
                      <td>{item.lineTotal.display}</td>
                      <td><StatusSelect item={item} onChange={changeStatus} disabled={updatingId === item.id} /></td>
                      <td>{new Date(item.placedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="orders-pagination"><span>Showing {filtered.length} of {items.length} orders</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  </SellerLayout>
}
export default Orders
