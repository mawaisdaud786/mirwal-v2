import AdminLayout from './AdminLayout'
import { useLocation } from 'react-router-dom'
import Icon from '../components/Icon'

const summary = [
  ['Total Errors', '6,892', '+3.4%', 'triangle-exclamation'],
  ['Critical', '558', '+2.1%', 'ban'],
  ['Warnings', '2,145', '+7.5%', 'bell'],
  ['Resolved', '2,789', '+4.6%', 'circle-check'],
]

const rows = [
  ['#125361', 'May 25, 2025 10:30 AM', 'Payment', 'Payment failed for order #123456 (Stripe)', 'admin', '192.168.1.10', 'New', 'danger'],
  ['#125360', 'May 25, 2025 10:25 AM', 'Critical', 'Database connection timed out', 'system', '192.168.1.11', 'New York, US', 'warning'],
  ['#125359', 'May 25, 2025 10:18 AM', 'Security', 'File not found: /assets/logo.png', 'john.doe', '192.168.1.12', 'Lahore, PK', 'danger'],
  ['#125358', 'May 25, 2025 10:06 AM', 'API', 'API request rate limit reached', 'api', '192.168.1.13', 'Karachi, PK', 'warning'],
  ['#125357', 'May 25, 2025 09:58 AM', 'System', 'Scheduled task failed to complete', 'system', '192.168.1.14', 'Islamabad, PK', 'info'],
  ['#125356', 'May 25, 2025 09:45 AM', 'Payment', 'Refund webhook retry attempt', 'finance', '192.168.1.15', 'Dubai, UAE', 'warning'],
  ['#125355', 'May 25, 2025 09:30 AM', 'Security', 'Failed login attempt blocked', 'security', '192.168.1.16', 'London, UK', 'success'],
  ['#125354', 'May 25, 2025 09:17 AM', 'System', 'Inventory sync finished with warnings', 'system', '192.168.1.17', 'Lahore, PK', 'info'],
  ['#125353', 'May 25, 2025 09:00 AM', 'Database', 'Duplicate index key detected', 'db', '192.168.1.18', 'New York, US', 'warning'],
  ['#125352', 'May 25, 2025 08:52 AM', 'Payment', 'Retry status changed to resolved', 'finance', '192.168.1.19', 'Karachi, PK', 'success'],
]

const getTone = (status) => {
  const key = String(status).toLowerCase()
  if (key.includes('danger') || key.includes('critical') || key.includes('new')) return 'status-danger'
  if (key.includes('warning')) return 'status-warning'
  if (key.includes('success') || key.includes('resolved')) return 'status-success'
  return 'status-neutral'
}

