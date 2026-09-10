import { useEffect, useId, useRef, useState } from 'react'

/**
 * A self-contained dropdown, replacing the four `data-bs-toggle="dropdown"` menus that were
 * the entire reason Bootstrap's JS bundle shipped (see PROJECT_AUDIT.md §37).
 *
 * Deliberately reproduces the behaviour Bootstrap was providing, rather than only the look:
 * click outside to close, Escape to close and return focus to the trigger, and a real
 * `aria-expanded` — the markup previously hard-coded `aria-expanded="false"` even while the
 * menu was open, so screen readers were told the opposite of the truth.
 *
 * Keeps the existing `.dropdown` / `.dropdown-toggle` / `.dropdown-menu` class names, which
 * the project's own CSS already styles, so no visual change comes with the swap.
 */
export default function Dropdown({ className = '', toggleClassName = '', menuClassName = '', label, children }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const toggleRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className={`dropdown ${className}`.trim()}>
      <button
        ref={toggleRef}
        type="button"
        className={`dropdown-toggle ${toggleClassName}`.trim()}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open && (
        // Closing on click lives here rather than on each item so callers keep their own
        // onClick handlers unchanged, exactly as Bootstrap's auto-close behaved.
        <ul
          id={menuId}
          className={`dropdown-menu show ${menuClassName}`.trim()}
          onClick={() => setOpen(false)}
        >
          {children}
        </ul>
      )}
    </div>
  )
}
