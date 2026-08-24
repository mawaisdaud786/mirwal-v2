import SellerLayout from '../SellerLayout'
import { DataTable, Pagination } from '../components/SellerComponents'
import { customers } from '../../data/sellerMockData'
import { useState } from 'react'

const Customers = () => {
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const customerColumns = [
    {
      key: 'name',
      label: 'Customer',
      render: (val, row) => (
        <div className="table-cell-content">
          <div className="table-avatar">{row.avatar}</div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '500' }}>{val}</div>
            <div className="table-cell-text-muted">{row.email}</div>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone' },
    {
      key: 'orders',
      label: 'Orders',
      render: (val) => <strong>{val}</strong>,
    },
    {
      key: 'spent',
      label: 'Total Spent',
      render: (val) => <strong>Rs. {val.toLocaleString()}</strong>,
    },
    { key: 'lastOrder', label: 'Last Order' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <span
          style={{
            background: 'rgba(53, 147, 84, 0.15)',
            color: 'var(--color-success)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '600',
          }}
        >
          {val}
        </span>
      ),
    },
  ]

  const totalPages = Math.ceil(customers.length / perPage)
  const paginatedCustomers = customers.slice((currentPage - 1) * perPage, currentPage * perPage)

  return (
    <SellerLayout activeItem="customers" breadcrumbs={[{ label: 'Dashboard' }, { label: 'Customers' }]}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px', fontFamily: 'var(--font-heading)' }}>
            Customers
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0' }}>
            View and manage your store customers.
          </p>
        </div>

        {/* Customer Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-text)' }}>
              {customers.length}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Total Customers</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-success)' }}>
              Rs. {customers.reduce((sum, c) => sum + c.spent, 0).toLocaleString()}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Total Revenue</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-text)' }}>
              {Math.round(customers.reduce((sum, c) => sum + c.spent, 0) / customers.length)}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Avg. Customer Value</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-text)' }}>
              {Math.round(customers.reduce((sum, c) => sum + c.orders, 0) / customers.length)}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Avg. Orders</div>
          </div>
        </div>

        {/* Customers Table */}
        <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
          <DataTable columns={customerColumns} data={paginatedCustomers} />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            perPage={perPage}
            total={customers.length}
            onPageChange={setCurrentPage}
            onPerPageChange={setPerPage}
          />
        </div>
      </div>
    </SellerLayout>
  )
}

export default Customers
