import SellerLayout from '../SellerLayout'
import { DataTable, Pagination } from '../components/SellerComponents'
import { reviews } from '../../data/sellerMockData'
import { useState } from 'react'

const Reviews = () => {
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const reviewColumns = [
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
    {
      key: 'product',
      label: 'Product',
      render: (val) => (
        <div style={{ fontSize: '13px', fontWeight: '500' }}>
          {val.image} {val.name}
        </div>
      ),
    },
    {
      key: 'rating',
      label: 'Rating',
      render: (val) => <span style={{ color: '#f39a00', fontSize: '13px' }}>{'⭐'.repeat(val)}</span>,
    },
    {
      key: 'review',
      label: 'Review',
      render: (val) => <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{val}</span>,
    },
    { key: 'date', label: 'Date' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <span
          style={{
            background: val === 'Published' ? 'rgba(53, 147, 84, 0.15)' : 'rgba(243, 154, 0, 0.15)',
            color: val === 'Published' ? 'var(--color-success)' : '#f39a00',
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

  const totalPages = Math.ceil(reviews.length / perPage)
  const paginatedReviews = reviews.slice((currentPage - 1) * perPage, currentPage * perPage)

  return (
    <SellerLayout activeItem="reviews" breadcrumbs={[{ label: 'Dashboard' }, { label: 'Reviews' }]}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px', fontFamily: 'var(--font-heading)' }}>
              Product Reviews
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0' }}>
              Manage and reply to customer reviews for your products.
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
            ⚙️ Review Settings
          </button>
        </div>

        {/* Review Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-text)' }}>23</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>All Reviews</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-success)' }}>16</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Positive (69.6%)</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#f39a00' }}>4</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Neutral (17.4%)</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--color-danger)' }}>3</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Negative (13%)</div>
          </div>
        </div>

        {/* Reviews Table */}
        <div style={{ background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: '12px', padding: '16px' }}>
          <DataTable columns={reviewColumns} data={paginatedReviews} />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            perPage={perPage}
            total={reviews.length}
            onPageChange={setCurrentPage}
            onPerPageChange={setPerPage}
          />
        </div>
      </div>
    </SellerLayout>
  )
}

export default Reviews
