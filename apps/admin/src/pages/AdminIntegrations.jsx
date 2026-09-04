import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './integrations-pages.css'

/**
 * Integrations and outbound webhooks.
 *
 * The old page listed invented third-party connections with fake "Connected" badges and
 * config fields pre-filled with plausible-looking credentials that saved nowhere.
 *
 * The rule this page is built around: **credentials are never in the database and never in a
 * response.** Whether a provider is usable is computed from the server environment at read
 * time — `credentialsPresent` tells an admin "Stripe is configured" without the endpoint being
 * able to leak the key. Changing a key means changing the environment and restarting, and the
 * page says so rather than offering a field that would quietly do nothing.
 *
 * Webhook signing secrets follow the same rule: generated server-side, returned exactly once
 * at creation, and stored only as a hash plus the last four characters.
 */

export default function AdminIntegrations({ view = 'integrations' }) {
  const isWebhooks = view === 'webhooks'

  const integrations = useApiQuery((signal) => api.admin.integrations.list(signal), [], { enabled: !isWebhooks })
  const webhooks = useApiQuery((signal) => api.admin.webhooks.list(signal), [], { enabled: isWebhooks })

  const [flash, setFlash] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newSecret, setNewSecret] = useState(null)
  const [form, setForm] = useState({ name: '', url: '', events: [] })

  const active = isWebhooks ? webhooks : integrations
  const refresh = useCallback(() => { active.refetch() }, [active])

  const run = async (action) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Saved.' })
      refresh()
      return result
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
      return null
    } finally { setBusy(false) }
  }

  const EVENTS = [
    'order.created', 'order.paid', 'order.shipped', 'order.delivered', 'order.cancelled',
    'product.approved', 'product.rejected', 'seller.approved', 'seller.suspended',
    'payout.paid', 'refund.created',
  ]

  const toggleEvent = (event) => setForm((current) => ({
    ...current,
    events: current.events.includes(event)
      ? current.events.filter((value) => value !== event)
      : [...current.events, event],
  }))

  const createWebhook = async (event) => {
    event.preventDefault()
    const result = await run(() => api.admin.webhooks.create({
      name: form.name.trim(), url: form.url.trim(), events: form.events,
    }))
    if (result) {
      // Shown once, here, and never retrievable again — the whole reason this is surfaced
      // prominently rather than as a toast that scrolls away.
      setNewSecret(result.data?.secret ?? null)
      setForm({ name: '', url: '', events: [] })
    }
  }

  const title = isWebhooks ? 'API & Webhooks' : 'Integrations'

  return (
    <AdminLayout>
      <div className="integrations-page">
        <Heading section="integrations" crumb="Settings" title={title} />

        <section className="integrations-panel">
          {flash && (
            <p className={`integrations-flash ${flash.tone}`} role="status">
              <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
            </p>
          )}

          {active.isLoading && <LoadingState label={`Loading ${title.toLowerCase()}`} />}
          {active.isError && !active.isLoading && (
            <>
              <p className="integrations-error-note">{describeApiError(active.error)}</p>
              <ErrorState onRetry={active.refetch} />
            </>
          )}

          {!active.isLoading && !active.isError && (isWebhooks ? (
            <>
              {newSecret && (
                <div className="integrations-secret" role="status">
                  <strong><Icon name="key" /> Copy this signing secret now</strong>
                  <code>{newSecret}</code>
                  <p>It is stored only as a hash and cannot be shown again. Rotate the endpoint if you lose it.</p>
                  <button type="button" onClick={() => setNewSecret(null)}>Done</button>
                </div>
              )}

              <form className="integrations-form" onSubmit={createWebhook}>
                <h2>Add an endpoint</h2>
                <label>
                  <span>Name</span>
                  <input value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} required minLength={2} placeholder="Order sync" />
                </label>
                <label>
                  <span>URL</span>
                  <input type="url" value={form.url} onChange={(event) => setForm((c) => ({ ...c, url: event.target.value }))} required placeholder="https://example.com/hooks/mirwal" />
                  <small>Must be https — Mirwal signs and sends order and customer data to this address.</small>
                </label>
                <fieldset>
                  <legend>Events</legend>
                  <div className="integrations-events">
                    {EVENTS.map((event) => (
                      <label key={event} className={form.events.includes(event) ? 'on' : ''}>
                        <input type="checkbox" checked={form.events.includes(event)} onChange={() => toggleEvent(event)} />
                        {event}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button type="submit" className="primary" disabled={busy || !form.events.length}>
                  {busy ? 'Creating...' : 'Create endpoint'}
                </button>
              </form>

              {(webhooks.data ?? []).length === 0 ? (
                <EmptyState icon="code" title="No endpoints yet" description="Add an endpoint above to receive Mirwal events." />
              ) : (
                <div className="integrations-table-wrap">
                  <table className="integrations-table">
                    <thead><tr><th>Name</th><th>URL</th><th>Events</th><th>Secret</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {(webhooks.data ?? []).map((hook) => (
                        <tr key={hook.id}>
                          <td>{hook.name}</td>
                          <td className="integrations-url">{hook.url}</td>
                          <td>{hook.events.length}</td>
                          <td><code>{hook.secretHint}</code></td>
                          <td><span className={`integrations-status ${hook.status}`}>{hook.status}</span></td>
                          <td className="integrations-actions">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (!window.confirm(`Rotate the signing secret for "${hook.name}"? The current one stops working immediately.`)) return
                                const result = await run(() => api.admin.webhooks.rotateSecret(hook.id))
                                if (result) setNewSecret(result.data?.secret ?? null)
                              }}
                            >
                              <Icon name="rotate-right" /> Rotate
                            </button>
                            <button
                              type="button"
                              className="integrations-danger"
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(`Delete endpoint "${hook.name}"?`)) return
                                run(() => api.admin.webhooks.remove(hook.id))
                              }}
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="integrations-grid">
                {(integrations.data ?? []).map((integration) => (
                  <article key={integration.provider} className={`integration-card ${integration.credentialsPresent ? 'ready' : 'missing'}`}>
                    <header>
                      <strong>{integration.name}</strong>
                      <span className={`integrations-status ${integration.credentialsPresent ? 'connected' : 'disconnected'}`}>
                        {integration.credentialsPresent ? 'Configured' : 'Not configured'}
                      </span>
                    </header>
                    <p>{integration.description}</p>
                    <small className="integration-category">{integration.category}</small>
                    {/* No credential fields: the value lives in the environment and is not readable here. */}
                    <p className="integration-hint">
                      {integration.credentialsPresent
                        ? 'Credentials are present in the server environment.'
                        : `Set this provider's keys in the API environment and restart to enable it.`}
                    </p>
                  </article>
                ))}
              </div>
              <p className="integrations-footnote">
                Mirwal never stores provider credentials in its database, so they cannot be viewed or edited
                from this panel. Configure them in the API environment (see <code>server/.env.example</code>).
              </p>
            </>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}
