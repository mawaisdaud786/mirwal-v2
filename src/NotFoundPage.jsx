import { navigateTo } from './navigation'

export default function NotFoundPage() {
  return (
    <main className="mirwal-container" style={{ padding: '72px 0 96px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 8px', color: 'var(--color-primary)', fontWeight: 700 }}>404</p>
      <h1 className="mirwal-heading">Page not found</h1>
      <p className="mirwal-copy">The page you requested does not exist or has been moved.</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24 }}>
        <button type="button" className="mirwal-button" onClick={() => navigateTo('/')}>Back to Home</button>
        <button type="button" className="mirwal-button" style={{ background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }} onClick={() => navigateTo('/explore')}>Explore products</button>
      </div>
    </main>
  )
}
