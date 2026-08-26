import { useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { navigateTo } from '../navigation'
import AdminLayout from './AdminLayout'
import Icon from '../components/Icon'
import './seller-pages.css'

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const sellers = [
  ['TechZone Store', 'Ali Raza', 'Electronics', '2,842', 'Rs. 45,82,000', 'Active', '4.8', 'May 12, 2025'],
  ['Mobile World', 'Sara Ahmed', 'Mobiles', '2,231', 'Rs. 38,91,000', 'Active', '4.7', 'Apr 03, 2025'],
  ['Laptop House', 'Usman Khan', 'Computers', '1,982', 'Rs. 32,44,000', 'Active', '4.6', 'Mar 18, 2025'],
  ['GadgetHub', 'Hina Batool', 'Electronics', '1,742', 'Rs. 28,31,000', 'Pending', '4.5', 'May 24, 2025'],
  ['Fashion Fiesta', 'Faizan Malik', 'Fashion', '1,321', 'Rs. 18,93,000', 'Active', '4.4', 'Feb 09, 2025'],
  ['BeautyStore', 'Mariam Fatima', 'Beauty', '982', 'Rs. 12,40,000', 'Suspended', '4.2', 'Jan 22, 2025'],
]

const applications = [
  ['#APP-2042', 'Nova Gadgets', 'Ahmed Raza', 'Electronics', 'May 24, 2025', 'Pending'],
  ['#APP-2041', 'HomeNest', 'Sana Malik', 'Home & Living', 'May 23, 2025', 'Pending'],
  ['#APP-2040', 'Stride Wear', 'Bilal Khan', 'Fashion', 'May 22, 2025', 'In Review'],
  ['#APP-2039', 'LensCraft', 'Hira Noor', 'Cameras', 'May 21, 2025', 'Approved'],
  ['#APP-2038', 'KitchenPro', 'Usman Ali', 'Appliances', 'May 20, 2025', 'Rejected'],
]

const verifications = [
  ['TechZone Store', 'NTN-458921', 'Bank + CNIC', 'May 24, 2025', 'Verified'],
  ['GadgetHub', 'NTN-331204', 'CNIC pending', 'May 24, 2025', 'Pending'],
  ['Mobile World', 'NTN-882110', 'Bank + CNIC', 'May 22, 2025', 'Verified'],
  ['BeautyStore', 'NTN-110294', 'Address mismatch', 'May 20, 2025', 'Rejected'],
  ['Laptop House', 'NTN-667812', 'Bank + CNIC', 'May 18, 2025', 'Verified'],
]

const performance = [
  ['TechZone Store', '2,842', '98%', '4.8', '1.2%', 'Excellent'],
  ['Mobile World', '2,231', '97%', '4.7', '1.6%', 'Good'],
  ['Laptop House', '1,982', '95%', '4.6', '2.1%', 'Good'],
  ['GadgetHub', '1,742', '91%', '4.5', '3.4%', 'Average'],
  ['Fashion Fiesta', '1,321', '93%', '4.4', '2.8%', 'Good'],
]

const payouts = [
  ['#PO-88421', 'TechZone Store', 'Rs. 4,58,200', 'May 24, 2025', 'Paid'],
  ['#PO-88420', 'Mobile World', 'Rs. 3,89,100', 'May 23, 2025', 'Paid'],
  ['#PO-88419', 'Laptop House', 'Rs. 3,24,400', 'May 22, 2025', 'Processing'],
  ['#PO-88418', 'GadgetHub', 'Rs. 2,83,100', 'May 21, 2025', 'Pending'],
  ['#PO-88417', 'Fashion Fiesta', 'Rs. 1,89,300', 'May 20, 2025', 'Paid'],
]

const configs = {
  sellers: {
    title: 'All Sellers',
    add: 'Invite Seller',
    search: 'Search seller, owner, store...',
    columns: ['Store', 'Owner', 'Category', 'Products', 'Sales', 'Status', 'Rating', 'Joined', 'Action'],
    stats: [['Total Sellers', '1,284', '6.4%', 'users'], ['Active Sellers', '1,102', '8.1%', 'user-check'], ['Pending Review', '96', '4.2%', 'clock'], ['Suspended', '28', '1.1%', 'user-lock']],
    rows: sellers,
    statusIndex: 5,
  },
  applications: {
    title: 'Seller Applications',
    add: '',
    search: 'Search application ID, store, owner...',
    columns: ['Application', 'Store', 'Owner', 'Category', 'Submitted', 'Status', 'Action'],
    stats: [['Total Applications', '428', '12.4%', 'user-plus'], ['Pending', '42', '6.1%', 'clock'], ['In Review', '18', '3.2%', 'spinner'], ['Approved this week', '27', '9.8%', 'circle-check']],
    rows: applications,
    statusIndex: 5,
  },
  verification: {
    title: 'Seller Verification',
    add: '',
    search: 'Search store or document ID...',
    columns: ['Store', 'Tax ID', 'Documents', 'Updated', 'Status', 'Action'],
    stats: [['Verified', '986', '7.4%', 'user-shield'], ['Pending', '54', '4.1%', 'clock'], ['Rejected', '21', '1.8%', 'circle-xmark'], ['Expiring soon', '12', '2.2%', 'triangle-exclamation']],
    rows: verifications,
    statusIndex: 4,
  },
  performance: {
    title: 'Seller Performance',
    add: '',
    search: 'Search store name...',
    columns: ['Store', 'Orders', 'Fulfillment', 'Rating', 'Return rate', 'Score', 'Action'],
    stats: [['Excellent', '412', '5.4%', 'trophy'], ['Good', '638', '3.1%', 'thumbs-up'], ['Average', '186', '2.4%', 'gauge'], ['At risk', '48', '1.6%', 'triangle-exclamation']],
    rows: performance,
    statusIndex: 5,
  },
  payouts: {
    title: 'Seller Payouts',
    add: 'Create Payout',
    search: 'Search payout ID or store...',
    columns: ['Payout ID', 'Store', 'Amount', 'Date', 'Status', 'Action'],
    stats: [['Paid this month', 'Rs. 8.45M', '15.5%', 'money-bill'], ['Processing', 'Rs. 1.12M', '4.2%', 'clock'], ['Pending', 'Rs. 1.28M', '6.2%', 'wallet'], ['Failed', 'Rs. 48,200', '0.8%', 'circle-xmark']],
    rows: payouts,
    statusIndex: 4,
  },
}

function Status({ value }) {
  return <span className={`seller-status ${value.toLowerCase().replaceAll(' ', '-')}`}>{value}</span>
}

function SellerList({ type }) {
  const config = configs[type] || configs.sellers
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All Status')
  const [selected, setSelected] = useState([])
  const [notice, setNotice] = useState('')
  const filtered = useMemo(() => config.rows.filter((row) => {
    const statusValue = row[config.statusIndex]
    return (status === 'All Status' || statusValue === status) && row.join(' ').toLowerCase().includes(search.toLowerCase())
  }), [config, search, status])
  const all = filtered.length > 0 && filtered.every((row) => selected.includes(row[0]))

  return (
    <AdminLayout>
      <div className="seller-page">
        <div className="seller-heading">
          <div>
            <h1>{config.title}</h1>
            <p>Home <Icon name="chevron-right" /> Sellers <Icon name="chevron-right" /> {config.title}</p>
          </div>
          {config.add ? <button type="button" className="primary" onClick={() => setNotice(`${config.add} saved locally. Backend is not connected yet.`)}><Icon name="plus" /> {config.add}</button> : null}
        </div>
        <div className="seller-kpis">
          {config.stats.map(([label, value, change, icon], index) => (
            <article key={label}>
              <span className={`seller-kpi-icon tone-${index}`}><Icon name={icon} /></span>
              <small>{label}</small>
              <strong>{value}</strong>
              <em><Icon name="arrow-up" /> {change} <i>vs last 7 days</i></em>
            </article>
          ))}
        </div>
        <section className="seller-panel">
          <div className="seller-filters">
            <label>
              <Icon name="magnifying-glass" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={config.search} aria-label={config.search} />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter status">
              <option>All Status</option>
              <option>Active</option>
              <option>Pending</option>
              <option>Approved</option>
              <option>Rejected</option>
              <option>Paid</option>
              <option>Processing</option>
              <option>Verified</option>
              <option>Suspended</option>
            </select>
            <button type="button"><Icon name="filter" /> Filters</button>
            <button type="button" onClick={() => { setSearch(''); setStatus('All Status'); setSelected([]); setNotice('') }}><Icon name="rotate-left" /> Reset</button>
          </div>
          <div className="seller-toolbar">
            <strong>{selected.length} Selected</strong>
            <button type="button" disabled={!selected.length} onClick={() => setNotice('Bulk action applied to selected rows.')}>Bulk Actions <Icon name="chevron-down" /></button>
            <select aria-label="Sort sellers"><option>Sort by: Newest First</option><option>Sort by: Sales</option></select>
          </div>
          {filtered.length === 0 ? (
            <p style={{ padding: 24, color: 'var(--color-text-secondary)', fontSize: 14 }}>No {config.title.toLowerCase()} match your filters.</p>
          ) : (
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={all} onChange={() => setSelected(all ? [] : filtered.map((row) => row[0]))} aria-label={`Select all ${config.title}`} /></th>
                    {config.columns.map((column) => <th key={column}>{column}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row[0]}>
                      <td><input type="checkbox" checked={selected.includes(row[0])} onChange={() => setSelected((current) => current.includes(row[0]) ? current.filter((item) => item !== row[0]) : [...current, row[0]])} aria-label={`Select ${row[0]}`} /></td>
                      {row.map((cell, index) => (
                        <td key={`${row[0]}-${index}`}>
                          {index === config.statusIndex ? <Status value={cell} /> : index === 0 ? (
                            <button type="button" className="seller-link" onClick={() => navigateTo(`/admin/sellers/${slugify(String(row[1] || row[0]))}`)}>{cell}</button>
                          ) : cell}
                        </td>
                      ))}
                      <td>
                        <button type="button" aria-label={`View ${row[0]}`} onClick={() => navigateTo(`/admin/sellers/${slugify(String(row[1] || row[0]))}`)}><Icon name="eye" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="seller-footer">
            <span>Showing 1 to {filtered.length} of {filtered.length} records</span>
            <div>
              <button type="button" aria-label="Previous page"><Icon name="chevron-left" /></button>
              <button type="button" className="active">1</button>
              <button type="button" aria-label="Next page"><Icon name="chevron-right" /></button>
            </div>
            <select aria-label="Rows per page"><option>10 / page</option></select>
          </div>
        </section>
        {notice ? <p role="status" style={{ color: 'var(--color-success-dark)', fontSize: 13 }}>{notice}</p> : null}
      </div>
    </AdminLayout>
  )
}

const detailTabs = [['Overview', 'overview'], ['Products', 'products'], ['Orders', 'orders'], ['Payouts', 'payouts'], ['Documents', 'documents'], ['Activity', 'activity']]

function SellerDetail() {
  const { sellerId } = useParams()
  const { pathname } = useLocation()
  const [message, setMessage] = useState('')
  const seller = sellers.find((row) => slugify(row[1]) === sellerId || slugify(row[0]) === sellerId) || sellers[0]
  const tab = pathname.split('/')[4] || 'overview'

  return (
    <AdminLayout>
      <div className="seller-detail">
        <div className="seller-heading">
          <div>
            <h1>Seller Details</h1>
            <p>Home <Icon name="chevron-right" /> Sellers <Icon name="chevron-right" /> {seller[0]}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setMessage(`${seller[0]} was approved.`)}>Approve</button>
            <button type="button" onClick={() => setMessage(`${seller[0]} was suspended.`)}>Suspend</button>
          </div>
        </div>
        <div className="seller-profile-card">
          <div className="seller-avatar">{seller[0].slice(0, 2).toUpperCase()}</div>
          <div>
            <h2>{seller[0]} <span>{seller[5]}</span></h2>
            <p>{seller[1]} · {seller[2]}</p>
            <small><Icon name="envelope" /> {slugify(seller[1])}@store.mirwal.com · <Icon name="phone" /> +92 300 1234567</small>
            <small>Joined {seller[7]}</small>
          </div>
          <dl>
            <div><dt>Products</dt><dd>{seller[3]}</dd></div>
            <div><dt>Total Sales</dt><dd>{seller[4]}</dd></div>
            <div><dt>Status</dt><dd><Status value={seller[5]} /></dd></div>
            <div><dt>Rating</dt><dd>{seller[6]} ★</dd></div>
          </dl>
        </div>
        <nav className="seller-detail-tabs" aria-label="Seller sections">
          {detailTabs.map(([label, key]) => (
            <button type="button" className={tab === key ? 'active' : ''} onClick={() => navigateTo(`/admin/sellers/${slugify(seller[1])}/${key}`)} key={key}>{label}</button>
          ))}
        </nav>
        <div className="seller-detail-grid">
          <section className="seller-panel">
            <h2>{detailTabs.find((item) => item[1] === tab)?.[0] || 'Overview'}</h2>
            <div className="detail-stats">
              <article><small>Total Products</small><strong>{seller[3]}</strong><em>+12.4%</em></article>
              <article><small>Total Orders</small><strong>1,200</strong><em>+9.8%</em></article>
              <article><small>Total Sales</small><strong>{seller[4]}</strong><em>+15.2%</em></article>
              <article><small>Commission</small><strong>Rs. 4,58,200</strong><em>+8.1%</em></article>
            </div>
            <div className="detail-columns">
              <div>
                <h3>Store Information</h3>
                <p>Store Name <b>{seller[0]}</b></p>
                <p>Owner <b>{seller[1]}</b></p>
                <p>Category <b>{seller[2]}</b></p>
                <p>Business Type <b>Registered Business</b></p>
                <p>City <b>Lahore, Pakistan</b></p>
              </div>
              <div>
                <h3>Recent Activity</h3>
                {['Product catalog updated', 'Payout request submitted', 'Order #MW-98421 delivered', 'Document re-uploaded'].map((item) => (
                  <p key={item}><b>{item}</b><span>May 24, 2025</span></p>
                ))}
              </div>
            </div>
          </section>
          <section className="seller-panel performance-panel">
            <h2>Performance</h2>
            <div className="performance-number">{seller[6]}<small>Store rating</small></div>
            <div className="mini-bars">{[42, 58, 49, 71, 63, 86].map((height, index) => <i style={{ height: `${height}%` }} key={index} />)}</div>
          </section>
        </div>
        {message ? <p role="status" style={{ color: 'var(--color-success-dark)', fontSize: 13 }}>{message}</p> : null}
      </div>
    </AdminLayout>
  )
}

export default function AdminSellerPages({ type = 'sellers', detail = false }) {
  return detail ? <SellerDetail /> : <SellerList type={type} />
}
