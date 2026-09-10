import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { getAccessToken } from '@mirwal/shared/apiClient'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './security-pages.css'
import './platform-pages.css'

/**
 * Maintenance mode and database exports.
 *
 * Both pages were fabricated in the template: an invented "285.6 GB used" breakdown across
 * Google Drive, S3 and Dropbox with a fake backup history and restore flow, and a maintenance
 * toggle with a fake IP allowlist and visit chart that wrote to component state.
 *
 * What replaces them is smaller than what was drawn, and deliberately so:
 *
 *  - Maintenance mode is enforced by middleware. Switching it on returns 503 to storefront and
 *    seller traffic while sign-in and the admin panel stay reachable — otherwise the person who
 *    switched it on would be locked out of the only control that switches it off.
 *
 *  - Backups export, and do not restore. A restore overwrites live data, and it belongs with
 *    whoever runs the database, not behind a button in a web panel. The export can be
 *    downloaded and handed over.
 *
 *  - Nothing is uploaded anywhere. A dump is the whole marketplace in one file, including every
 *    address and password hash; sending that to third-party storage is the operator's decision,
 *    not a default.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

const number = (value) => Number(value ?? 0).toLocaleString('en-PK')

function formatBytes(bytes) {
  const value = Number(bytes ?? 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatWhen(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

const formatUptime = (seconds) => {
  const total = Number(seconds ?? 0)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// ---------------------------------------------------------------------------

function MaintenancePanel() {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [message, setMessage] = useState(null)

  const query = useApiQuery((signal) => api.admin.platform.status(signal), [])
  const status = query.data

  const save = async (patch) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.admin.platform.setMaintenance(patch)
      setFlash({ tone: 'success', text: result.message })
      setMessage(null)
      query.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  if (query.isLoading) return <LoadingState label="Reading system status" />
  if (query.isError) {
    return (
      <section className="security-panel">
        <p className="security-note error">{describeApiError(query.error)}</p>
        <ErrorState onRetry={query.refetch} />
      </section>
    )
  }

  const { maintenance, database, server } = status
  const draft = message ?? maintenance.message

  return (
    <>
      {flash && (
        <p className={`security-flash ${flash.tone}`} role="status">
          <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
        </p>
      )}

      {maintenance.enabled && (
        <p className="platform-banner" role="status">
          <Icon name="triangle-exclamation" />
          <span>
            <b>The storefront is closed right now.</b> Shoppers and sellers get a 503 with your message.
            Sign-in and this panel stay open so you can switch it back off.
          </span>
        </p>
      )}

      <section className="security-panel">
        <div className="security-panel-head">
          <div>
            <h2>Maintenance mode</h2>
            <p className="security-note">
              Closes the storefront and the seller portal. Enforced by middleware on every request, so this is a
              real gate rather than a banner. Staff sessions always pass through, and so does <code>/health</code> —
              a load balancer that cannot health-check turns a maintenance window into an outage.
            </p>
          </div>
          <label className="security-switch">
            <input
              type="checkbox"
              checked={maintenance.enabled}
              disabled={busy}
              onChange={(event) => save({ enabled: event.target.checked })}
            />
            <span />
          </label>
        </div>

        <form
          className="security-form"
          onSubmit={(event) => { event.preventDefault(); save({ message: draft }) }}
        >
          <label>
            Message shown to visitors
            <small>Returned with every blocked request, so the storefront can explain the outage rather than fail silently.</small>
            <textarea
              value={draft}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          <div className="security-form-actions">
            <button type="submit" className="primary" disabled={busy || draft === maintenance.message}>Save message</button>
          </div>
        </form>

        {maintenance.allowIps.length > 0 && (
          <p className="security-note">
            Also allowed through: {maintenance.allowIps.join(', ')}.
          </p>
        )}
      </section>

      <section className="security-panel">
        <h2>System</h2>
        <p className="security-note">Live facts from the running server, not a saved snapshot.</p>
        <dl className="security-facts">
          <div><dt>Database</dt><dd>MariaDB {database.version} · {number(database.tables)} tables</dd></div>
          <div>
            <dt>Data size</dt>
            {/* InnoDB reports an estimate here; saying so beats printing it as an exact figure. */}
            <dd>{formatBytes(database.approximateBytes)} <small>(InnoDB estimate)</small></dd>
          </div>
          <div><dt>Connections</dt><dd>{database.openConnections ?? '—'} open{database.poolLimit ? ` · pool limit ${database.poolLimit}` : ''}</dd></div>
          <div><dt>Node</dt><dd>{server.nodeVersion} · {server.environment}</dd></div>
          <div><dt>Uptime</dt><dd>{formatUptime(server.uptimeSeconds)}</dd></div>
          <div><dt>Memory</dt><dd>{formatBytes(server.memoryBytes)} resident</dd></div>
        </dl>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------

