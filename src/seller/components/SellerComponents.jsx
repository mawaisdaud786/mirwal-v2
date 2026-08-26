// Status Badge Component
export const StatusBadge = ({ status, label }) => {
  const statusMap = {
    delivered: 'success',
    processing: 'warning',
    pending: 'warning',
    shipped: 'info',
    cancelled: 'danger',
    active: 'success',
    inactive: 'warning',
    paid: 'success',
    refunded: 'danger',
  }

  const statusColor = statusMap[status] || 'info'

  return <span className={`status-badge ${statusColor}`}>{label || status}</span>
}

// Stat Card Component
export const StatCard = ({ label, value, icon, change, isNegative }) => {
  return (
    <div className="stat-card">
      <div className="stat-card-content">
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value">{value}</div>
        {change && <div className={`stat-card-change ${isNegative ? 'negative' : ''}`}>{change}</div>}
      </div>
      {icon && <div className="stat-card-icon">{icon}</div>}
    </div>
  )
}

// Data Table Component
export const DataTable = ({ columns, data, actions }) => {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key}>{col.label}</th>
          ))}
          {actions && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td colSpan={columns.length + (actions ? 1 : 0)} style={{ textAlign: 'center', padding: '40px' }}>
              <div className="empty-state">
                <div className="empty-state-icon"><i className="fa-solid fa-inbox" aria-hidden="true" /></div>
                <h3 className="empty-state-title">No data found</h3>
                <p className="empty-state-text">There are no records to display</p>
              </div>
            </td>
          </tr>
        ) : (
          data.map((row, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
              {actions && (
                <td>
                  <div className="table-actions">
                    {actions.map((action, i) => (
                      <button
                        key={i}
                        className="table-action-btn"
                        onClick={() => action.onClick(row)}
                        title={action.label}
                      >
                        {action.icon}
                      </button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

// Empty State Component
export const EmptyState = ({ icon, title, text, actionLabel, onAction }) => {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon || <i className="fa-solid fa-inbox" aria-hidden="true" />}</div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-text">{text}</p>
      {actionLabel && (
        <button className="empty-state-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}

// Card Component
export const SellerCard = ({ title, children, action, actionLabel }) => {
  return (
    <div className="seller-card">
      {title && (
        <div className="seller-card-header">
          <h3 className="seller-card-title">{title}</h3>
          {action && <button className="seller-card-action" onClick={action}>{actionLabel}</button>}
        </div>
      )}
      {children}
    </div>
  )
}

// Pagination Component
export const Pagination = ({ currentPage, totalPages, perPage, total, onPageChange, onPerPageChange }) => {
  const startRecord = (currentPage - 1) * perPage + 1
  const endRecord = Math.min(currentPage * perPage, total)

  const getPageNumbers = () => {
    const pages = []
    const maxPagesToShow = 5
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2))
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1)

    if (endPage - startPage + 1 < maxPagesToShow) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1)
    }

    if (startPage > 1) {
      pages.push(1)
      if (startPage > 2) pages.push('...')
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i)
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pages.push('...')
      pages.push(totalPages)
    }

    return pages
  }

  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing {startRecord} to {endRecord} of {total}
      </div>
      <div className="pagination-controls">
        <select className="pagination-select" value={perPage} onChange={(e) => onPerPageChange(parseInt(e.target.value))}>
          <option value={10}>10 per page</option>
          <option value={25}>25 per page</option>
          <option value={50}>50 per page</option>
          <option value={100}>100 per page</option>
        </select>
        <button className="pagination-btn" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
        {getPageNumbers().map((page, idx) =>
          page === '...' ? (
            <span key={idx} className="pagination-ellipsis">
              ...
            </span>
          ) : (
            <button
              key={idx}
              className={`pagination-btn ${page === currentPage ? 'active' : ''}`}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          )
        )}
        <button
          className="pagination-btn"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// Filter Bar Component
export const FilterBar = ({ onSearch, onFilter, filterOptions, onReset }) => {
  return (
    <div className="filter-bar">
      <input type="text" className="filter-input" placeholder="Search..." onChange={(e) => onSearch(e.target.value)} />
      {filterOptions &&
        filterOptions.map((option, idx) => (
          <select key={idx} className="filter-select" onChange={(e) => onFilter(option.key, e.target.value)}>
            <option value="">{option.label}</option>
            {option.values && option.values.map((val, i) => (
              <option key={i} value={val}>
                {val}
              </option>
            ))}
          </select>
        ))}
      <button className="filter-button secondary" onClick={onReset}>
        Reset
      </button>
    </div>
  )
}

// Modal Component
export const Modal = ({ title, isOpen, onClose, children, onSubmit, submitLabel, cancelLabel }) => {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}>
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          <button className="modal-btn secondary" onClick={onClose}>
            {cancelLabel || 'Cancel'}
          </button>
          <button className="modal-btn primary" onClick={onSubmit}>
            {submitLabel || 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}
