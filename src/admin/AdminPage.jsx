import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { EmptyState } from './AdminStates'

const labels = {
  analytics: 'Analytics Overview',
  products: 'Products',
  categories: 'Categories',
  sellers: 'All Sellers',
  orders: 'All Orders',
  customers: 'All Customers',
  notifications: 'Notifications',
  promotions: 'Promotions',
  settings: 'General Settings',
}

const emptyStates = {
  products: ['No products found', 'There are no products available in the marketplace yet.', 'box-open', 'Add New Product'],
  notifications: ['No notifications found', 'You are all caught up. New activity will appear here.', 'bell-slash'],
  orders: ['No orders found', 'Orders will appear here when customers place them.', 'bag-shopping'],
  sellers: ['No sellers found', 'Approved sellers will appear here when they join Mirwal.', 'store'],
  customers: ['No customers found', 'Customers will appear here after their first interaction.', 'users'],
}

const backupRows = [
  ['Full Backup - 25 May 2025', 'Full', '42.6 GB', 'Local', 'Success', 'May 25, 2025 02:30 AM', 'Jun 25, 2025'],
  ['Database Backup - 25 May 2025', 'Database', '1.2 GB', 'Google Drive', 'Success', 'May 25, 2025 02:30 AM', 'Jun 25, 2025'],
  ['Files Backup - 25 May 2025', 'Files', '18.7 GB', 'Amazon S3', 'Success', 'May 25, 2025 02:30 AM', 'Jun 24, 2025'],
  ['Full Backup - 24 May 2025', 'Full', '41.8 GB', 'Local', 'Success', 'May 24, 2025 02:30 AM', 'Jun 24, 2025'],
  ['Database Backup - 24 May 2025', 'Database', '1.1 GB', 'Local', 'Success', 'May 24, 2025 02:30 AM', 'Jun 23, 2025'],
  ['Files Backup - 24 May 2025', 'Files', '17.9 GB', 'Google Drive', 'Success', 'May 24, 2025 02:30 AM', 'Jun 23, 2025'],
]

const BackupIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function BackupRestorePage() {
  return <AdminLayout><section className="backup-page">
    <style>{`
      .backup-page { color: var(--color-text); font-family: var(--font-body); max-width: 1280px; margin: 0 auto; }
      .backup-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
      .backup-crumb { color: #7d8c98; display: flex; gap: 7px; align-items: center; font-size: 10px; margin-bottom: 5px; }
      .backup-head h1 { margin: 0; font: 800 22px/1.2 var(--font-heading); }
      .backup-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .backup-button { border: 1px solid #e3eaf0; background: #fff; color: #394954; border-radius: 7px; padding: 8px 11px; font: 700 9px var(--font-body); cursor: pointer; }
      .backup-button.primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
      .backup-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
      .backup-stat, .backup-panel { border: 1px solid #e7edf1; border-radius: 10px; background: #fff; box-shadow: 0 6px 16px rgba(20, 35, 50, .035); }
      .backup-stat { min-height: 78px; padding: 13px 14px; position: relative; }
      .backup-stat small { display: block; color: #73818d; font-size: 9px; }
      .backup-stat strong { display: block; margin-top: 8px; font: 800 19px var(--font-heading); }
      .backup-stat em { color: #1b9d67; font-size: 8px; font-style: normal; }
      .backup-stat i { position: absolute; right: 13px; top: 13px; color: var(--color-primary); background: #fff1ea; border-radius: 7px; padding: 8px; font-size: 11px; }
      .backup-overview { display: grid; grid-template-columns: 1.35fr .9fr; gap: 14px; margin-bottom: 16px; }
      .backup-panel-head { border-bottom: 1px solid #edf1f4; padding: 12px 15px; display: flex; align-items: center; justify-content: space-between; }
      .backup-panel-head h2 { margin: 0; font-size: 12px; font-weight: 800; }
      .backup-panel-head span { color: #7b8994; font-size: 8px; }
      .backup-chart { height: 174px; padding: 13px 16px 12px; }
      .backup-chart svg { width: 100%; height: 140px; display: block; }
      .backup-days { color: #8795a0; display: flex; justify-content: space-between; font-size: 8px; }
      .backup-storage { padding: 15px; display: flex; align-items: center; gap: 18px; min-height: 174px; }
      .backup-donut { width: 112px; height: 112px; border-radius: 50%; background: conic-gradient(#ff7540 0 48%, #58c48a 48% 76%, #7bb5ed 76% 91%, #e8edf1 91%); display: grid; place-items: center; flex: 0 0 auto; position: relative; }
      .backup-donut::before { content: ''; width: 70px; height: 70px; background: #fff; border-radius: 50%; position: absolute; }
      .backup-donut-label { position: relative; z-index: 1; text-align: center; font-size: 8px; color: #7a8894; }
      .backup-donut-label strong { display: block; color: #26343e; font: 800 15px var(--font-heading); }
      .backup-legend { display: grid; gap: 11px; color: #5f707c; font-size: 9px; }
      .backup-legend span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
      .backup-legend b { color: #344550; float: right; margin-left: 18px; }
      .backup-table { overflow: auto; }
      .backup-table table { width: 100%; min-width: 880px; border-collapse: collapse; }
      .backup-table th, .backup-table td { text-align: left; border-bottom: 1px solid #edf1f4; padding: 10px 12px; font-size: 9px; white-space: nowrap; }
      .backup-table th { background: #fafbfd; color: #778692; font-weight: 700; }
      .backup-table td { color: #354550; }
      .backup-status { color: #15965e; background: #e8f8ef; border-radius: 10px; padding: 4px 8px; font-size: 8px; font-weight: 700; }
      .backup-table-actions { color: #82919b; display: flex; gap: 11px; }
      .backup-footer { display: flex; justify-content: space-between; padding: 12px 15px 14px; color: #778691; font-size: 9px; }
      .backup-footer button { border: 1px solid #e4ebef; border-radius: 6px; background: #fff; width: 24px; height: 24px; color: #647681; margin-left: 5px; }
      .backup-footer button.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
      @media (max-width: 900px) { .backup-stats { grid-template-columns: repeat(2, 1fr); } .backup-overview { grid-template-columns: 1fr; } }
      @media (max-width: 560px) { .backup-head { display: block; } .backup-actions { margin-top: 12px; } .backup-stats { grid-template-columns: 1fr; } .backup-storage { justify-content: center; flex-wrap: wrap; } }
    `}</style>
    <header className="backup-head"><div><div className="backup-crumb"><span>Home</span><BackupIcon name="chevron-right" /><span>System</span><BackupIcon name="chevron-right" /><span>Backup &amp; Restore</span><BackupIcon name="chevron-right" /><b>Overview</b></div><h1>Backup &amp; Restore - Overview</h1></div><div className="backup-actions"><button type="button" className="backup-button"><BackupIcon name="calendar" /> May 19, 2025 - May 26, 2025</button><button type="button" className="backup-button primary"><BackupIcon name="plus" /> Create Backup</button></div></header>
    <div className="backup-stats">{[['Total Backups', '156', '+12.5% from last 7 days', 'database'], ['Total Size', '285.6 GB', '+11.2% from last 7 days', 'hard-drive'], ['Storage Used', '68%', '+2.4% from last 7 days', 'chart-pie'], ['Successful Restores', '24', '+4.1% from last 7 days', 'circle-check']].map(([label, value, note, icon]) => <article className="backup-stat" key={label}><BackupIcon name={icon} /><small>{label}</small><strong>{value}</strong><em>{note}</em></article>)}</div>
    <div className="backup-overview"><section className="backup-panel"><div className="backup-panel-head"><h2>Backup Size (Last 7 Days)</h2><span><b style={{ color: '#4b9bf0' }}>●</b> Database &nbsp; <b style={{ color: '#ff9b4a' }}>●</b> Files &nbsp; <b style={{ color: '#f05c58' }}>●</b> Total</span></div><div className="backup-chart"><svg viewBox="0 0 620 140" preserveAspectRatio="none" aria-label="Backup size trend"><path d="M0 102 L55 74 L108 91 L160 78 L215 84 L270 69 L325 85 L380 64 L432 78 L490 59 L548 74 L620 68" fill="none" stroke="#4b9bf0" strokeWidth="3"/><path d="M0 116 L55 109 L108 113 L160 99 L215 108 L270 92 L325 107 L380 91 L432 104 L490 88 L548 99 L620 92" fill="none" stroke="#ff9b4a" strokeWidth="3"/><path d="M0 129 L55 124 L108 128 L160 117 L215 123 L270 112 L325 123 L380 109 L432 120 L490 105 L548 115 L620 109" fill="none" stroke="#f05c58" strokeWidth="3"/></svg><div className="backup-days"><span>May 19</span><span>May 20</span><span>May 21</span><span>May 22</span><span>May 23</span><span>May 24</span><span>May 25</span></div></div></section><section className="backup-panel"><div className="backup-panel-head"><h2>Storage Overview</h2><span>View details</span></div><div className="backup-storage"><div className="backup-donut"><div className="backup-donut-label"><strong>285.6 GB</strong>used storage</div></div><div className="backup-legend"><div><span style={{ background: '#ff7540' }} />Database Backup <b>86.3 GB (30.2%)</b></div><div><span style={{ background: '#58c48a' }} />Files Backup <b>73.4 GB (25.7%)</b></div><div><span style={{ background: '#7bb5ed' }} />Other Backups <b>40.5 GB (14.2%)</b></div></div></div></section></div>
    <section className="backup-panel"><div className="backup-panel-head"><h2>Recent Backups</h2><span>View all backups <BackupIcon name="arrow-right" /></span></div><div className="backup-table"><table><thead><tr><th>Backup Name</th><th>Type</th><th>Size</th><th>Location</th><th>Status</th><th>Created At</th><th>Expires At</th><th>Actions</th></tr></thead><tbody>{backupRows.map((row) => <tr key={row[0]}>{row.map((value, index) => index === 4 ? <td key={index}><span className="backup-status">{value}</span></td> : <td key={index}>{value}</td>)}<td><div className="backup-table-actions"><BackupIcon name="eye" /><BackupIcon name="download" /><BackupIcon name="trash" /></div></td></tr>)}</tbody></table></div><div className="backup-footer"><span>Showing 1 to 6 of 156 entries</span><div><button type="button"><BackupIcon name="chevron-left" /></button><button type="button" className="active">1</button><button type="button">2</button><button type="button">3</button><button type="button">4</button><button type="button"><BackupIcon name="chevron-right" /></button></div></div></section>
  </section></AdminLayout>
}