function BackupPanel() {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const query = useApiQuery((signal) => api.admin.platform.backups({ pageSize: 50 }, signal), [])
  const refresh = useCallback(() => { query.refetch() }, [query])

  const run = async () => {
    setBusy(true)
    setFlash({ tone: 'info', text: 'Exporting. Large databases take a while — this page will update when it finishes.' })
    try {
      const result = await api.admin.platform.runBackup()
      setFlash({ tone: 'success', text: result.message })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  /**
   * Download through an authenticated fetch, not a plain link.
   *
   * An <a href> cannot carry the Authorization header, and the alternative — a URL that
   * authenticates itself — would be a link to the entire marketplace database that works for
   * anyone it is forwarded to.
   */
  const download = async (backup) => {
    setBusy(true)
    setFlash(null)
    try {
      const response = await fetch(`${API_BASE}/admin/platform/backups/${encodeURIComponent(backup.id)}/file`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
      })
      if (!response.ok) throw new Error(`Could not download that export (${response.status}).`)

      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = backup.fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setFlash({ tone: 'error', text: error.message })
    } finally { setBusy(false) }
  }

  const remove = async (backup) => {
    if (!window.confirm(`Delete ${backup.fileName}? The file is removed from the server permanently.`)) return
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.admin.platform.deleteBackup(backup.id)
      setFlash({ tone: 'success', text: result.message })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  if (query.isLoading) return <LoadingState label="Loading exports" />
  if (query.isError) {
    return (
      <section className="security-panel">
        <p className="security-note error">{describeApiError(query.error)}</p>
        <ErrorState onRetry={query.refetch} />
      </section>
    )
  }

  const items = query.data?.items ?? []
  const summary = query.data?.summary

  return (
    <>
      {flash && (
        <p className={`security-flash ${flash.tone === 'info' ? 'success' : flash.tone}`} role="status">
          <Icon name={flash.tone === 'error' ? 'triangle-exclamation' : 'circle-check'} /> {flash.text}
        </p>
      )}

      <section className="security-panel">
        <div className="security-panel-head">
          <div>
            <h2>Database exports</h2>
            <p className="security-note">
              A gzipped SQL dump of every table, taken inside a consistent snapshot — so the file restores
              cleanly rather than catching one table mid-write and leaving foreign keys pointing at nothing.
            </p>
          </div>
          <button type="button" className="primary" disabled={busy} onClick={run}>
            <Icon name="database" /> {busy ? 'Exporting...' : 'Export now'}
          </button>
        </div>

        <p className="security-note warn">
          <Icon name="circle-info" /> There is no restore button, on purpose. Restoring overwrites live data —
          download the file and hand it to whoever runs the database.
        </p>

        {summary && (
          <dl className="security-facts">
            <div><dt>Completed exports</dt><dd>{number(summary.completed)} · {formatBytes(summary.totalBytes)} on disk</dd></div>
            <div><dt>Last export</dt><dd>{formatWhen(summary.lastRunAt)}</dd></div>
            <div><dt>Retention</dt><dd>The newest {summary.keep} are kept; older ones are deleted automatically</dd></div>
            <div><dt>Stored in</dt><dd><code>{summary.directory}</code> — outside the web root, never served statically</dd></div>
          </dl>
        )}
      </section>

      <section className="security-panel">
        <h2>History</h2>
        {items.length === 0 ? (
          <EmptyState icon="database" title="No exports yet" description="Take one with Export now. It runs on the server and appears here when it finishes." />
        ) : (
          <table className="security-table">
            <thead>
              <tr><th>File</th><th className="num">Contents</th><th className="num">Size</th><th className="num">Took</th><th>By</th><th className="num">When</th><th /></tr>
            </thead>
            <tbody>
              {items.map((backup) => (
                <tr key={backup.id}>
                  <td>
                    <b>{backup.fileName}</b>
                    {backup.status !== 'completed' && <small className={backup.status}>{backup.status}{backup.error ? `: ${backup.error}` : ''}</small>}
                    {/* Shown so an export can be checked against the file after it is moved. */}
                    {backup.checksum && <small title="SHA-256 of the file">sha256 {backup.checksum.slice(0, 16)}…</small>}
                  </td>
                  <td className="num">{number(backup.tableCount)} tables<br />{number(backup.rowCount)} rows</td>
                  <td className="num">{formatBytes(backup.sizeBytes)}</td>
                  <td className="num">{(backup.durationMs / 1000).toFixed(1)}s</td>
                  <td>{backup.createdBy ?? '—'}</td>
                  <td className="num">{formatWhen(backup.createdAt)}</td>
                  <td className="platform-row-actions">
                    {backup.status === 'completed' && (
                      <button type="button" disabled={busy} onClick={() => download(backup)}>Download</button>
                    )}
                    <button type="button" className="danger" disabled={busy} onClick={() => remove(backup)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

export default function AdminPlatformPages({ view = 'maintenance' }) {
  const isBackup = view === 'backup'
  return (
    <AdminLayout>
      <div className="security-page">
        <div className="security-heading">
          <div>
            <h1>{isBackup ? 'Backup & Restore' : 'Maintenance Mode'}</h1>
            <p>Home <Icon name="chevron-right" /> System <Icon name="chevron-right" /> {isBackup ? 'Backup' : 'Maintenance'}</p>
          </div>
        </div>
        {isBackup ? <BackupPanel /> : <MaintenancePanel />}
      </div>
    </AdminLayout>
  )
}
