import { useState } from 'react'
import { navigateTo } from '../navigation'
import AdminLayout from './AdminLayout'
import './error.css'

export default function AdminErrorPage() {
  const [retrying, setRetrying] = useState(false)
  const retry = () => { setRetrying(true); window.setTimeout(() => setRetrying(false), 700) }
  return <AdminLayout><main className="admin-error-page"><div className="admin-error-art" aria-hidden="true"><div className="error-gear gear-one"><i className="fa-solid fa-gear" /></div><div className="error-gear gear-two"><i className="fa-solid fa-gear" /></div><div className="error-window"><span /><span /><span /><div><i className="fa-solid fa-triangle-exclamation" /></div><b /></div><div className="error-robot"><i className="fa-solid fa-robot" /><span className="robot-body">M</span><b className="robot-foot left" /><b className="robot-foot right" /></div></div><h1>Oops! Something went wrong</h1><p>We couldn't load the content you were looking for.<br />This might be a temporary issue. Please try again.</p><div className="admin-error-meta"><span>Error Code: 500</span><i /><span>Time: May 24, 2025 10:30 AM</span></div><div className="admin-error-actions"><button type="button" className="primary" onClick={retry}><i className={`fa-solid fa-rotate-right ${retrying ? 'spin' : ''}`} /> {retrying ? 'Retrying...' : 'Try Again'}</button><button type="button" onClick={() => navigateTo('/admin')}><i className="fa-solid fa-house" /> Back to Dashboard</button></div><div className="admin-error-or"><span>OR</span></div><button type="button" className="admin-support" onClick={() => navigateTo('/admin/support')}><i className="fa-solid fa-headset" /> Contact Support</button></main></AdminLayout>
}
