import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { applyMeta } from '../seo/applyMeta'
import { resolveRouteMeta } from '../seo/routeMeta'

/**
 * Applies the correct default <head> metadata for the current route.
 *
 * Rendered as a sibling *before* <Routes> in App, so its effect runs before the matched page's
 * own <SEOHead> and the page's more specific values win. Any route that sets nothing still gets
 * a correct title, description, canonical and robots directive instead of inheriting the
 * previous page's.
 */
export default function RouteMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    applyMeta(resolveRouteMeta(pathname))
  }, [pathname])

  return null
}
