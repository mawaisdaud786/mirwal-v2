import SellerLayout from '../SellerLayout'
import { DataTable, Pagination } from '../components/SellerComponents'
import { earnings, payouts } from '../../data/sellerMockData'
import { useState } from 'react'

const Earnings = () => {
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const payoutColumns = [
    { key: 'id', label: 'Payout ID' },
    { key: 'requestDate', label: 'Request Date' },
    { key: 'amount', label: 'Amount', render: (val) => `Rs. ${val.toLocaleString()}` },
    { key: 'method', label: 'Payment Method' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <span
          style={{
            background: val === 'Paid' ? 'rgba(53, 147, 84, 0.15)' : 'rgba(243, 154, 0, 0.15)',
            color: val === 'Paid' ? 'var(--color-success)' : '#f39a00',
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

  const totalPages = Math.ceil(payouts.length / perPage)
  const paginatedPayouts = payouts.slice((currentPage - 1) * perPage, currentPage * perPage)

  return (
    <SellerLayout activeItem="earnings" breadcrumbs={[{ label: 'Dashboard' }, { label: 'Earnings' }]}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px', fontFamily: 'var(--font-heading)' }}>
            Earnings
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0' }}>
            Track your sales and earnings overview.
          </p>
        </div>

        {/* Earnings Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Total Earnings</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--color-text)' }}>
              Rs. {earnings.totalEarnings.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>All time earnings</div>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>This Month</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--color-text)' }}>
              Rs. {earnings.thisMonthEarnings.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Current month</div>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Pending Payout</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--color-text)' }}>
              Rs. {earnings.pendingPayout.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Will be paid soon</div>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Available Balance</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--color-success)' }}>
              Rs. {earnings.availableBalance.toLocaleString()}
            </div>
            <button
              style={{
                marginTop: '8px',
                width: '100%',
                padding: '8px',
                background: 'var(--color-primary)',
                color: '#fff',
                border: '0',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Request Payout
            </button>
          </div>
        </div>

        {/* Payout History */}
        <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 16px', color: 'var(--color-text)' }}>
            Payout History
          </h2>
          <DataTable columns={payoutColumns} data={paginatedPayouts} />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            perPage={perPage}
            total={payouts.length}
            onPageChange={setCurrentPage}
            onPerPageChange={setPerPage}
          />
        </div>
      </div>
    </SellerLayout>
  )
}

export default Earnings
