import SellerLayout from '../SellerLayout'
import { DataTable, Pagination } from '../components/SellerComponents'
import { coupons } from '../../data/sellerMockData'
import { useState } from 'react'

const Coupons = () => {
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const couponColumns = [
    { key: 'name', label: 'Coupon Name' },
    { key: 'code', label: 'Code', render: (val) => <span style={{ fontFamily: 'monospace', fontWeight: '600' }}>{val}</span> },
    { key: 'discount', label: 'Discount' },
    { key: 'minOrder', label: 'Min. Order', render: (val) => `Rs. ${val.toLocaleString()}` },
    { key: 'usage', label: 'Usage' },
    { key: 'validity', label: 'Validity' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <span
          style={{
            background: val === 'Active' ? 'rgba(53, 147, 84, 0.15)' : 'rgba(243, 154, 0, 0.15)',
            color: val === 'Active' ? 'var(--color-success)' : '#f39a00',
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

  const totalPages = Math.ceil(coupons.length / perPage)
  const paginatedCoupons = coupons.slice((currentPage - 1) * perPage, currentPage * perPage)

  return (
    <SellerLayout activeItem="coupons" breadcrumbs={[{ label: 'Dashboard' }, { label: 'Coupons' }]}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px', fontFamily: 'var(--font-heading)' }}>
              Coupons
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0' }}>
              Create and manage discount coupons for your store.
            </p>
          </div>
          <button
            style={{
              padding: '10px 16px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: '0',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            ➕ Create New Coupon
          </button>
        </div>

        {/* Coupon Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-text)' }}>18</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Total Coupons</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-success)' }}>7</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Active</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#f39a00' }}>2</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Scheduled</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-danger)' }}>9</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Expired</div>
          </div>
        </div>

        {/* Coupons Table */}
        <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
          <DataTable columns={couponColumns} data={paginatedCoupons} />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            perPage={perPage}
            total={coupons.length}
            onPageChange={setCurrentPage}
            onPerPageChange={setPerPage}
          />
        </div>
      </div>
    </SellerLayout>
  )
}

export default Coupons
