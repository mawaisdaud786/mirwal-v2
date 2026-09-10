import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { configureAuth } from '@mirwal/shared/apiClient'
import '@mirwal/shared/styles/global.css'
import AdminApp from './App'

// Every request from this application authenticates against the admin namespace, whose
// refresh cookie is scoped to the admin API path — a storefront or seller session cookie
// cannot be exchanged for an admin one.
configureAuth({ authBase: '/admin/auth' })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AdminApp />
    </BrowserRouter>
  </StrictMode>,
)
