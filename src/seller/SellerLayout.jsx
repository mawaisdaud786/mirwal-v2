import SellerSidebar from './components/SellerSidebar'
import SellerHeader from './components/SellerHeader'
import './seller-layout.css'
import { navigateTo } from '../navigation'
import { createContext, useContext } from 'react'

const SellerShellContext = createContext(false)

const SellerLayout = ({ children, activeItem, breadcrumbs, storeName = 'Awais Store' }) => {
  const isNested = useContext(SellerShellContext)
  if (isNested) return children

  const handleNavigation = (path) => navigateTo(path)

  return <SellerShellContext.Provider value={true}>
    <div className="seller-container">
      <SellerSidebar activeItem={activeItem} onNavigate={handleNavigation} />
      <div className="seller-main">
        <SellerHeader storeName={storeName} breadcrumbs={breadcrumbs} />
        <div className="seller-content">{children}</div>
      </div>
    </div>
  </SellerShellContext.Provider>
}

export default SellerLayout
