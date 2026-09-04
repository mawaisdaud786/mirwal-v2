import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './settings-pages.css'

/**
 * The real settings surface, shared by every settings route in the panel.
 *
 * Platform Settings, Payment Settings, Notification Settings, Search Configuration, Tax &
 * Commission and AI Configuration were six separate pages of toggles that wrote to component
 * state and nothing else — every one reset on reload, so "disable cash on delivery" changed
 * nothing anywhere. They are one component now because they were always one thing: a filtered
 * view of `platform_settings`, keyed by the `category` column.
 *
 * The form is dirty-tracked and saved as a batch. A settings page is one form; saving each
 * toggle as its own request would make a partial save visible if one failed halfway, and the
 * API applies the whole set in a transaction for the same reason.
 */

/** Route category → page title. The category is also the API filter. */
const SETTINGS_PAGES = {
  payments: { title: 'Payment Settings', crumb: 'Settings', icon: 'credit-card' },
  finance: { title: 'Finance & Commission', crumb: 'Settings', icon: 'coins' },
  tax: { title: 'Tax & Commission', crumb: 'Settings', icon: 'percent' },
  catalog: { title: 'Catalogue Settings', crumb: 'Settings', icon: 'box' },
  search: { title: 'Search Configuration', crumb: 'Settings', icon: 'magnifying-glass' },
  notifications: { title: 'Notification Settings', crumb: 'Settings', icon: 'bell' },
  ai: { title: 'AI Configuration', crumb: 'Settings', icon: 'wand-magic-sparkles' },
  all: { title: 'Platform Settings', crumb: 'Settings', icon: 'sliders' },
}

/** A number stored in basis points is shown as a percentage — 1000 bps reads as 10%. */
const isBps = (key) => key.endsWith('_bps')

function SettingField({ setting, value, onChange }) {
  const id = `setting-${setting.key}`

  if (setting.type === 'boolean') {
    return (
      <div className="settings-row settings-row-toggle">
        <div>
          <label htmlFor={id}><strong>{setting.label ?? setting.key}</strong></label>
          {setting.description && <p>{setting.description}</p>}
          <code>{setting.key}</code>
        </div>
        <label className="settings-switch">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(setting.key, event.target.checked)}
          />
          <span aria-hidden="true" />
          <em>{value ? 'On' : 'Off'}</em>
        </label>
      </div>
    )
  }

  if (setting.type === 'number') {
    return (
      <div className="settings-row">
        <div>
          <label htmlFor={id}><strong>{setting.label ?? setting.key}</strong></label>
          {setting.description && <p>{setting.description}</p>}
          <code>{setting.key}</code>
        </div>
        <div className="settings-number">
          <input
            id={id}
            type="number"
            value={value ?? ''}
            onChange={(event) => onChange(setting.key, event.target.value === '' ? '' : Number(event.target.value))}
          />
          {isBps(setting.key) && (
            <small>{Number.isFinite(Number(value)) ? `${(Number(value) / 100).toFixed(2)}%` : '—'}</small>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="settings-row">
      <div>
        <label htmlFor={id}><strong>{setting.label ?? setting.key}</strong></label>
        {setting.description && <p>{setting.description}</p>}
        <code>{setting.key}</code>
      </div>
      <input id={id} value={value ?? ''} onChange={(event) => onChange(setting.key, event.target.value)} />
    </div>
  )
}

export default function AdminSettingsForm({ category = 'all' }) {
  const page = SETTINGS_PAGES[category] ?? SETTINGS_PAGES.all
  const filter = category === 'all' ? undefined : category

  const query = useApiQuery(
    (signal) => api.admin.settings.list(filter ? { category: filter } : {}, signal),
    [filter],
  )

  // Only the fields the admin actually changed are sent, so two people editing different
  // pages do not overwrite each other's untouched values.
  const [draft, setDraft] = useState({})
  const [flash, setFlash] = useState(null)
  const [saving, setSaving] = useState(false)

  // Clear pending edits when the page (and therefore the loaded set) changes. This is the
  // documented "adjust state when a prop changes" pattern — resetting during render rather
  // than in an effect, so the new page never renders for a frame holding the old page's
  // half-typed values.
  const [renderedFilter, setRenderedFilter] = useState(filter)
  if (renderedFilter !== filter) {
    setRenderedFilter(filter)
    setDraft({})
    setFlash(null)
  }

  const settings = query.data ?? []
  const valueOf = useCallback(
    (setting) => (setting.key in draft ? draft[setting.key] : setting.value),
    [draft],
  )

  const onChange = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setFlash(null)
  }, [])

  const dirtyKeys = Object.keys(draft).filter((key) => {
    const original = settings.find((setting) => setting.key === key)
    return original && original.value !== draft[key]
  })

  const onSave = async (event) => {
    event.preventDefault()
    if (!dirtyKeys.length) return
    setSaving(true)
    setFlash(null)
    try {
      const updates = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]]))
      const { message } = await api.admin.settings.save(updates)
      setFlash({ tone: 'success', text: message ?? 'Settings saved.' })
      setDraft({})
      query.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="settings-page">
        <Heading section="settings" crumb={page.crumb} title={page.title} />

        <section className="settings-panel">
          {flash && (
            <p className={`settings-flash ${flash.tone}`} role="status">
              <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
            </p>
          )}

          {query.isLoading && <LoadingState label="Loading settings" />}
          {query.isError && !query.isLoading && (
            <>
              <p className="settings-error-note">{describeApiError(query.error)}</p>
              <ErrorState onRetry={query.refetch} />
            </>
          )}

          {!query.isLoading && !query.isError && (settings.length === 0 ? (
            <EmptyState
              icon="sliders"
              title="No settings in this section"
              description="This section has no configurable values yet."
            />
          ) : (
            <form onSubmit={onSave}>
              <div className="settings-list">
                {settings.map((setting) => (
                  <SettingField
                    key={setting.key}
                    setting={setting}
                    value={valueOf(setting)}
                    onChange={onChange}
                  />
                ))}
              </div>

              <div className="settings-actions">
                <button type="submit" className="primary" disabled={saving || dirtyKeys.length === 0}>
                  {saving ? 'Saving...' : dirtyKeys.length ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}` : 'Saved'}
                </button>
                {dirtyKeys.length > 0 && (
                  <button type="button" onClick={() => { setDraft({}); setFlash(null) }}>Discard changes</button>
                )}
                <small>
                  {/* Says plainly where credentials live, because "Payment Settings" implies keys are here. */}
                  Provider credentials (Stripe, JazzCash, EasyPaisa) are read from the server environment and are never editable or readable here.
                </small>
              </div>
            </form>
          ))}
        </section>
      </div>
    </AdminLayout>
  )
}
