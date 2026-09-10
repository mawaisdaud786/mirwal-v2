import { EmptyState } from '@mirwal/shared/PageStates'
import SEOHead from './components/SEOHead'

export default function NotFoundPage() {
  return <>
    {/* A 404 must declare itself. RouteMeta cannot tell an unknown path from a valid dynamic
        route (/product/:slug and friends), so the page that knows it did not match says so. */}
    <SEOHead
      title="Page not found | Mirwal"
      description="The page you requested does not exist or has been moved."
      robots="noindex,follow"
      canonical={null}
    />
    <EmptyState type="not-found" title="Page not found" description="The page you requested does not exist or has been moved." primaryAction={{ label: 'Explore products', href: '/explore' }} secondaryAction={{ label: 'Go to home', href: '/' }} />
  </>
}
