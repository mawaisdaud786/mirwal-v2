import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import './states.css'


export function LoadingState({ label = 'Loading...' }) {
  return <div className="admin-state admin-loading" role="status" aria-live="polite"><span className="loading-spinner" /><strong>{label}</strong></div>
}

export function EmptyState({ icon = 'box-open', title = 'No data found', description = 'There is nothing to show here yet.', actionLabel, onAction }) {
  return <div className="admin-state admin-empty"><div className="empty-illustration"><Icon name={icon} /></div><h2>{title}</h2><p>{description}</p>{actionLabel && <button type="button" onClick={onAction}>{actionLabel}</button>}</div>
}

export function ErrorState({ onRetry }) {
  return <div className="admin-state admin-inline-error"><div className="error-state-icon"><Icon name="triangle-exclamation" /></div><h2>Something went wrong</h2><p>We couldn't load the content you were looking for. Please try again.</p><div><button type="button" className="primary" onClick={onRetry}><Icon name="rotate-right" /> Try Again</button><button type="button" onClick={() => navigateTo('/')}><Icon name="house" /> Back to Dashboard</button></div></div>
}
