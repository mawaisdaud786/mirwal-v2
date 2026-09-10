import SellerLayout from '../SellerLayout'
import { navigateTo } from '@mirwal/shared/navigation'

function SellerNotFound() {
  return (
    <SellerLayout
      activeItem="dashboard"
      breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Page Not Found' }]}
    >
      <section className="seller-page-not-found">
        <i className="fa-solid fa-file-circle-xmark" aria-hidden="true" />
        <h1>Page not found</h1>
        <p>The seller page you requested does not exist.</p>
        <button type="button" className="seller-primary-btn" onClick={() => navigateTo('/')}>Back to Dashboard</button>
      </section>
    </SellerLayout>
  )
}

export default SellerNotFound
