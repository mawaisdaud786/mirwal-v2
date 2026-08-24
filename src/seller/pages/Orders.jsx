import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { DataTable, Pagination } from '../components/SellerComponents'
import { allOrders, orderStatuses } from '../../data/sellerMockData'
import './orders.css'

const Orders = () => {
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [selectedOrders, setSelectedOrders] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Filter orders
  const filteredOrders = allOrders.filter((order) => {
    const matchesStatus = statusFilter === 'all' || order.status.toLowerCase() === statusFilter.toLowerCase()
    const matchesSearch =
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customer.email.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesStatus && matchesSearch
  })

  const totalOrders = filteredOrders.length
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * perPage, currentPage * perPage)
  const totalPages = Math.ceil(totalOrders / perPage)

  // Table columns
  const columns = [
    {
      key: 'checkbox',
      label: '☑️',
      render: (val, row) => (
        <input
          type="checkbox"
          className="table-checkbox"
          checked={selectedOrders.includes(row.id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedOrders([...selectedOrders, row.id])
            } else {
              setSelectedOrders(selectedOrders.filter((id) => id !== row.id))
            }
          }}
        />
      ),
    },
    {
      key: 'id',
      label: 'Order ID',
      render: (val) => <span className="table-cell-order-id">{val}</span>,
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (val) => (
        <div className="table-cell-content">
          <div className="table-avatar">{val.avatar}</div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '500' }}>{val.name}</div>
            <div className="table-cell-text-muted">{val.email}</div>
          </div>
        </div>
      ),
    },
    { key: 'date', label: 'Date' },
    {
      key: 'items',
      label: 'Products',
      render: (val) => (
        <span style={{ fontSize: '12px' }}>
          <strong>{val}</strong> Items
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (val) => <span className="table-cell-amount">Rs. {val.toLocaleString()}</span>,
    },
    {
      key: 'paymentMethod',
      label: 'Payment',
      render: (val) => <span style={{ fontSize: '12px' }}>{val}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (val, row) => {
        const statusColorMap = {
          Delivered: { bg: 'rgba(53, 147, 84, 0.15)', color: 'var(--color-success)' },
          Processing: { bg: 'rgba(243, 154, 0, 0.15)', color: '#f39a00' },
          Shipped: { bg: 'rgba(104, 71, 199, 0.15)', color: 'var(--color-info)' },
          Cancelled: { bg: 'rgba(227, 61, 47, 0.15)', color: 'var(--color-danger)' },
        }
        const colors = statusColorMap[val] || { bg: 'rgba(0, 0, 0, 0.08)', color: 'var(--color-text)' }
        return (
          <span
            style={{
              background: colors.bg,
              color: colors.color,
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
            }}
          >
            {val}
          </span>
        )
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (val, row) => (
        <div className="table-actions">
          <button
            className="table-action-btn"
            title="View"
            onClick={() => window.history.pushState({}, '', `/seller/orders/${row.id}`)}
          >
            👁️
          </button>
          <button
            className="table-action-btn"
            title="More Options"
            onClick={() => {
              /* Show menu */
            }}
          >
            ⋮
          </button>
        </div>
      ),
    },
  ]

  return (
    <SellerLayout
      activeItem="all-orders"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => window.history.pushState({}, '', '/seller') },
        { label: 'Orders' },
      ]}
    >
      <div className="orders-container">
        {/* Header */}
        <div className="orders-header">
          <div className="orders-header-left">
            <h1>Orders</h1>
            <p>Manage and track all orders from your store.</p>
          </div>
          <div className="orders-header-actions">
            <button className="btn-export">
              📥 Export
            </button>
            <button className="btn-filter">
              🔽 Filter
            </button>
          </div>
        </div>

        {/* Status Overview */}
        <div className="status-overview">
          <div
            className={`status-card ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('all')
              setCurrentPage(1)
            }}
          >
            <div className="status-card-icon">📋</div>
            <div className="status-card-count">{orderStatuses.all}</div>
            <div className="status-card-label">All Orders</div>
          </div>

          <div
            className={`status-card ${statusFilter === 'pending' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('pending')
              setCurrentPage(1)
            }}
          >
            <div className="status-card-icon">⏳</div>
            <div className="status-card-count">{orderStatuses.pending}</div>
            <div className="status-card-label">Pending</div>
          </div>

          <div
            className={`status-card ${statusFilter === 'processing' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('processing')
              setCurrentPage(1)
            }}
          >
            <div className="status-card-icon">⚙️</div>
            <div className="status-card-count">{orderStatuses.processing}</div>
            <div className="status-card-label">Processing</div>
          </div>

          <div
            className={`status-card ${statusFilter === 'shipped' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('shipped')
              setCurrentPage(1)
            }}
          >
            <div className="status-card-icon">🚚</div>
            <div className="status-card-count">{orderStatuses.shipped}</div>
            <div className="status-card-label">Shipped</div>
          </div>

          <div
            className={`status-card ${statusFilter === 'delivered' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('delivered')
              setCurrentPage(1)
            }}
          >
            <div className="status-card-icon">✓</div>
            <div className="status-card-count">{orderStatuses.delivered}</div>
            <div className="status-card-label">Delivered</div>
          </div>

          <div
            className={`status-card ${statusFilter === 'cancelled' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('cancelled')
              setCurrentPage(1)
            }}
          >
            <div className="status-card-icon">✕</div>
            <div className="status-card-count">{orderStatuses.cancelled}</div>
            <div className="status-card-label">Cancelled</div>
          </div>
        </div>

        {/* Filters */}
        <div className="filters-section">
          <div className="filters-row">
            <div className="filter-group">
              <label className="filter-label">Search Orders</label>
              <input
                type="text"
                className="filter-input"
                placeholder="Search by order ID, customer or product..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>

            <div className="filter-group">
              <label className="filter-label">Status</label>
              <select
                className="filter-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  setCurrentPage(1)
                }}
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="filter-group">
              <label className="filter-label">Date Range</label>
              <input type="date" className="filter-input" />
            </div>

            <div className="filter-actions">
              <button
                className="btn-reset"
                onClick={() => {
                  setStatusFilter('all')
                  setSearchQuery('')
                  setCurrentPage(1)
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedOrders.length > 0 && (
          <div className="bulk-actions">
            <input
              type="checkbox"
              className="bulk-actions-checkbox"
              checked={selectedOrders.length === paginatedOrders.length}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedOrders(paginatedOrders.map((o) => o.id))
                } else {
                  setSelectedOrders([])
                }
              }}
            />
            <div className="bulk-actions-info">{selectedOrders.length} orders selected</div>
            <div className="bulk-actions-buttons">
              <button className="bulk-action-btn">Mark as Shipped</button>
              <button className="bulk-action-btn">Print Labels</button>
              <button className="bulk-action-btn danger">Cancel</button>
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div className="orders-table-card">
          <div className="orders-table-content">
            <DataTable columns={columns} data={paginatedOrders} />
          </div>
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          perPage={perPage}
          total={totalOrders}
          onPageChange={setCurrentPage}
          onPerPageChange={setPerPage}
        />
      </div>
    </SellerLayout>
  )
}

export default Orders
