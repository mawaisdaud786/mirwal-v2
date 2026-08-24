import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { StatCard, DataTable, SellerCard } from '../components/SellerComponents'
import {
  sellerStats,
  dashboardOrders,
  topProducts,
  lowStockProducts,
  salesOverviewChart,
  earningsByStatus,
  earnings,
} from '../../data/sellerMockData'
import './dashboard.css'

const Dashboard = () => {
  const [period, setPeriod] = useState('Last 7 Days')

  // Prepare chart data
  const chartData = salesOverviewChart
  const maxSales = Math.max(...chartData.map((d) => d.sales))

  // Prepare orders table columns
  const orderColumns = [
    {
      key: 'id',
      label: 'Order ID',
      render: (val) => <span className="table-cell-order-id">{val}</span>,
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (val, row) => (
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
      label: 'Items',
      render: (val) => (
        <span style={{ fontSize: '12px' }}>
          <strong>{val}</strong> Item{val !== 1 ? 's' : ''}
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (val) => <span className="table-cell-amount">Rs. {val.toLocaleString()}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (val, row) => (
        <span
          style={{
            background:
              val === 'Delivered'
                ? 'rgba(53, 147, 84, 0.15)'
                : val === 'Processing'
                  ? 'rgba(243, 154, 0, 0.15)'
                  : val === 'Shipped'
                    ? 'rgba(104, 71, 199, 0.15)'
                    : 'rgba(227, 61, 47, 0.15)',
            color:
              val === 'Delivered'
                ? 'var(--color-success)'
                : val === 'Processing'
                  ? '#f39a00'
                  : val === 'Shipped'
                    ? 'var(--color-info)'
                    : 'var(--color-danger)',
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

  // Prepare products table columns
  const productColumns = [
    {
      key: 'name',
      label: 'Product',
      render: (val, row) => (
        <div className="table-cell-content">
          <div style={{ fontSize: '20px' }}>{row.image}</div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '500' }}>{val}</div>
            <div className="table-cell-text-muted">{row.category}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'sold',
      label: 'Sold',
      render: (val) => <strong>{val}</strong>,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      render: (val) => <strong>Rs. {val.toLocaleString()}</strong>,
    },
  ]

  const lowStockColumns = [
    {
      key: 'name',
      label: 'Product',
      render: (val, row) => (
        <div>
          <div style={{ fontSize: '13px', fontWeight: '500' }}>{val}</div>
          <div className="table-cell-text-muted">{row.sku}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      label: 'Available',
      render: (val, row) => (
        <div>
          <div style={{ fontSize: '13px', fontWeight: '600' }}>{val}</div>
          <div className="table-cell-text-muted">{row.reserved} reserved</div>
        </div>
      ),
    },
    {
      key: 'threshold',
      label: 'Threshold',
      render: (val) => <div>{val}</div>,
    },
    {
      key: 'category',
      label: 'Category',
      render: (val) => <div className="table-cell-text-muted">{val}</div>,
    },
  ]

  return (
    <SellerLayout activeItem="dashboard" breadcrumbs={[{ label: 'Dashboard' }]}>
      <div className="dashboard-container">
        {/* Welcome Section */}
        <div className="dashboard-welcome">
          <div className="dashboard-welcome-content">
            <h1>Welcome back, Awais! 👋</h1>
            <p>Here's what's happening with your store today.</p>
            <div className="dashboard-welcome-stats">
              <div className="welcome-stat">
                <div className="welcome-stat-icon">🏪</div>
                <div className="welcome-stat-content">
                  <div className="welcome-stat-label">Store Status</div>
                  <div className="welcome-stat-value">Active</div>
                </div>
              </div>
              <div className="welcome-stat">
                <div className="welcome-stat-icon">⭐</div>
                <div className="welcome-stat-content">
                  <div className="welcome-stat-label">Store Rating</div>
                  <div className="welcome-stat-value">4.8 (129 reviews)</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 16px', color: 'var(--color-text)' }}>
            Key Metrics
          </h2>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-card-header">
                <div className="metric-label">Total Sales</div>
                <div className="metric-card-icon">💰</div>
              </div>
              <div className="metric-value">Rs. {sellerStats.totalSales.toLocaleString()}</div>
              <div className="metric-change">{sellerStats.vsLastWeek} vs last week</div>
              <div className="metric-subtext">All time earnings</div>
            </div>

            <div className="metric-card">
              <div className="metric-card-header">
                <div className="metric-label">Today's Sales</div>
                <div className="metric-card-icon">📊</div>
              </div>
              <div className="metric-value">Rs. {sellerStats.todaySales.toLocaleString()}</div>
              <div className="metric-change" style={{ color: 'var(--color-info)' }}>
                ↗ Last 24 hours
              </div>
              <div className="metric-subtext">Real-time updates</div>
            </div>

            <div className="metric-card">
              <div className="metric-card-header">
                <div className="metric-label">This Month's Sales</div>
                <div className="metric-card-icon">📈</div>
              </div>
              <div className="metric-value">Rs. {sellerStats.thisMonthSales.toLocaleString()}</div>
              <div className="metric-change">{sellerStats.vsLastMonth} vs last month</div>
              <div className="metric-subtext">Current month</div>
            </div>

            <div className="metric-card">
              <div className="metric-card-header">
                <div className="metric-label">Total Orders</div>
                <div className="metric-card-icon">📋</div>
              </div>
              <div className="metric-value">{sellerStats.totalOrders.toLocaleString()}</div>
              <div className="metric-change">{sellerStats.pendingOrders} pending</div>
              <div className="metric-subtext">All time orders</div>
            </div>

            <div className="metric-card">
              <div className="metric-card-header">
                <div className="metric-label">Available Balance</div>
                <div className="metric-card-icon">💳</div>
              </div>
              <div className="metric-value">Rs. {sellerStats.availableBalance.toLocaleString()}</div>
              <div className="metric-change" style={{ color: 'var(--color-success)' }}>
                Ready to withdraw
              </div>
              <div className="metric-subtext">Payout available</div>
            </div>

            <div className="metric-card">
              <div className="metric-card-header">
                <div className="metric-label">Avg Order Value</div>
                <div className="metric-card-icon">🎯</div>
              </div>
              <div className="metric-value">Rs. {sellerStats.averageOrderValue.toLocaleString()}</div>
              <div className="metric-change" style={{ color: 'var(--color-info)' }}>
                Per order average
              </div>
              <div className="metric-subtext">Last 7 days</div>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="info-box">
          <div className="info-box-icon">💡</div>
          <div className="info-box-content">
            <strong>Tip:</strong> Keep your products updated and respond to customers quickly to improve your store
            performance.
          </div>
        </div>

        {/* Charts */}
        <div className="charts-section">
          <SellerCard title="Sales Overview">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--color-border-lightest)',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  Revenue
                </div>
                <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--color-text)' }}>
                  Rs. 45,280
                </div>
              </div>
              <button className="chart-card-period">Last 7 Days</button>
            </div>
            <div className="simple-chart">
              {chartData.map((data, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  }}
                >
                  <div
                    className="chart-bar"
                    style={{ height: `${(data.sales / maxSales) * 200}px` }}
                    title={`Rs. ${data.sales.toLocaleString()}`}
                  ></div>
                  <div className="chart-bar-label">{data.date.split(' ')[1]}</div>
                </div>
              ))}
            </div>
          </SellerCard>

          <SellerCard title="Earnings by Status">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div className="pie-chart-container">
                <div className="pie-chart">
                  <div className="pie-chart-center">
                    <div className="pie-chart-value">77.3%</div>
                    <div className="pie-chart-label">Paid</div>
                  </div>
                </div>
              </div>
              <div className="pie-chart-legend">
                <div className="pie-legend-item">
                  <div
                    className="pie-legend-color"
                    style={{ background: 'var(--color-success)' }}
                  ></div>
                  <div className="pie-legend-label">Paid</div>
                  <div className="pie-legend-value">Rs. {earningsByStatus.paid.value.toLocaleString()}</div>
                </div>
                <div className="pie-legend-item">
                  <div className="pie-legend-color" style={{ background: '#f39a00' }}></div>
                  <div className="pie-legend-label">Pending</div>
                  <div className="pie-legend-value">Rs. {earningsByStatus.pending.value.toLocaleString()}</div>
                </div>
              </div>
            </div>
          </SellerCard>
        </div>

        {/* Recent Orders */}
        <SellerCard title="Recent Orders">
          <DataTable columns={orderColumns} data={dashboardOrders.slice(0, 5)} />
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              style={{
                background: 'var(--color-primary)',
                color: '#fff',
                border: '0',
                borderRadius: '6px',
                padding: '10px 16px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              View All Orders
            </button>
          </div>
        </SellerCard>

        {/* Two Column Section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Top Products */}
          <SellerCard title="Top Selling Products">
            <DataTable columns={productColumns} data={topProducts} />
          </SellerCard>

          {/* Low Stock Products */}
          <SellerCard title="Low Stock Products">
            <DataTable columns={lowStockColumns} data={lowStockProducts} />
          </SellerCard>
        </div>

        {/* Store Performance */}
        <SellerCard title="Store Performance">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Order Completion Rate</div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: 'var(--color-success)',
                }}
              >
                96%
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--color-border-light)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--color-success)',
                    width: '96%',
                  }}
                ></div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>On-time Delivery Rate</div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: 'var(--color-success)',
                }}
              >
                96%
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--color-border-light)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--color-success)',
                    width: '96%',
                  }}
                ></div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Response Rate</div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: 'var(--color-success)',
                }}
              >
                92%
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--color-border-light)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--color-success)',
                    width: '92%',
                  }}
                ></div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Customer Satisfaction</div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: 'var(--color-success)',
                }}
              >
                4.8/5
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Based on 129 reviews</div>
            </div>
          </div>
        </SellerCard>
      </div>
    </SellerLayout>
  )
}

export default Dashboard
