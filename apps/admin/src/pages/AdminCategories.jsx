import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import Icon from '@mirwal/shared/Icon'
import './categories.css'

/**
 * Sitewide category taxonomy.
 *
 * This page previously read the public `GET /categories`, which returns active categories only
 * with no id, status or sort order — so status, ordering and inactive categories were dropped
 * as unanswerable, and Add/Edit/Delete were disabled because no write endpoint existed.
 *
 * `GET/POST/PATCH/DELETE /admin/categories` exist now and answer all of it: every category
 * including hidden ones, its parent, position, and a real product count.
 *
 * Deleting is refused by the server while a category still holds products or subcategories —
 * `products.category_id` is NOT NULL, so cascading would not merely be undesirable, the
 * database would reject it. The UI says which, rather than surfacing a foreign-key error.
 */

const EMPTY = { name: '', parentSlug: '', description: '', imageUrl: '', position: '0', isActive: true }

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`categories-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

function CategoryForm({ categories, onDone, onCancel }) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.admin.categories.create({
        name: form.name.trim(),
        position: Number(form.position || 0),
        isActive: form.isActive,
        ...(form.parentSlug ? { parentSlug: form.parentSlug } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
      })
      onDone(`Category "${form.name.trim()}" created.`)
    } catch (requestError) {
      setError(describeApiError(requestError))
    } finally { setBusy(false) }
  }

  return (
    <form className="categories-form" onSubmit={submit}>
      {error && <Flash value={{ tone: 'error', text: error }} />}
      <label>
        <span>Name</span>
        <input value={form.name} onChange={set('name')} required minLength={2} maxLength={150} placeholder="Kitchen & Small Appliances" />
      </label>
      <label>
        <span>Parent category</span>
        <select value={form.parentSlug} onChange={set('parentSlug')}>
          <option value="">Top level</option>
          {categories.filter((category) => !category.parent).map((category) => (
            <option key={category.slug} value={category.slug}>{category.name}</option>
          ))}
        </select>
      </label>
      <label className="categories-form-wide">
        <span>Description</span>
        <textarea value={form.description} onChange={set('description')} rows={2} />
      </label>
      <label className="categories-form-wide">
        <span>Image URL</span>
        <input type="url" value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://..." />
      </label>
      <label>
        <span>Position</span>
        <input type="number" min="0" value={form.position} onChange={set('position')} />
        <small>Lower shows first in navigation.</small>
      </label>
      <label className="categories-checkbox">
        <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((c) => ({ ...c, isActive: event.target.checked }))} />
        <span>Visible on the storefront</span>
      </label>
      <div className="categories-form-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Create category'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function AdminCategories({ create = false }) {
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  const query = useApiQuery((signal) => api.admin.categories.list(signal), [])
  const refresh = useCallback(() => { query.refetch() }, [query])

  const run = async (key, action, successText) => {
    setBusy(key)
    setFlash(null)
    try {
      await action()
      setFlash({ tone: 'success', text: successText })
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(null) }
  }

  const categories = query.data ?? []
  const visible = categories.filter((category) => category.name.toLowerCase().includes(search.toLowerCase()))
  const activeCount = categories.filter((category) => category.isActive).length
  const uncategorised = categories.reduce((total, category) => total + category.productCount, 0)

  return (
    <AdminLayout>
      <div className="categories-page">
        <div className="categories-heading">
          <div>
            <h1>{create ? 'New Category' : 'Categories'}</h1>
            <p>Home <Icon name="chevron-right" /> Marketplace <Icon name="chevron-right" /> Categories</p>
          </div>
          {!create && (
            <button type="button" className="primary" onClick={() => navigateTo('/categories/new')}>
              <Icon name="plus" /> New Category
            </button>
          )}
        </div>

        {!create && categories.length > 0 && (
          <div className="categories-kpis">
            {[
              ['Categories', categories.length],
              ['Visible', activeCount],
              ['Hidden', categories.length - activeCount],
              ['Products classified', uncategorised],
            ].map(([label, value]) => (
              <article key={label}><small>{label}</small><strong>{value}</strong></article>
            ))}
          </div>
        )}

        <section className="categories-panel">
          <Flash value={flash} />

          {create ? (
            <CategoryForm
              categories={categories}
              onCancel={() => navigateTo('/categories')}
              onDone={(message) => { setFlash({ tone: 'success', text: message }); refresh(); navigateTo('/categories') }}
            />
          ) : (
            <>
              <div className="categories-filters">
                <label>
                  <Icon name="magnifying-glass" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories..." aria-label="Search categories" />
                </label>
              </div>

              {query.isLoading && <LoadingState label="Loading categories" />}
              {query.isError && !query.isLoading && (
                <>
                  <p className="categories-error-note">{describeApiError(query.error)}</p>
                  <ErrorState onRetry={query.refetch} />
                </>
              )}

              {!query.isLoading && !query.isError && (visible.length === 0 ? (
                <EmptyState icon="layer-group" title="No categories" description="Create a category to organise the marketplace." />
              ) : (
                <div className="categories-table-wrap">
                  <table className="categories-table">
                    <thead><tr><th>Category</th><th>Parent</th><th>Products</th><th>Position</th><th>Visible</th><th /></tr></thead>
                    <tbody>
                      {visible.map((category) => (
                        <tr key={category.slug}>
                          <td>
                            <strong>{category.name}</strong>
                            <small>{category.slug}</small>
                          </td>
                          <td>{category.parent ? category.parent.name : <span className="categories-muted">Top level</span>}</td>
                          <td>{category.productCount}</td>
                          <td>{category.position}</td>
                          <td>
                            <button
                              type="button"
                              className={`categories-toggle ${category.isActive ? 'on' : ''}`}
                              disabled={busy === category.slug}
                              onClick={() => run(
                                category.slug,
                                () => api.admin.categories.update(category.slug, { isActive: !category.isActive }),
                                `${category.name} ${category.isActive ? 'hidden from' : 'shown on'} the storefront.`,
                              )}
                            >
                              {category.isActive ? 'Visible' : 'Hidden'}
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="categories-danger"
                              disabled={busy === category.slug}
                              onClick={() => {
                                // The server refuses while products or children remain; explaining
                                // it here is clearer than surfacing the 409 after the click.
                                if (category.productCount > 0) {
                                  setFlash({ tone: 'error', text: `${category.name} still holds ${category.productCount} product(s). Move them to another category first.` })
                                  return
                                }
                                if (!window.confirm(`Delete category "${category.name}"?`)) return
                                run(category.slug, () => api.admin.categories.remove(category.slug), `${category.name} deleted.`)
                              }}
                              aria-label={`Delete ${category.name}`}
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}
