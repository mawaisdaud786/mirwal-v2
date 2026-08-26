import { useState } from 'react'
import { navigateTo } from '../navigation'

export default function AdminHeader({ onMenu }) {
  const [query, setQuery] = useState('')
  const submit = (event) => { event.preventDefault(); if (query.trim()) navigateTo(`/admin/search?query=${encodeURIComponent(query.trim())}`) }
  return <header className="admin-header"><button type="button" className="admin-menu" aria-label="Open navigation" onClick={onMenu}><i className="fa-solid fa-bars" /></button><form className="admin-search" onSubmit={submit}><i className="fa-solid fa-magnifying-glass" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anything..." aria-label="Search admin panel" /><kbd>Ctrl + K</kbd></form><div className="admin-header-actions"><button type="button" aria-label="Toggle theme"><i className="fa-regular fa-sun" /></button><button type="button" aria-label="Notifications"><i className="fa-regular fa-bell" /><b>12</b></button><button type="button" aria-label="Messages"><i className="fa-regular fa-message" /></button><button type="button" className="admin-profile" onClick={() => navigateTo('/admin')}><span>SA</span><div><strong>Super Admin</strong><small>Super Administrator</small></div><i className="fa-solid fa-chevron-down" /></button></div></header>
}
