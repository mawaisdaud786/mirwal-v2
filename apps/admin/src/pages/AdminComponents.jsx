import { useState } from 'react'
import { EmptyState } from './AdminStates'
import Icon from '@mirwal/shared/Icon'

export function Heading({ title, section, crumb, action, children }) {
  return <div className={`${section}-heading`}>
    <div><h1>{title}</h1><p>Home <Icon name="chevron-right" /> {crumb} <Icon name="chevron-right" /> {title}</p></div>
    {children || (action && <button type="button" className={action.primary ? 'primary' : ''} onClick={action.onClick}>{action.icon && <Icon name={action.icon} />} {action.label}</button>)}
  </div>
}

export function Kpis({ items, section, iconPrefix = true, showPeriod = true }) {
  return <div className={`${section}-kpis`}>{items.map(([label, value, change, icon], index) => <article key={label}>
    <span className={iconPrefix ? `${section}-kpi-icon tone-${index}` : `tone-${index}`}><Icon name={icon} /></span>
    <small>{label}</small>
    <strong>{value}</strong>
    <em><Icon name="arrow-up" /> {change} {showPeriod && <i>vs last 7 days</i>}</em>
  </article>)}</div>
}

export function Filters({ section, placeholder, onSearch, children }) {
  return <div className={`${section}-filters`}>
    <label><Icon name="magnifying-glass" /><input placeholder={placeholder} aria-label={placeholder} onChange={(event) => onSearch?.(event.target.value)} /></label>
    {children}
    <button type="button"><Icon name="filter" /> Filters</button>
  </div>
}

export function Table({
  section, headers, rows, statusIndex = [], StatusComponent,
  firstLink = false, linkClass, onFirstClick,
  emptyIcon = 'box-open', emptyLabel = 'records',
  paginate = true, paginationVariant = 'buttons', total,
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize)
  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} title={`No ${emptyLabel} found`} description="Nothing matches your search or filters. Try adjusting them." />
  }
  return <div className={`${section}-table-wrap`}>
    <table className={`${section}-table`}>
      <thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead>
      <tbody>{visibleRows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>
        {row.map((cell, index) => <td key={`${row[0]}-${rowIndex}-${index}`}>
          {statusIndex.includes(index)
            ? <StatusComponent value={cell} />
            : (index === 0 && firstLink)
              ? <button type="button" className={linkClass} onClick={() => onFirstClick(row)}>{cell}</button>
              : cell}
        </td>)}
        <td><button type="button" className="row-menu" aria-label={`Actions for ${row[0]}`} onClick={() => onFirstClick?.(row)}><Icon name="ellipsis" /></button></td>
      </tr>)}</tbody>
    </table>
    {paginate && (paginationVariant === 'buttons' ? (
      <div className={`${section}-pagination`}>
        <span>Showing {(safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, rows.length)} of {total || rows.length}</span>
        <div>
          <button type="button" aria-label="Previous" disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><Icon name="chevron-left" /></button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5).map((pageNumber) => <button type="button" className={safePage === pageNumber ? 'active' : ''} key={pageNumber} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
          <button type="button" aria-label="Next" disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><Icon name="chevron-right" /></button>
        </div>
        <select aria-label="Rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}><option value="10">10 / page</option><option value="25">25 / page</option><option value="50">50 / page</option></select>
      </div>
    ) : (
      <div className={`${section}-pagination`}>
        Showing 1 to {rows.length} of {total} <span>&lsaquo; &nbsp; <b>1</b> &nbsp; 2 &nbsp; 3 &nbsp; 4 &nbsp; &rsaquo;</span>
        <select aria-label="Rows per page"><option>10 / page</option></select>
      </div>
    ))}
  </div>
}
