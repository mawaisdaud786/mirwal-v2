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

/**
 * A table whose cells can be doors.
 *
 * `firstLink` could only ever make column 0 clickable, and the row's overflow button did the
 * same thing as clicking that first cell — so a row listing a product, its seller and its
 * category offered exactly one way in, to the product. Everything else was a dead end: reaching
 * the seller meant going to Sellers and searching for them by name.
 *
 * `links` fixes that without disturbing any existing caller. It maps a column index to a
 * handler, so a row can lead to several places, and `firstLink` is now just the special case of
 * `links[0]`.
 *
 * `rowActions` renders the overflow button's real contents. Previously it repeated the first
 * link, which meant destructive actions had nowhere to live and every list grew its own ad-hoc
 * button column.
 */
/**
 * Server-side pagination.
 *
 * Distinct from the pager built into `Table`, which slices an array the page already holds.
 * That one is fine for a list that arrives complete; it is actively misleading for a list the
 * API capped, because it pages confidently through a subset and gives no hint that the rest
 * exists. Every list that filters or pages on the server uses this instead, and takes its
 * numbers from the response rather than from `rows.length`.
 *
 * Renders nothing when everything fits on one page — a pager with one button in it is furniture.
 */
export function Pagination({ section = 'admin', page, pageSize, total, onPage, onPageSize }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  if (total === 0) return null

  const first = (current - 1) * pageSize + 1
  const last = Math.min(current * pageSize, total)

  /**
   * A window around the current page rather than every page.
   *
   * Forty pages of numbered buttons is not navigation. Five around the cursor, with the ends
   * always reachable, is how far anyone actually clicks.
   */
  const windowStart = Math.max(1, Math.min(current - 2, pageCount - 4))
  const windowEnd = Math.min(pageCount, Math.max(current + 2, 5))
  const numbers = []
  for (let index = windowStart; index <= windowEnd; index += 1) numbers.push(index)

  return (
    <div className={`${section}-pagination pagination`}>
      <span>Showing {first} to {last} of {total}</span>
      <div className="pagination-pages">
        <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => onPage(current - 1)}>
          <Icon name="chevron-left" />
        </button>
        {windowStart > 1 && (
          <>
            <button type="button" onClick={() => onPage(1)}>1</button>
            {windowStart > 2 && <span className="pagination-gap">…</span>}
          </>
        )}
        {numbers.map((number) => (
          <button type="button" key={number} className={number === current ? 'active' : ''} aria-current={number === current ? 'page' : undefined} onClick={() => onPage(number)}>
            {number}
          </button>
        ))}
        {windowEnd < pageCount && (
          <>
            {windowEnd < pageCount - 1 && <span className="pagination-gap">…</span>}
            <button type="button" onClick={() => onPage(pageCount)}>{pageCount}</button>
          </>
        )}
        <button type="button" aria-label="Next page" disabled={current === pageCount} onClick={() => onPage(current + 1)}>
          <Icon name="chevron-right" />
        </button>
      </div>
      {onPageSize && (
        <select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </select>
      )}
    </div>
  )
}

/**
 * The row's overflow menu.
 *
 * Actions arrive already filtered by the caller's `can(...)`, so an operator is never shown a
 * control the server would refuse. Anything destructive declares `confirm`, and the menu asks
 * before doing it — a delete one click deep with no confirmation is how a catalogue loses rows
 * nobody meant to remove.
 */
export function RowActions({ label, actions = [] }) {
  const [open, setOpen] = useState(false)
  const visible = actions.filter(Boolean)
  if (visible.length === 0) return null

  return (
    <div className="row-actions">
      <button
        type="button"
        className="row-menu"
        aria-label={`Actions for ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="ellipsis" />
      </button>
      {open && (
        <>
          {/* Clicking anywhere else closes it, which is what every menu on the web does. */}
          <button type="button" className="row-actions-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <ul className="row-actions-menu">
            {visible.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  className={action.danger ? 'danger' : ''}
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false)
                    if (action.confirm && !window.confirm(action.confirm)) return
                    action.onClick()
                  }}
                >
                  {action.icon && <Icon name={action.icon} />} {action.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export function Table({
  section, headers, rows, statusIndex = [], StatusComponent,
  firstLink = false, linkClass, onFirstClick, links,
  rowActions,
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
        {row.map((cell, index) => {
          // `firstLink` is the old spelling of `links[0]`; both are honoured so existing
          // callers keep working while new ones can open several columns.
          const open = links?.[index] ?? (index === 0 && firstLink ? onFirstClick : null)
          return <td key={`${row[0]}-${rowIndex}-${index}`}>
            {statusIndex.includes(index)
              ? <StatusComponent value={cell} />
              : open
                // An empty cell is not a link. Rendering a clickable blank is worse than
                // rendering nothing, because it looks like a bug the reader caused.
                ? (cell == null || cell === '' || cell === '—'
                  ? cell
                  : <button type="button" className={linkClass ?? 'table-link'} onClick={() => open(row)}>{cell}</button>)
                : cell}
          </td>
        })}
        <td>
          {rowActions
            ? <RowActions label={row[0]} actions={rowActions(row)} />
            : <button type="button" className="row-menu" aria-label={`Actions for ${row[0]}`} onClick={() => (links?.[0] ?? onFirstClick)?.(row)}><Icon name="ellipsis" /></button>}
        </td>
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
