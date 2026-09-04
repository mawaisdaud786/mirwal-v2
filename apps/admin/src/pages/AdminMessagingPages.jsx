import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './messaging-pages.css'

/**
 * Email & SMS.
 *
 * This page used to be invented delivery-rate KPIs over SMTP fields pre-filled with fake
 * credentials that saved nowhere — Mirwal sent nothing at all. It sends now: `lib/mailer.js`
 * delivers over SMTP (nodemailer) and through a generic SMS gateway, and every attempt is
 * recorded in `message_deliveries`.
 *
 * The distinction the delivery log makes, and the reason it exists: **skipped** means no
 * provider is configured so nothing was attempted; **failed** means a provider tried and
 * refused. Collapsing those into one red status would send an operator hunting for a fault
 * on a deployment that simply has no mail set up.
 *
 * Credentials are not editable here. They live in the API environment, exactly like the
 * payment providers, so they are never readable through an admin endpoint.
 */

const TABS = [
  ['overview', 'Overview'],
  ['templates', 'Templates'],
  ['logs', 'Delivery log'],
]

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`messaging-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

function OverviewTab({ flash, setFlash }) {
  const caps = useApiQuery((signal) => api.admin.messaging.capabilities(signal), [])
  const [busy, setBusy] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testKey, setTestKey] = useState('order.confirmation')

  const templates = useApiQuery((signal) => api.admin.messaging.templates({ channel: 'email' }, signal), [])

  const test = async (action) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: result.data?.ok === false || result.data?.status === 'failed' ? 'error' : 'success', text: result.message })
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  if (caps.isLoading) return <LoadingState label="Checking providers" />
  if (caps.isError) return <ErrorState onRetry={caps.refetch} />

  const { messaging, storage } = caps.data

  return (
    <>
      <Flash value={flash} />
      <div className="messaging-providers">
        {[
          ['Email (SMTP)', messaging.email.configured, messaging.email.configured ? `${messaging.email.host} · from ${messaging.email.from}` : 'Set SMTP_HOST in the API environment to enable sending.'],
          ['SMS gateway', messaging.sms.configured, messaging.sms.configured ? `Sender ${messaging.sms.sender}` : 'Set SMS_API_URL and SMS_API_KEY to enable sending.'],
          ['Document storage', storage.configured, `${storage.driver} · ${storage.directory}`],
        ].map(([label, configured, detail]) => (
          <article key={label} className={configured ? 'ready' : 'missing'}>
            <header>
              <strong>{label}</strong>
              <span className={`messaging-status ${configured ? 'sent' : 'skipped'}`}>{configured ? 'Configured' : 'Not configured'}</span>
            </header>
            <p>{detail}</p>
          </article>
        ))}
      </div>

      <div className="messaging-actions">
        <button type="button" disabled={busy} onClick={() => test(() => api.admin.messaging.testConnection())}>
          <Icon name="plug" /> Test SMTP connection
        </button>
      </div>

      <form
        className="messaging-test"
        onSubmit={(event) => {
          event.preventDefault()
          test(() => api.admin.messaging.sendTest({ key: testKey, channel: 'email', to: testTo.trim() }))
        }}
      >
        <h2>Send a test message</h2>
        <p>Renders the template with sample values and sends it, so you can check it arrives and reads correctly.</p>
        <div className="messaging-test-row">
          <label>
            <span>Template</span>
            <select value={testKey} onChange={(event) => setTestKey(event.target.value)}>
              {(templates.data ?? []).map((template) => (
                <option key={template.key} value={template.key}>{template.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Send to</span>
            <input type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} required placeholder="you@example.com" />
          </label>
          <button type="submit" className="primary" disabled={busy || !testTo.trim()}>
            {busy ? 'Sending...' : 'Send test'}
          </button>
        </div>
        {!messaging.email.configured && (
          <p className="messaging-note">
            No SMTP host is configured, so nothing will actually be sent — the attempt will be recorded as
            <strong> skipped</strong> in the delivery log rather than reported as a failure.
          </p>
        )}
      </form>
    </>
  )
}

function TemplatesTab({ flash, setFlash }) {
  const [channel, setChannel] = useState('email')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ subject: '', body: '' })
  const [busy, setBusy] = useState(false)

  const templates = useApiQuery((signal) => api.admin.messaging.templates({ channel }, signal), [channel])
  const refresh = useCallback(() => { templates.refetch() }, [templates])

  const startEdit = (template) => {
    setEditing(template.key)
    setDraft({ subject: template.subject ?? '', body: template.body })
    setFlash(null)
  }

  const save = async (template) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.admin.messaging.updateTemplate(template.channel, template.key, {
        ...(template.channel === 'email' ? { subject: draft.subject } : {}),
        body: draft.body,
      })
      setFlash({ tone: 'success', text: result.message })
      setEditing(null)
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  if (templates.isLoading) return <LoadingState label="Loading templates" />
  if (templates.isError) return <ErrorState onRetry={templates.refetch} />

  const items = templates.data ?? []

  return (
    <>
      <Flash value={flash} />
      <div className="messaging-subtabs">
        {['email', 'sms'].map((value) => (
          <button type="button" key={value} className={channel === value ? 'active' : ''} onClick={() => { setChannel(value); setEditing(null) }}>
            {value === 'email' ? 'Email' : 'SMS'}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState icon="envelope" title="No templates" description={`No ${channel} templates are defined.`} />
      ) : (
        <div className="messaging-templates">
          {items.map((template) => (
            <article key={template.key} className="messaging-template">
              <header>
                <div>
                  <strong>{template.name}</strong>
                  <code>{template.key}</code>
                  {template.description && <p>{template.description}</p>}
                </div>
                <div className="messaging-template-actions">
                  <button
                    type="button"
                    className={`messaging-toggle ${template.isActive ? 'on' : ''}`}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await api.admin.messaging.updateTemplate(template.channel, template.key, { isActive: !template.isActive })
                        refresh()
                      } catch (error) { setFlash({ tone: 'error', text: describeApiError(error) }) }
                      finally { setBusy(false) }
                    }}
                  >
                    {template.isActive ? 'On' : 'Off'}
                  </button>
                  <button type="button" onClick={() => (editing === template.key ? setEditing(null) : startEdit(template))}>
                    {editing === template.key ? 'Cancel' : 'Edit'}
                  </button>
                </div>
              </header>

              {editing === template.key ? (
                <div className="messaging-editor">
                  {template.channel === 'email' && (
                    <label>
                      <span>Subject</span>
                      <input value={draft.subject} onChange={(event) => setDraft((d) => ({ ...d, subject: event.target.value }))} />
                    </label>
                  )}
                  <label>
                    <span>Body</span>
                    <textarea value={draft.body} onChange={(event) => setDraft((d) => ({ ...d, body: event.target.value }))} rows={10} />
                  </label>
                  {/* Only these placeholders are supplied by the sending code; the API rejects
                      anything else rather than letting a typo render into a live email. */}
                  <p className="messaging-vars">
                    Available placeholders:{' '}
                    {template.variables.map((name) => <code key={name}>{`{{${name}}}`}</code>)}
                  </p>
                  <div className="messaging-editor-actions">
                    <button type="button" className="primary" disabled={busy} onClick={() => save(template)}>
                      {busy ? 'Saving...' : 'Save template'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {template.subject && <p className="messaging-subject"><strong>Subject:</strong> {template.subject}</p>}
                  <pre className="messaging-preview">{template.body}</pre>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  )
}

function LogsTab() {
  const [status, setStatus] = useState('')
  const logs = useApiQuery(
    (signal) => api.admin.messaging.deliveries({ pageSize: 100, ...(status ? { status } : {}) }, signal),
    [status],
  )

  if (logs.isLoading) return <LoadingState label="Loading delivery log" />
  if (logs.isError) return <ErrorState onRetry={logs.refetch} />

  const items = logs.data?.items ?? []
  const stats = logs.data?.stats

  return (
    <>
      {stats && (
        <div className="messaging-kpis">
          {[['Attempts', stats.total], ['Sent', stats.sent], ['Failed', stats.failed], ['Skipped', stats.skipped]].map(([label, value]) => (
            <article key={label}><small>{label}</small><strong>{value}</strong></article>
          ))}
        </div>
      )}

      <div className="messaging-subtabs">
        {[['', 'All'], ['sent', 'Sent'], ['failed', 'Failed'], ['skipped', 'Skipped']].map(([value, label]) => (
          <button type="button" key={label} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="paper-plane"
          title="Nothing sent yet"
          description="Every message Mirwal attempts is recorded here with the provider's result — including ones skipped because no provider is configured."
        />
      ) : (
        <div className="messaging-table-wrap">
          <table className="messaging-table">
            <thead><tr><th>When</th><th>Template</th><th>To</th><th>Subject</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td className="messaging-when">{formatWhen(entry.createdAt)}</td>
                  <td><code>{entry.templateKey}</code><small>{entry.channel}</small></td>
                  <td>{entry.recipient}</td>
                  <td className="messaging-detail">{entry.subject ?? '—'}</td>
                  <td><span className={`messaging-status ${entry.status}`}>{entry.status}</span></td>
                  <td className="messaging-detail">{entry.error ?? entry.provider ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="messaging-footnote">
        <strong>Skipped</strong> means no provider is configured, so nothing was attempted — not a failure.
        <strong> Failed</strong> means a provider tried and refused, and the reason is shown.
      </p>
    </>
  )
}

export default function AdminMessagingPages() {
  const { pathname } = useLocation()
  const current = pathname.split('/').filter(Boolean)[1] ?? 'overview'
  const tab = TABS.some(([value]) => value === current) ? current : 'overview'
  const [flash, setFlash] = useState(null)

  return (
    <AdminLayout>
      <div className="messaging-page">
        <div className="messaging-heading">
          <div>
            <h1>Email &amp; SMS</h1>
            <p>Home <Icon name="chevron-right" /> Settings <Icon name="chevron-right" /> Email &amp; SMS</p>
          </div>
        </div>

        <nav className="messaging-tabs">
          {TABS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={tab === value ? 'active' : ''}
              onClick={() => { setFlash(null); navigateTo(value === 'overview' ? '/messaging' : `/messaging/${value}`) }}
            >
              {label}
            </button>
          ))}
        </nav>

        <section className="messaging-panel">
          {tab === 'templates' ? <TemplatesTab flash={flash} setFlash={setFlash} />
            : tab === 'logs' ? <LogsTab />
              : <OverviewTab flash={flash} setFlash={setFlash} />}
        </section>
      </div>
    </AdminLayout>
  )
}
