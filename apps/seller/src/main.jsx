import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { configureAuth } from '@mirwal/shared/apiClient'
import '@mirwal/shared/styles/global.css'
import SellerApp from './App'

// Authenticates against the seller namespace, whose refresh cookie is scoped to the seller
// API path — a customer or admin session cookie cannot be exchanged for a seller one.
configureAuth({ authBase: '/seller/auth' })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SellerApp />
    </BrowserRouter>
  </StrictMode>,
)
