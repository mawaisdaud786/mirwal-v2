import SellerSidebar from './components/SellerSidebar'
import SellerHeader from './components/SellerHeader'
import './seller-layout.css'

const SellerLayout = ({ children, activeItem, breadcrumbs, storeName = 'Awais Store' }) => {
  const handleNavigation = (path) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div className="seller-container">
      <SellerSidebar activeItem={activeItem} onNavigate={handleNavigation} />
      <div className="seller-main">
        <SellerHeader storeName={storeName} breadcrumbs={breadcrumbs} />
        <div className="seller-content">{children}</div>
      </div>
    </div>
  )
}

export default SellerLayout
