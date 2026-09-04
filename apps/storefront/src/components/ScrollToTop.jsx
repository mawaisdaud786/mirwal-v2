import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * React Router does client-side navigation, so the browser never does its normal
 * full-page-load scroll reset — without this, navigating from partway down a long listing
 * page (or any page) to a new route kept the previous scroll position instead of opening
 * the new page at the top.
 *
 * Keyed on `pathname` only, not the full location: query-string-only changes (e.g. this
 * session's own Pagination component moving between `?page=` values on the same route)
 * already scroll themselves via Pagination's own smooth scrollTo, so re-triggering here on
 * every search-param change would just fire a redundant, competing scroll on top of that.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
