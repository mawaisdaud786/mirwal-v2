import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import '@mirwal/shared/styles/global.css'
import './marketplace-polish.css'
// Replaces Bootstrap, which shipped ~232 KB of CSS and ~80 KB of JS for four dropdowns, two
// `.btn` buttons and one checkbox. Imported in Bootstrap's old slot so cascade order is
// unchanged. See PROJECT_AUDIT.md §37.
import './styles/bootstrap-replacements.css'
import { configureAuth } from '@mirwal/shared/apiClient'
import App from './App.jsx'

// The storefront authenticates customers against the public auth namespace. The admin and
// seller applications use their own namespaces on their own subdomains, with refresh cookies
// scoped to those API paths, so a customer session here is never exchangeable for either.
configureAuth({ authBase: '/auth' })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </StrictMode>,
)
