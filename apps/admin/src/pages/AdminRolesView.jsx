import { Fragment, useCallback, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'

/**
 * Roles and the access-control matrix.
 *
 * These pages previously rendered a hard-coded grid of checkmarks for roles that did not
 * exist, with invented member counts. What is drawn here is `role_permissions` — the same
 * rows `requirePermission` consults on every request — so a tick in this grid means the
 * server will genuinely allow that action, and an empty cell means it will refuse.
 *
 * Editing sends the role's full desired permission set rather than a delta. A matrix of
 * checkboxes is naturally a whole-state form, and deltas would let two admins each toggle one
 * cell with the second silently reverting the first's read of "current permissions".
 */

/**
 * Label a permission within its area heading.
 *
 * The leading segment is dropped only when it repeats the area, so `catalog.product.write`
 * reads "product write" under Catalog. It is kept otherwise: `inventory.read` and `store.read`
 * both live under areas whose name they do not share, and stripping blindly rendered both of
 * them as a bare "read" — indistinguishable in a grid whose whole purpose is precision.
 */
function permissionLabel(slug, area) {
  const parts = slug.split('.')
  return parts[0] === area ? parts.slice(1).join(' ') : slug
}

export default function AdminRolesView({ mode = 'roles' }) {
  const roles = useApiQuery((signal) => api.admin.roles.list(signal), [])
  const permissions = useApiQuery((signal) => api.admin.roles.permissions(signal), [])
  const matrix = useApiQuery((signal) => api.admin.roles.matrix(signal), [])

  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(null)

  const refresh = useCallback(() => { matrix.refetch(); roles.refetch() }, [matrix, roles])

  const areas = permissions.data ?? []
  const permissionCount = areas.reduce((total, area) => total + area.permissions.length, 0)

  const startEditing = (role) => {
    setEditing(role.slug)
    setDraft(new Set(matrix.data?.[role.slug] ?? []))
    setFlash(null)
  }

  const toggle = (slug) => {
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(slug)) next.delete(slug); else next.add(slug)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setFlash(null)
    try {
      const { message } = await api.admin.roles.setPermissions(editing, [...draft])
      setFlash({ tone: 'success', text: message ?? 'Permissions saved.' })
      setEditing(null)
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally {
      setSaving(false)
    }
  }

  const isLoading = roles.isLoading || permissions.isLoading || matrix.isLoading
  const failed = roles.error ?? permissions.error ?? matrix.error

  if (isLoading) return <LoadingState label="Loading roles and permissions..." />
  if (failed) {
    return (
      <>
        <p className="administration-error-note">{describeApiError(failed)}</p>
        <ErrorState onRetry={refresh} />
      </>
    )
  }

  const roleList = roles.data ?? []
  if (!roleList.length) {
    return <EmptyState icon="user-shield" title="No roles defined" description="This database has no roles seeded." />
  }

  const held = (roleSlug, slug) =>
    (editing === roleSlug ? draft.has(slug) : (matrix.data?.[roleSlug] ?? []).includes(slug))

  return (
    <>
      {flash && (
        <p className={`administration-flash ${flash.tone}`} role="status">
          <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
        </p>
      )}

      {mode === 'roles' ? (
        <div className="role-grid">
          {roleList.map((role) => (
            <article className="role-card" key={role.slug}>
              <span><Icon name={role.slug.includes('admin') ? 'user-shield' : role.slug === 'seller' ? 'store' : 'user'} /></span>
              <h2>{role.name}</h2>
              <p>{role.description || 'No description.'}</p>
              <b>{role.permissionCount} permission{role.permissionCount === 1 ? '' : 's'} · {role.memberCount} member{role.memberCount === 1 ? '' : 's'}</b>
              {/* A locked role says why, rather than offering a button that will 409. */}
              {role.editable
                ? <button type="button" onClick={() => { setEditing(role.slug); setDraft(new Set(matrix.data?.[role.slug] ?? [])) }}>Edit permissions</button>
                : <small className="role-locked"><Icon name="lock" /> {role.lockedReason}</small>}
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="access-toolbar">
            {editing ? (
              <>
                <strong>Editing {roleList.find((role) => role.slug === editing)?.name}</strong>
                <button type="button" className="primary" disabled={saving} onClick={save}>
                  {saving ? 'Saving...' : `Save ${draft.size} permission${draft.size === 1 ? '' : 's'}`}
                </button>
                <button type="button" onClick={() => { setEditing(null); setFlash(null) }}>Cancel</button>
              </>
            ) : (
              <>
                <span>Ticks show what the server actually allows. Choose a role to change it.</span>
                {roleList.filter((role) => role.editable).map((role) => (
                  <button type="button" key={role.slug} onClick={() => startEditing(role)}>
                    <Icon name="pen" /> Edit {role.name}
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="administration-table-wrap">
            <table className="access-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  {roleList.map((role) => <th key={role.slug}>{role.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {areas.map((area) => (
                  <Fragment key={area.area}>
                    <tr className="access-area">
                      <td colSpan={roleList.length + 1}>{area.area}</td>
                    </tr>
                    {area.permissions.map((permission) => (
                      <tr key={permission.slug}>
                        <td title={permission.slug}>
                          {permissionLabel(permission.slug, area.area)}
                          <small>{permission.description}</small>
                        </td>
                        {roleList.map((role) => (
                          <td key={role.slug}>
                            {editing === role.slug ? (
                              <input
                                type="checkbox"
                                checked={draft.has(permission.slug)}
                                onChange={() => toggle(permission.slug)}
                                aria-label={`${permission.slug} for ${role.name}`}
                              />
                            ) : (
                              <Icon name={held(role.slug, permission.slug) ? 'check' : 'xmark'} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="administration-footnote">
            {permissionCount} permissions across {areas.length} areas. Permissions travel inside the
            access token, so a signed-in admin picks up a change when their session next refreshes.
          </p>
        </>
      )}
    </>
  )
}