const maintenanceActivity = [
  ['Maintenance mode enabled', 'May 19, 2025 10:30 AM'],
  ['Maintenance page updated', 'May 19, 2025 09:45 AM'],
  ['Allowed IP added', 'May 18, 2025 04:20 PM'],
  ['Maintenance mode disabled', 'May 17, 2025 11:10 AM'],
  ['Maintenance mode enabled', 'May 17, 2025 10:55 AM'],
]

function MaintenanceModePage() {
  return <AdminLayout><section className="maintenance-page">
    <style>{`
      .maintenance-page { color: var(--color-text); font-family: var(--font-body); max-width: 1280px; margin: 0 auto; }
      .maintenance-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
      .maintenance-crumb { color: #7d8c98; display: flex; gap: 7px; align-items: center; font-size: 10px; margin-bottom: 5px; }
      .maintenance-head h1 { margin: 0; font: 800 22px/1.2 var(--font-heading); }
      .maintenance-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .maintenance-button { border: 1px solid #e3eaf0; background: #fff; color: #394954; border-radius: 7px; padding: 8px 11px; font: 700 9px var(--font-body); cursor: pointer; }
      .maintenance-button.primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
      .maintenance-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
      .maintenance-card { border: 1px solid #e7edf1; border-radius: 10px; background: #fff; box-shadow: 0 6px 16px rgba(20,35,50,.035); }
      .maintenance-stat { min-height: 80px; padding: 13px 14px; }
      .maintenance-stat small { display: block; color: #73818d; font-size: 9px; }
      .maintenance-stat strong { display: block; margin-top: 8px; font: 800 18px var(--font-heading); }
      .maintenance-stat em { color: #1b9d67; font-size: 8px; font-style: normal; }
      .maintenance-stat .state { display: inline-block; margin-top: 7px; border-radius: 10px; padding: 4px 8px; background: #e7f8ee; color: #15965e; font-size: 8px; font-style: normal; font-weight: 700; }
      .maintenance-content { display: grid; grid-template-columns: 1.35fr .9fr; gap: 14px; margin-bottom: 16px; }
      .maintenance-panel-head { border-bottom: 1px solid #edf1f4; padding: 12px 15px; display: flex; align-items: center; justify-content: space-between; }
      .maintenance-panel-head h2 { margin: 0; font-size: 12px; font-weight: 800; }
      .maintenance-panel-head button { border: 1px solid #e5ebef; background: #fff; border-radius: 6px; color: #63737e; padding: 5px 8px; font-size: 8px; }
      .maintenance-chart { height: 192px; padding: 12px 15px; }
      .maintenance-chart svg { display: block; width: 100%; height: 150px; }
      .maintenance-days { display: flex; justify-content: space-between; color: #8795a0; font-size: 8px; }
      .maintenance-activity { padding: 8px 15px 9px; }
      .maintenance-activity-row { display: flex; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid #f0f3f5; font-size: 8px; }
      .maintenance-activity-row:last-child { border-bottom: 0; }
      .maintenance-activity-row i { color: #448fe2; background: #edf5ff; border-radius: 50%; padding: 5px; font-size: 8px; }
      .maintenance-activity-row span { color: #344651; flex: 1; }
      .maintenance-activity-row time { color: #84929c; white-space: nowrap; }
      .maintenance-quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .maintenance-quick .maintenance-card { padding: 11px; min-height: 58px; }
      .maintenance-quick button { border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; width: 100%; }
      .maintenance-quick i { color: var(--color-primary); background: #fff1ea; border-radius: 6px; padding: 6px; font-size: 10px; float: left; margin-right: 8px; }
      .maintenance-quick strong { display: block; color: #344651; font-size: 8px; }
      .maintenance-quick small { display: block; color: #8996a0; font-size: 7px; margin-top: 3px; }
      @media (max-width: 900px) { .maintenance-stats { grid-template-columns: repeat(2, 1fr); } .maintenance-content { grid-template-columns: 1fr; } .maintenance-quick { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 560px) { .maintenance-head { display: block; } .maintenance-actions { margin-top: 12px; } .maintenance-stats, .maintenance-quick { grid-template-columns: 1fr; } }
    `}</style>
    <header className="maintenance-head"><div><div className="maintenance-crumb"><span>Home</span><i className="fa-solid fa-chevron-right" /><span>System</span><i className="fa-solid fa-chevron-right" /><span>Maintenance Mode</span><i className="fa-solid fa-chevron-right" /><b>Overview</b></div><h1>Maintenance Mode - Overview</h1></div><div className="maintenance-actions"><button type="button" className="maintenance-button"><i className="fa-solid fa-calendar" /> May 19, 2025 - May 26, 2025</button><button type="button" className="maintenance-button primary"><i className="fa-solid fa-plus" /> Create Maintenance Page</button></div></header>
    <div className="maintenance-stats"><article className="maintenance-card maintenance-stat"><small>Maintenance Mode Status</small><em className="state">Enabled</em><div style={{ color: '#81909b', fontSize: 8, marginTop: 5 }}>Since May 19, 2025 10:30 AM</div></article><article className="maintenance-card maintenance-stat"><small>Allowed Access</small><strong>12</strong><em>IPs / Users</em><div style={{ color: '#ff6b2f', fontSize: 8, marginTop: 5 }}>Manage Access →</div></article><article className="maintenance-card maintenance-stat"><small>Maintenance Pages</small><strong>3</strong><em>Pages Created</em><div style={{ color: '#ff6b2f', fontSize: 8, marginTop: 5 }}>Manage Pages →</div></article><article className="maintenance-card maintenance-stat"><small>Total Visits (Page)</small><strong>1,256</strong><em>↑ 10.7%</em><div style={{ color: '#ff6b2f', fontSize: 8, marginTop: 5 }}>View Analytics →</div></article></div>
    <div className="maintenance-content"><section className="maintenance-card"><div className="maintenance-panel-head"><h2>Visits Over Time (Last 7 Days)</h2><button type="button">Last 7 Days⌄</button></div><div className="maintenance-chart"><svg viewBox="0 0 640 150" preserveAspectRatio="none" aria-label="Maintenance page visits trend"><path d="M0 125 L55 103 L110 76 L164 90 L218 61 L273 94 L327 79 L382 53 L436 82 L490 91 L545 38 L600 67 L640 42" fill="none" stroke="#3188ed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><g fill="#3188ed">{[[0,125],[55,103],[110,76],[164,90],[218,61],[273,94],[327,79],[382,53],[436,82],[490,91],[545,38],[600,67],[640,42]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" />)}</g></svg><div className="maintenance-days"><span>May 13</span><span>May 14</span><span>May 15</span><span>May 16</span><span>May 17</span><span>May 18</span><span>May 19</span></div></div></section><section className="maintenance-card"><div className="maintenance-panel-head"><h2>Recent Activity</h2><button type="button">View All Logs →</button></div><div className="maintenance-activity">{maintenanceActivity.map(([label, date]) => <div className="maintenance-activity-row" key={`${label}-${date}`}><i className="fa-solid fa-circle-check" /><span>{label}</span><time>{date}</time></div>)}</div></section></div>
    <section><div className="maintenance-panel-head" style={{ paddingLeft: 0, borderBottom: 0 }}><h2>Quick Actions</h2></div><div className="maintenance-quick"><article className="maintenance-card"><button type="button"><i className="fa-solid fa-power-off" /><strong>Enable Maintenance Mode</strong><small>Turn on maintenance mode</small></button></article><article className="maintenance-card"><button type="button"><i className="fa-solid fa-file-circle-plus" /><strong>Create Maintenance Page</strong><small>Design a new maintenance page</small></button></article><article className="maintenance-card"><button type="button"><i className="fa-solid fa-user-shield" /><strong>Access Control</strong><small>Manage allowed IPs / users</small></button></article><article className="maintenance-card"><button type="button"><i className="fa-solid fa-sliders" /><strong>Maintenance Settings</strong><small>Configure general settings</small></button></article></div></section>
  </section></AdminLayout>
}

