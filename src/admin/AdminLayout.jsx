import { createContext, useContext, useState } from 'react'
import { navigateTo } from '../navigation'
import AdminSidebar from './AdminSidebar'
import AdminHeader from './AdminHeader'
import './admin.css'

const AdminContext = createContext(false)

export default function AdminLayout({ children }) {
  const nested = useContext(AdminContext)
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('mirwal-admin-collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const toggleCollapsed = () => setCollapsed((value) => {
    const next = !value
    window.localStorage.setItem('mirwal-admin-collapsed', String(next))
    return next
  })
  if (nested) return children
  return <AdminContext.Provider value={true}>
    <div className={`admin-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <AdminSidebar mobileOpen={mobileOpen} onCollapse={toggleCollapsed} onNavigate={navigateTo} onClose={() => setMobileOpen(false)} />
      <main className="admin-main"><AdminHeader onMenu={() => setMobileOpen(true)} /><div className="admin-content">{children}</div></main>
    </div>
  </AdminContext.Provider>
}
