const SellerHeader = ({ storeName, breadcrumbs }) => {
  return (
    <div className="seller-header">
      <div className="seller-header-left">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="seller-breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <span key={index}>
                {crumb.link ? (
                  <button onClick={crumb.onClick}>{crumb.label}</button>
                ) : (
                  crumb.label
                )}
                {index < breadcrumbs.length - 1 && <span>/</span>}
              </span>
            ))}
          </div>
        )}
        <div className="seller-search-box">
          <span className="seller-search-icon">🔍</span>
          <input type="text" placeholder="Search orders, products, customers..." />
        </div>
      </div>

      <div className="seller-header-right">
        <button className="seller-header-action-btn" title="View Store">
          👁️
          <span style={{ marginLeft: '4px', fontSize: '11px', display: 'inline-block' }}>View Store</span>
        </button>
        <button className="seller-header-action-btn" title="Notifications">
          🔔
          <div className="seller-header-action-badge">3</div>
        </button>
        <div className="seller-user-menu">
          <div className="seller-user-avatar">AS</div>
          <div className="seller-user-info">
            <div className="seller-user-name">Awais Store</div>
            <div className="seller-user-role">Seller</div>
          </div>
          <div className="seller-user-chevron">▼</div>
        </div>
      </div>
    </div>
  )
}

export default SellerHeader