const subpageData = {
  backup: {
    files: ['Backup Files', ['Full Backup - 25 May 2025', 'Full', '42.6 GB', 'Local', 'Success'], ['Database Backup - 25 May 2025', 'Database', '1.2 GB', 'Google Drive', 'Success'], ['Files Backup - 25 May 2025', 'Files', '18.7 GB', 'Amazon S3', 'Success']],
    scheduled: ['Scheduled Backups', ['Daily Database Backup', 'Database', 'Daily', '02:30 AM', 'Active'], ['Daily Files Backup', 'Files', 'Daily', '03:00 AM', 'Active'], ['Weekly Full Backup', 'Full', 'Weekly', '01:00 AM', 'Active']],
    destinations: ['Backup Destinations', ['Google Drive Main', 'Google Drive', '82.1 GB / 300 GB', 'Connected'], ['Amazon S3 Backup', 'Amazon S3', '35.1 GB / 100 GB', 'Connected'], ['Dropbox Backup', 'Dropbox', '12.4 GB / 50 GB', 'Disconnected']],
    logs: ['Backup Logs', ['May 25, 2025 02:30 AM', 'Full Backup - 25 May 2025', 'Success', '00:12:45'], ['May 24, 2025 02:30 AM', 'Database Backup - 24 May 2025', 'Success', '00:02:15'], ['May 23, 2025 02:30 AM', 'Files Backup - 23 May 2025', 'Failed', '00:08:32']],
    create: ['Create Backup', ['Backup Name', 'Full Backup - 26 May 2025'], ['Backup Type', 'Full Backup (Files + Database)'], ['Storage Location', 'Local Storage'], ['Description', 'Monthly full backup before scheduled maintenance']],
    restore: ['Restore Backup', ['Select Backup', 'Full Backup - 26 May 2025 (42.6 GB)'], ['Type', 'Full Backup'], ['Created At', 'May 26, 2025 02:30 AM'], ['Expires At', 'Jun 26, 2025']],
    database: ['Database Backups', ['Database Backup - 25 May 2025', 'Database', '1.2 GB', 'Local', 'Success'], ['Database Backup - 24 May 2025', 'Database', '1.1 GB', 'Local', 'Success']],
    settings: ['Backup Settings', ['Enable Automatic Backups', 'Automatically create backups on schedule'], ['Backup Before Updates', 'Create a backup before system updates'], ['Verify Backup Integrity', 'Verify each backup after creation']],
  },
  maintenance: {
    pages: ['Maintenance Mode - Pages', ['Default Maintenance Page', '/maintenance', 'Active', 'Modern Clean'], ['Coming Soon Page', '/coming-soon', 'Active', 'Coming Soon'], ['Custom Maintenance', '/maintenance-custom', 'Inactive', 'Minimal']],
    logs: ['Maintenance Mode - Logs', ['May 19, 2025 10:30 AM', 'superadmin', 'Enabled', 'Maintenance mode enabled'], ['May 19, 2025 09:45 AM', 'superadmin', 'Page Updated', 'Default Maintenance Page updated'], ['May 18, 2025 04:20 PM', 'superadmin', 'IP Added', '192.168.1.25 added to allowed list']],
    access: ['Access Control', ['IP Address', '192.168.1.10', 'superadmin', 'May 19, 2025 10:30 AM'], ['IP Address', '192.168.1.15', 'admin', 'May 18, 2025 04:20 PM'], ['IP Range', '10.0.0.1 - 10.0.0.50', 'security', 'May 17, 2025 11:10 AM']],
    seo: ['SEO & Meta Settings', ['Meta Title', 'We Will Be Right Back'], ['Meta Description', 'Our website is currently under maintenance. We will be back soon!'], ['Meta Keywords', 'maintenance, down, coming soon']],
    notifications: ['Notifications', ['Admin Notifications', 'Receive notifications when maintenance mode is enabled/disabled.', 'Enabled'], ['Email Notifications', 'Send email notifications to admins.', 'Enabled'], ['User Notifications', 'Send notifications to users when mode is enabled.', 'Disabled']],
    settings: ['Maintenance Mode - Settings', ['Enable Maintenance Mode', 'When enabled, non-allowed users see the maintenance page.', 'Enabled'], ['Redirect Logged-in Users', 'Redirect logged-in users to the maintenance page.', 'Disabled'], ['Bypass for AJAX Requests', 'Allow AJAX requests to work in maintenance mode.', 'Enabled']],
    create: ['Create Maintenance Page', ['Page Name', 'New Maintenance Page'], ['URL Slug', '/maintenance-new'], ['Template', 'Modern Clean'], ['Page Status', 'Enabled']],
  },
}