function LogSubpage({ kind, section }) {
  const title = `${kind} - ${section}`
  const entries = kind === 'Error Logs'
    ? [['#125361', 'Payment', 'Payment failed for order #123456', 'New'], ['#125360', 'Database', 'Connection timed out', 'New'], ['#125359', 'Security', 'File not found: /assets/logo.png', 'Resolved'], ['#125358', 'API', 'Rate limit reached', 'Investigating']]
    : [['#SYS-8821', 'System', 'Maintenance mode enabled', 'Success'], ['#SYS-8820', 'Database', 'Inventory sync completed', 'Success'], ['#SYS-8819', 'Security', 'Admin login detected', 'Info'], ['#SYS-8818', 'API', 'Webhook request received', 'Success']]
  return <AdminLayout><section className="log-subpage"><style>{`
    .log-subpage { max-width:1280px; margin:0 auto; color:var(--color-text); font-family:var(--font-body); }
    .log-sub-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:16px; }
    .log-sub-crumb { color:#7d8c98; font-size:10px; display:flex; gap:7px; margin-bottom:5px; align-items:center; }
    .log-sub-head h1 { margin:0; font:800 22px/1.2 var(--font-heading); }
    .log-sub-actions { display:flex; gap:8px; }.log-sub-actions button { border:1px solid #e4ebef; border-radius:7px; background:#fff; padding:8px 11px; font-size:9px; color:#40515d; }.log-sub-actions .primary { color:#fff; background:var(--color-primary); border-color:var(--color-primary); }
    .log-sub-tabs { display:flex; gap:8px; border-bottom:1px solid #e7edf1; margin-bottom:14px; }.log-sub-tabs button { border:0; background:transparent; padding:10px 12px; color:#72818c; font-size:9px; }.log-sub-tabs .active { color:var(--color-primary); border-bottom:2px solid var(--color-primary); font-weight:700; }
    .log-sub-panel { border:1px solid #e7edf1; border-radius:10px; background:#fff; box-shadow:0 6px 16px rgba(20,35,50,.035); overflow:auto; }.log-sub-panel table { width:100%; min-width:760px; border-collapse:collapse; }.log-sub-panel th,.log-sub-panel td { padding:12px; border-bottom:1px solid #edf1f4; text-align:left; font-size:9px; white-space:nowrap; }.log-sub-panel th { color:#778692; background:#fafbfd; }.log-sub-panel td { color:#354550; }.log-sub-pill { border-radius:10px; padding:4px 8px; font-size:8px; font-weight:700; }.log-sub-pill.success { color:#15965e; background:#e7f8ee; }.log-sub-pill.danger { color:#c6433d; background:#fff0ef; }.log-sub-pill.info { color:#3c7fc8; background:#edf5ff; }
  `}</style><header className="log-sub-head"><div><div className="log-sub-crumb"><span>Home</span><i className="fa-solid fa-chevron-right" /><span>System</span><i className="fa-solid fa-chevron-right" /><span>{kind}</span><i className="fa-solid fa-chevron-right" /><b>{section}</b></div><h1>{title}</h1></div><div className="log-sub-actions"><button type="button"><i className="fa-solid fa-filter" /> Filter</button><button type="button"><i className="fa-solid fa-download" /> Export</button></div></header><nav className="log-sub-tabs" aria-label={`${kind} sections`}>{['Overview', 'All Logs', 'Critical', 'Settings'].map((tab) => <button type="button" className={tab.toLowerCase() === section.toLowerCase() ? 'active' : ''} key={tab}>{tab}</button>)}</nav><section className="log-sub-panel"><table><thead><tr><th>ID</th><th>Date &amp; Time</th><th>Category</th><th>Message</th><th>User</th><th>Status</th><th>Actions</th></tr></thead><tbody>{entries.map(([id, category, message, status], index) => <tr key={id}><td>{id}</td><td>May {25 - index}, 2025 {index + 9}:30 AM</td><td>{category}</td><td>{message}</td><td>superadmin</td><td><span className={`log-sub-pill ${getTone(status).replace('status-', '')}`}>{status}</span></td><td><i className="fa-solid fa-eye" /></td></tr>)}</tbody></table></section></section></AdminLayout>
}

