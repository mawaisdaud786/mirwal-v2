import { Component } from 'react'
import { Link } from 'react-router-dom'
import { navigateTo } from './navigation'
import './styles/page-states.css'

const Icon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />
export function LoadingState({ label = 'Loading Mirwal' }) { return <main className="page-state"><div className="page-state-icon loading"><Icon name="spinner" /></div><h1>{label}</h1><p>Please wait while the page loads.</p></main> }
export function EmptyState({ type = 'default', title = 'Nothing here yet', description = 'There is no content to show right now.', image = '/empty-state-illustration.svg', icon = 'box-open', primaryAction, secondaryAction, action = 'Explore products', onAction = () => navigateTo('/explore'), size = 'medium', alignment = 'center' }) {
	const primary = primaryAction || { label: action, onClick: onAction }
	const actionLink = ({ label, href, onClick }) => href ? <Link className="page-state-button" to={href}><Icon name="arrow-right" /> {label}</Link> : <button className="page-state-button" type="button" onClick={onClick}><Icon name="arrow-right" /> {label}</button>
	return <section className={`page-state page-state-${size} page-state-${alignment} page-state-${type}`}><img className="page-state-illustration" src={image} alt="" /><div className="page-state-icon" aria-hidden="true"><Icon name={icon} /></div><h1>{title}</h1><p>{description}</p><div className="page-state-actions">{actionLink(primary)}{secondaryAction && (secondaryAction.href ? <Link className="page-state-button secondary" to={secondaryAction.href}>{secondaryAction.label}</Link> : <button className="page-state-button secondary" type="button" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>)}</div></section>
}
export function ErrorState({ title = 'Something went wrong', description = 'We could not load this page. Please try again.', onRetry }) { return <section className="page-state page-state-error"><div className="page-state-icon error"><Icon name="triangle-exclamation" /></div><h1>{title}</h1><p>{description}</p><div className="page-state-error-actions"><button type="button" onClick={onRetry || (() => window.location.reload())}><Icon name="rotate-right" /> Try again</button><button type="button" className="secondary" onClick={() => navigateTo('/')}><Icon name="house" /> Back home</button></div></section> }
export class PageErrorBoundary extends Component { state = { hasError: false }; static getDerivedStateFromError() { return { hasError: true } } componentDidCatch(error) { console.error('Mirwal page error', error) } render() { return this.state.hasError ? <ErrorState /> : this.props.children } }
