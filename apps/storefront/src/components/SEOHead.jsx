import { useEffect } from 'react'
import { applyMeta } from '../seo/applyMeta'
import { siteOrigin } from '../seo/routeMeta'

/**
 * Page-level metadata override.
 *
 * RouteMeta has already written a complete, correct default for this route by the time this
 * runs, so a page only needs to supply what is genuinely more specific. Every field is still
 * written here, which means navigating away and back cannot leave a stale tag behind.
 *
 * Pass `canonical={null}` for a page that must not be canonicalised (search results, anything
 * behind auth). Omit it and the current path is used.
 */
export default function SEOHead({ title, description, canonical, image, robots = 'index,follow', schema }) {
  const resolvedCanonical = canonical === null
    ? null
    : canonical || `${siteOrigin}${window.location.pathname}`

  useEffect(() => {
    applyMeta({ title, description, canonical: resolvedCanonical, image, robots, schema })
  }, [description, image, resolvedCanonical, robots, schema, title])

  return null
}