function AdminSubpage({ type, section }) {
  const data = subpageData[type][section] || subpageData[type].files || subpageData[type].pages
  const [title, ...rows] = data
  const isForm = ['seo', 'notifications', 'settings', 'create', 'restore'].includes(section)
  return <AdminLayout><section className="admin-subpage"><style>{`
    .admin-subpage { max-width:1280px; margin:0 auto; color:var(--color-text); font-family:var(--font-body); }.admin-sub-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; gap:12px; }.admin-sub-crumb { color:#7d8c98; font-size:10px; display:flex; gap:7px; align-items:center; margin-bottom:5px; }.admin-sub-head h1 { margin:0; font:800 22px/1.2 var(--font-heading); }.admin-sub-actions { display:flex; gap:8px; }.admin-sub-actions button,.admin-sub-form button { border:1px solid #e4ebef; border-radius:7px; background:#fff; padding:8px 11px; font-size:9px; color:#42525d; }.admin-sub-actions .primary,.admin-sub-form button { color:#fff; border-color:var(--color-primary); background:var(--color-primary); }.admin-sub-tabs { display:flex; gap:15px; border-bottom:1px solid #e7edf1; margin-bottom:14px; }.admin-sub-tabs button { border:0; background:transparent; padding:10px 2px; color:#73828d; font-size:9px; }.admin-sub-tabs .active { color:var(--color-primary); border-bottom:2px solid var(--color-primary); font-weight:700; }.admin-sub-panel { border:1px solid #e7edf1; border-radius:10px; overflow:auto; background:#fff; box-shadow:0 6px 16px rgba(20,35,50,.035); }.admin-sub-panel table { width:100%; min-width:720px; border-collapse:collapse; }.admin-sub-panel th,.admin-sub-panel td { border-bottom:1px solid #edf1f4; padding:12px; text-align:left; font-size:9px; white-space:nowrap; }.admin-sub-panel th { color:#778692; background:#fafbfd; }.admin-sub-panel td { color:#354550; }.admin-sub-status { color:#15965e; background:#e7f8ee; border-radius:10px; padding:4px 8px; font-size:8px; font-weight:700; }.admin-sub-form { display:grid; gap:14px; padding:18px; max-width:760px; }.admin-sub-field { display:grid; gap:6px; color:#52636f; font-size:9px; font-weight:700; }.admin-sub-field input,.admin-sub-field textarea,.admin-sub-field select { border:1px solid #e1e9ee; border-radius:6px; padding:9px; color:#52636f; font:9px var(--font-body); }.admin-sub-field textarea { min-height:68px; resize:vertical; }.admin-sub-switch { display:flex; justify-content:space-between; gap:12px; padding:12px 0; border-bottom:1px solid #edf1f4; }.admin-sub-switch strong { display:block; font-size:9px; }.admin-sub-switch small { color:#82909a; font-size:8px; }.admin-sub-switch i { color:#19a96c; font-size:18px; }
    @media(max-width:620px){.admin-sub-head{display:block}.admin-sub-actions{margin-top:12px}}
  `}</style><header className="admin-sub-head"><div><div className="admin-sub-crumb"><span>Home</span><i className="fa-solid fa-chevron-right" /><span>System</span><i className="fa-solid fa-chevron-right" /><span>{type === 'backup' ? 'Backup & Restore' : 'Maintenance Mode'}</span><i className="fa-solid fa-chevron-right" /><b>{title}</b></div><h1>{title}</h1></div><div className="admin-sub-actions"><button type="button"><i className="fa-solid fa-filter" /> Filter</button><button type="button" className="primary"><i className="fa-solid fa-plus" /> {type === 'backup' ? 'Create Backup' : 'Add New'}</button></div></header><nav className="admin-sub-tabs" aria-label="Subpage sections">{Object.keys(subpageData[type]).map((tab) => <button type="button" key={tab} className={tab === section ? 'active' : ''}>{tab.replaceAll('-', ' ')}</button>)}</nav>{isForm ? <section className="admin-sub-panel"><div className="admin-sub-form">{rows.map(([label, value, extra], index) => type === 'maintenance' && section !== 'seo' ? <div className="admin-sub-switch" key={label}><div><strong>{label}</strong><small>{value}</small></div><i className={`fa-solid fa-toggle-${extra === 'Disabled' ? 'off' : 'on'}`} /></div> : <label className="admin-sub-field" key={label}>{label}<input defaultValue={value} /><>{index === rows.length - 1 && <button type="button">Save Changes</button>}</></label>)}</div></section> : <section className="admin-sub-panel"><table><thead><tr>{(type === 'backup' && section === 'scheduled') ? <><th>Backup Name</th><th>Type</th><th>Frequency</th><th>Time</th><th>Status</th><th>Actions</th></> : <><th>{type === 'backup' ? (section === 'logs' ? 'Date & Time' : 'Name') : (section === 'access' ? 'Type' : 'Page Name')}</th><th>{type === 'backup' ? (section === 'logs' ? 'Backup Name' : section === 'destinations' ? 'Type' : 'Type') : (section === 'access' ? 'IP Address / Range' : 'URL Slug')}</th><th>{type === 'backup' ? (section === 'logs' ? 'Status' : section === 'destinations' ? 'Used Space' : 'Size') : (section === 'access' ? 'Added By' : 'Status')}</th><th>{type === 'backup' ? (section === 'logs' ? 'Duration' : section === 'destinations' ? 'Status' : 'Location') : (section === 'access' ? 'Added On' : 'Template')}</th><th>Actions</th></>}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((value, valueIndex) => <td key={valueIndex}>{(value === 'Success' || value === 'Active' || value === 'Connected' || value === 'Enabled') ? <span className="admin-sub-status">{value}</span> : value}</td>)}<td><i className="fa-solid fa-eye" /> &nbsp; <i className="fa-solid fa-pen" /> &nbsp; <i className="fa-solid fa-trash" /></td></tr>)}</tbody></table></section>}</section></AdminLayout>
}

export default function AdminPage() {
  const { pathname } = useLocation()
  if (pathname === '/admin/backup') return <BackupRestorePage />
  if (pathname === '/admin/maintenance') return <MaintenanceModePage />
  if (pathname.startsWith('/admin/backup/')) return <AdminSubpage type="backup" section={pathname.split('/').at(-1)} />
  if (pathname.startsWith('/admin/maintenance/')) return <AdminSubpage type="maintenance" section={pathname.split('/').at(-1)} />
  const segment = pathname.split('/').filter(Boolean).pop()
  const title = labels[segment] || segment.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const state = emptyStates[segment] || [`No ${title.toLowerCase()} found`, `There is no ${title.toLowerCase()} data to display yet.`, 'folder-open']
  return <AdminLayout><section className="admin-page-placeholder"><div className="admin-page-heading"><h1>{title}</h1><button type="button">View All</button></div><EmptyState title={state[0]} description={state[1]} icon={state[2]} actionLabel={state[3]} /></section></AdminLayout>
}