export default function AdminSystemLogs() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length > 2) return <LogSubpage kind={parts[1] === 'error-logs' ? 'Error Logs' : 'System Logs'} section={parts.at(-1).replaceAll('-', ' ')} />
  return (
    <AdminLayout>
      <div className="error-logs-page">
        <style>{`
          .error-logs-page {
            width: 100%;
            max-width: 1280px;
            margin: 0 auto;
            color: var(--color-text);
            font-family: var(--font-body);
          }
          .error-logs-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 14px;
          }
          .error-logs-header h1 {
            margin: 0;
            font: 800 22px/1.2 var(--font-heading);
          }
          .error-logs-breadcrumb {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            color: #7a8a97;
            font-size: 10px;
          }
          .error-logs-breadcrumb button {
            border: 0;
            background: transparent;
            padding: 0;
            color: inherit;
            font: inherit;
            cursor: pointer;
          }
          .error-logs-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
          }
          .error-logs-action {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 10px;
            border: 1px solid #e7edf2;
            border-radius: 7px;
            background: #fff;
            color: var(--color-text);
            font-size: 9px;
            cursor: pointer;
          }
          .error-logs-action.primary {
            border-color: var(--color-primary);
            background: var(--color-primary);
            color: #fff;
          }
          .error-logs-kpis {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 18px;
          }
          .error-logs-kpi {
            position: relative;
            min-height: 84px;
            padding: 14px 14px 12px;
            border: 1px solid #e9edf1;
            border-radius: 10px;
            background: #fff;
            box-shadow: 0 6px 18px rgba(9, 21, 34, 0.03);
          }
          .error-logs-kpi > span {
            position: absolute;
            top: 12px;
            right: 12px;
            display: grid;
            place-items: center;
            width: 28px;
            height: 28px;
            border-radius: 8px;
            background: #fff2eb;
            color: var(--color-primary);
            font-size: 12px;
          }
          .error-logs-kpi small {
            display: block;
            color: #697986;
            font-size: 9px;
          }
          .error-logs-kpi strong {
            display: block;
            margin-top: 10px;
            font: 800 22px/1.2 var(--font-heading);
          }
          .error-logs-kpi em {
            display: block;
            margin-top: 6px;
            color: #1ea66d;
            font-size: 9px;
            font-style: normal;
          }
          .error-logs-kpi em.negative {
            color: #d14a43;
          }
          .error-logs-grid {
            display: grid;
            grid-template-columns: 1.3fr 0.9fr;
            gap: 14px;
            margin-bottom: 18px;
          }
          .error-panel {
            border: 1px solid #e9edf1;
            border-radius: 12px;
            background: #fff;
            box-shadow: 0 6px 18px rgba(9, 21, 34, 0.03);
            overflow: hidden;
          }
          .error-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 14px 16px;
            border-bottom: 1px solid #edf1f4;
          }
          .error-panel-header h2 {
            margin: 0;
            font-size: 12px;
            font-weight: 800;
          }
          .error-panel-header button {
            border: 0;
            background: transparent;
            color: #697986;
            font-size: 9px;
            cursor: pointer;
          }
          .trend-chart {
            height: 180px;
            padding: 16px 16px 12px;
            background: linear-gradient(180deg, rgba(255,127,71,0.02), #fff);
          }
          .trend-chart svg {
            width: 100%;
            height: 100%;
            display: block;
          }
          .trend-chart .y-labels {
            display: flex;
            justify-content: space-between;
            padding: 0 10px 0 6px;
            color: #8a98a6;
            font-size: 8px;
          }
          .donut-card {
            padding: 18px 16px 16px;
          }
          .donut-wrap {
            display: grid;
            place-items: center;
            margin: 10px auto 16px;
            width: 120px;
            height: 120px;
            background: conic-gradient(#ff7a43 0 55%, #ffb18d 55% 76%, #ffd8c3 76% 89%, #f0f3f6 89% 100%);
            border-radius: 50%;
            position: relative;
          }
          .donut-wrap::after {
            content: '';
            position: absolute;
            inset: 18px;
            background: white;
            border-radius: 50%;
          }
          .donut-wrap strong {
            position: relative;
            z-index: 1;
            font-size: 22px;
            font-weight: 800;
          }
          .donut-wrap small {
            position: relative;
            z-index: 1;
            color: #697986;
            font-size: 8px;
          }
          .donut-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 12px;
            font-size: 9px;
            color: #586774;
          }
          .legend {
            display: flex;
            align-items: center;
            gap: 7px;
          }
          .legend-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
          }
          .legend-dot.orange { background: #ff7a43; }
          .legend-dot.peach { background: #ffb18d; }
          .legend-dot.soft { background: #ffd8c3; }
          .legend-dot.muted { background: #e6ebef; }
          .error-panel-table-wrap {
            overflow: auto;
          }
          table.error-table {
            width: 100%;
            border-collapse: collapse;
            min-width: 800px;
          }
          .error-table th,
          .error-table td {
            padding: 11px 12px;
            border-bottom: 1px solid #edf1f4;
            text-align: left;
            font-size: 9px;
          }
          .error-table th {
            color: #768591;
            background: #fafbfd;
            font-weight: 700;
          }
          .error-table td {
            color: #2c3842;
          }
          .status-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 66px;
            padding: 4px 7px;
            border-radius: 999px;
            font-size: 8px;
            font-weight: 700;
          }
          .status-danger { background: rgba(209,74,67,0.1); color: #c6433d; }
          .status-warning { background: rgba(245,158,11,0.12); color: #b77a0d; }
          .status-success { background: rgba(31,165,106,0.12); color: #1e9e68; }
          .status-neutral { background: #eef2f6; color: #566675; }
          .error-logs-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 12px 16px 16px;
            color: #6d7a86;
            font-size: 9px;
          }
          .log-pager {
            display: inline-flex;
            align-items: center;
            gap: 8px;
          }
          .log-pager button {
            width: 24px;
            height: 24px;
            border: 1px solid #e5ebf0;
            border-radius: 7px;
            background: #fff;
            color: #556772;
          }
          .log-pager button.active {
            border-color: var(--color-primary);
            background: var(--color-primary);
            color: #fff;
          }
          @media (max-width: 980px) {
            .error-logs-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .error-logs-grid { grid-template-columns: 1fr; }
          }
          @media (max-width: 620px) {
            .error-logs-kpis { grid-template-columns: 1fr; }
            .error-logs-header { display: block; }
            .error-logs-actions { margin-top: 12px; }
          }
        `}</style>

        <header className="error-logs-header">
          <div>
            <div className="error-logs-breadcrumb">
              <button type="button">Home</button>
              <span><Icon name="chevron-right" /></span>
              <button type="button">System</button>
              <span><Icon name="chevron-right" /></span>
              <strong>Error Logs</strong>
            </div>
            <h1>Error Logs</h1>
          </div>

          <div className="error-logs-actions">
            <button type="button" className="error-logs-action"><Icon name="calendar" /> May 19, 2025 - May 25, 2025</button>
            <button type="button" className="error-logs-action"><Icon name="download" /> Export</button>
            <button type="button" className="error-logs-action primary"><Icon name="filter" /> Filter</button>
          </div>
        </header>

        <div className="error-logs-kpis">
          {summary.map(([label, value, delta, icon]) => (
            <article key={label} className="error-logs-kpi">
              <span><Icon name={icon} /></span>
              <small>{label}</small>
              <strong>{value}</strong>
              <em className={delta.startsWith('-') ? 'negative' : ''}><Icon name={delta.startsWith('-') ? 'arrow-down' : 'arrow-up'} /> {delta}</em>
            </article>
          ))}
        </div>

        <div className="error-logs-grid">
          <section className="error-panel">
            <div className="error-panel-header">
              <h2>Error Trend</h2>
              <button type="button">Last 7 days</button>
            </div>
            <div className="trend-chart">
              <svg viewBox="0 0 620 170" preserveAspectRatio="none" aria-label="Error trend chart">
                <path d="M0 128 C60 118, 90 90, 140 96 S220 76, 260 82 S330 58, 380 70 S470 92, 520 58 S590 62, 620 30" fill="none" stroke="#ff7a43" strokeWidth="3" strokeLinecap="round"/>
                <path d="M0 142 C70 136, 100 118, 150 126 S220 104, 260 112 S340 92, 390 98 S470 106, 520 80 S600 90, 620 60" fill="none" stroke="#ffb18d" strokeWidth="2.5" strokeLinecap="round" opacity="0.8"/>
              </svg>
              <div className="y-labels">
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
                <span>Sun</span>
              </div>
            </div>
          </section>

          <aside className="error-panel">
            <div className="error-panel-header">
              <h2>Error Type</h2>
              <button type="button">This month</button>
            </div>
            <div className="donut-card">
              <div className="donut-wrap">
                <div style={{ textAlign: 'center' }}>
                  <strong>6,892</strong>
                  <small>Errors</small>
                </div>
              </div>
              <div className="donut-grid">
                <div className="legend"><span className="legend-dot orange" /> Payment</div>
                <div className="legend"><span className="legend-dot peach" /> System</div>
                <div className="legend"><span className="legend-dot soft" /> Database</div>
                <div className="legend"><span className="legend-dot muted" /> API</div>
              </div>
            </div>
          </aside>
        </div>

        <section className="error-panel">
          <div className="error-panel-header">
            <h2>Recent Error Logs</h2>
            <button type="button">View all</button>
          </div>

          <div className="error-panel-table-wrap">
            <table className="error-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date &amp; Time</th>
                  <th>Service</th>
                  <th>Message</th>
                  <th>User</th>
                  <th>IP Address</th>
                  <th>Location</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, date, service, message, user, ip, location, status]) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{date}</td>
                    <td>{service}</td>
                    <td>{message}</td>
                    <td>{user}</td>
                    <td>{ip}</td>
                    <td>{location}</td>
                    <td><span className={`status-pill ${getTone(status)}`}>{status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="error-logs-footer">
            <span>Showing 1 to 10 of 2,845 entries</span>
            <div className="log-pager">
              <button type="button"><Icon name="chevron-left" /></button>
              <button type="button" className="active">1</button>
              <button type="button">2</button>
              <button type="button">3</button>
              <button type="button">4</button>
              <button type="button"><Icon name="chevron-right" /></button>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  )
}
