import { useCallback, useState } from 'react'
import AdminLayout from './AdminLayout'
import { Heading } from './AdminComponents'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './marketing-pages.css'

/**
 * Marketing: coupons, promotions, campaigns, flash sales and banners.
 *
 * All five are now backed by migration 012. Previously every one was a hard-coded table of
 * invented sales, budgets and usage counts, and the "Create" wizard had nowhere to submit —
 * the coupon detail page showed the same fabricated "SUMMER20" whichever row was clicked.
 *
 * Promotions, campaigns and flash sales are one endpoint distinguished by `kind`, so the three
 * pages share a component rather than being three near-identical copies that drift apart.
 *
 * Financial Sections is redirected to Finances in App.jsx: unlike the others it never described a real
 * marketplace concept, and there is no table it would read.
 */

const KINDS = {
  promotions: { kind: 'promotion', title: 'Promotions', noun: 'promotion' },
  campaigns: { kind: 'campaign', title: 'Campaigns', noun: 'campaign' },
  flash: { kind: 'flash_sale', title: 'Flash Sales', noun: 'flash sale' },
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** The status the row is in *right now*, which the API computes from its window. */
function StatusPill({ value }) {
  return <span className={`marketing-status ${value}`}>{value.replace('_', ' ')}</span>
}

/** Shared submit/flash handling for the small inline create forms below. */
function useSubmit(onDone) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const submit = useCallback(async (action) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Saved.' })
      await onDone?.()
      return true
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
      return false
    } finally {
      setBusy(false)
    }
  }, [onDone])

  return { busy, flash, setFlash, submit }
}

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`marketing-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

const EMPTY_COUPON = { code: '', name: '', discountType: 'percentage', discountPercent: '', discountAmount: '', minOrderAmount: '0.00', usageLimit: '', status: 'draft' }

function CouponsPage({ create }) {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(EMPTY_COUPON)

  const stats = useApiQuery((signal) => api.admin.coupons.stats(signal), [])
  const list = useApiQuery(
    (signal) => api.admin.coupons.list({ pageSize: 50, ...(status ? { status } : {}), ...(search ? { search } : {}) }, signal),
    [status, search],
  )
  const refresh = useCallback(async () => { list.refetch(); stats.refetch() }, [list, stats])
  const { busy, flash, submit } = useSubmit(refresh)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const onCreate = async (event) => {
    event.preventDefault()
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      discountType: form.discountType,
      status: form.status,
      minOrderAmount: form.minOrderAmount || '0.00',
      ...(form.discountType === 'percentage' ? { discountPercent: Number(form.discountPercent) } : {}),
      ...(form.discountType === 'fixed' ? { discountAmount: form.discountAmount } : {}),
      ...(form.usageLimit ? { usageLimit: Number(form.usageLimit) } : {}),
    }
    if (await submit(() => api.admin.coupons.create(payload))) {
      setForm(EMPTY_COUPON)
      navigateTo('/coupons')
    }
  }

  const onDelete = (coupon) => {
    if (!window.confirm(`Withdraw coupon ${coupon.code}? Past orders that used it are unaffected.`)) return
    submit(() => api.admin.coupons.remove(coupon.id))
  }

  const items = list.data?.items ?? []

  return (
    <AdminLayout>
      <div className="marketing-page">
        <Heading
          section="marketing"
          crumb="Marketing"
          title={create ? 'Create Coupon' : 'Coupons'}
          action={create
            ? { label: 'Back to coupons', icon: 'arrow-left', onClick: () => navigateTo('/coupons') }
            : { label: 'New Coupon', icon: 'plus', primary: true, onClick: () => navigateTo('/coupons/new') }}
        />

        {!create && stats.data && (
          <div className="marketing-kpis">
            {[
              ['Total', stats.data.total, 'ticket', 0],
              ['Active', stats.data.active, 'circle-check', 1],
              ['Draft', stats.data.draft, 'pen', 2],
              ['Redemptions', stats.data.redemptions, 'receipt', 3],
            ].map(([label, value, icon, tone]) => (
              <article key={label}>
                <span className={`marketing-kpi-icon tone-${tone}`}><Icon name={icon} /></span>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        )}

        <section className="marketing-panel">
          <Flash value={flash} />

          {create ? (
            <form className="marketing-form" onSubmit={onCreate}>
              <label>
                <span>Code</span>
                <input value={form.code} onChange={set('code')} required minLength={3} maxLength={40} placeholder="SAVE20" />
                <small>Letters, numbers, hyphens and underscores. Shoppers type this, so keep it short.</small>
              </label>
              <label>
                <span>Name</span>
                <input value={form.name} onChange={set('name')} required minLength={2} placeholder="20% off everything" />
              </label>
              <label>
                <span>Discount type</span>
                <select value={form.discountType} onChange={set('discountType')}>
                  <option value="percentage">Percentage off</option>
                  <option value="fixed">Fixed amount off</option>
                  <option value="free_shipping">Free shipping</option>
                </select>
              </label>
              {form.discountType === 'percentage' && (
                <label>
                  <span>Percentage</span>
                  <input type="number" min="0.01" max="100" step="0.01" value={form.discountPercent} onChange={set('discountPercent')} required />
                </label>
              )}
              {form.discountType === 'fixed' && (
                <label>
                  <span>Amount (PKR)</span>
                  <input value={form.discountAmount} onChange={set('discountAmount')} required placeholder="500.00" />
                </label>
              )}
              <label>
                <span>Minimum order (PKR)</span>
                <input value={form.minOrderAmount} onChange={set('minOrderAmount')} placeholder="0.00" />
              </label>
              <label>
                <span>Usage limit</span>
                <input type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} placeholder="Unlimited" />
              </label>
              <label>
                <span>Status</span>
                <select value={form.status} onChange={set('status')}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
              <div className="marketing-form-actions">
                <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Create coupon'}</button>
                <button type="button" onClick={() => navigateTo('/coupons')}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <div className="marketing-filters">
                <label>
                  <Icon name="magnifying-glass" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code or name..." aria-label="Search coupons" />
                </label>
                <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="expired">Expired</option>
                </select>
              </div>

              {list.isLoading && <LoadingState label="Loading coupons" />}
              {list.isError && !list.isLoading && (
                <>
                  <p className="marketing-error-note">{describeApiError(list.error)}</p>
                  <ErrorState onRetry={list.refetch} />
                </>
              )}
              {!list.isLoading && !list.isError && (items.length === 0 ? (
                <EmptyState
                  icon="ticket"
                  title="No coupons yet"
                  description="Create a coupon and it will appear here with its real redemption count."
                  actionLabel="New Coupon"
                  onAction={() => navigateTo('/coupons/new')}
                />
              ) : (
                <div className="marketing-table-wrap">
                  <table className="marketing-table">
                    <thead>
                      <tr><th>Code</th><th>Name</th><th>Discount</th><th>Used</th><th>Owner</th><th>Status</th><th>Ends</th><th /></tr>
                    </thead>
                    <tbody>
                      {items.map((coupon) => (
                        <tr key={coupon.id}>
                          <td><code>{coupon.code}</code></td>
                          <td>{coupon.name}</td>
                          <td>
                            {coupon.discountType === 'percentage' && `${coupon.discountPercent}%`}
                            {coupon.discountType === 'fixed' && (coupon.discountAmount?.display ?? '—')}
                            {coupon.discountType === 'free_shipping' && 'Free shipping'}
                          </td>
                          <td>{coupon.usageCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}</td>
                          <td>{coupon.owner ? coupon.owner.name : 'Mirwal'}</td>
                          <td><StatusPill value={coupon.effectiveStatus} /></td>
                          <td>{formatDate(coupon.endsAt)}</td>
                          <td>
                            <button type="button" className="marketing-danger" disabled={busy} onClick={() => onDelete(coupon)} aria-label={`Withdraw ${coupon.code}`}>
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

// ---------------------------------------------------------------------------
// Promotions / campaigns / flash sales
// ---------------------------------------------------------------------------

const EMPTY_PROMOTION = { name: '', description: '', discountType: 'percentage', discountPercent: '', discountAmount: '', startsAt: '', endsAt: '', status: 'draft', priority: '0' }

function PromotionsPage({ type, create }) {
  const { kind, title, noun } = KINDS[type]
  const [form, setForm] = useState(EMPTY_PROMOTION)

  const list = useApiQuery((signal) => api.admin.promotions.list({ kind, pageSize: 50 }, signal), [kind])
  const refresh = useCallback(async () => { list.refetch() }, [list])
  const { busy, flash, submit } = useSubmit(refresh)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const basePath = type === 'flash' ? '/flash-sales' : `/${type}`

  const onCreate = async (event) => {
    event.preventDefault()
    const payload = {
      name: form.name.trim(),
      kind,
      status: form.status,
      discountType: form.discountType,
      priority: Number(form.priority || 0),
      ...(form.description ? { description: form.description } : {}),
      ...(form.discountType === 'percentage' ? { discountPercent: Number(form.discountPercent) } : {}),
      ...(form.discountType === 'fixed' ? { discountAmount: form.discountAmount } : {}),
      ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}),
      ...(form.endsAt ? { endsAt: new Date(form.endsAt).toISOString() } : {}),
    }
    if (await submit(() => api.admin.promotions.create(payload))) {
      setForm(EMPTY_PROMOTION)
      navigateTo(basePath)
    }
  }

  const onDelete = (promotion) => {
    if (!window.confirm(`Delete "${promotion.name}"?`)) return
    submit(() => api.admin.promotions.remove(promotion.id))
  }

  const items = list.data?.items ?? []

  return (
    <AdminLayout>
      <div className="marketing-page">
        <Heading
          section="marketing"
          crumb="Marketing"
          title={create ? `Create ${noun.charAt(0).toUpperCase()}${noun.slice(1)}` : title}
          action={create
            ? { label: `Back to ${title.toLowerCase()}`, icon: 'arrow-left', onClick: () => navigateTo(basePath) }
            : { label: `New ${noun}`, icon: 'plus', primary: true, onClick: () => navigateTo(`${basePath}/new`) }}
        />

        <section className="marketing-panel">
          <Flash value={flash} />

          {create ? (
            <form className="marketing-form" onSubmit={onCreate}>
              <label>
                <span>Name</span>
                <input value={form.name} onChange={set('name')} required minLength={2} />
              </label>
              <label className="marketing-form-wide">
                <span>Description</span>
                <textarea value={form.description} onChange={set('description')} rows={2} />
              </label>
              <label>
                <span>Discount type</span>
                <select value={form.discountType} onChange={set('discountType')}>
                  <option value="percentage">Percentage off</option>
                  <option value="fixed">Fixed amount off</option>
                  <option value="none">No automatic discount</option>
                </select>
              </label>
              {form.discountType === 'percentage' && (
                <label>
                  <span>Percentage</span>
                  <input type="number" min="0.01" max="100" step="0.01" value={form.discountPercent} onChange={set('discountPercent')} required />
                </label>
              )}
              {form.discountType === 'fixed' && (
                <label>
                  <span>Amount (PKR)</span>
                  <input value={form.discountAmount} onChange={set('discountAmount')} required placeholder="500.00" />
                </label>
              )}
              <label>
                <span>Starts</span>
                <input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
              </label>
              <label>
                <span>Ends{kind === 'flash_sale' ? ' (required)' : ''}</span>
                <input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} required={kind === 'flash_sale'} />
                {kind === 'flash_sale' && <small>A flash sale needs an end time — that is what the storefront counts down to.</small>}
              </label>
              <label>
                <span>Priority</span>
                <input type="number" value={form.priority} onChange={set('priority')} />
                <small>Higher shows first when several are live at once.</small>
              </label>
              <label>
                <span>Status</span>
                <select value={form.status} onChange={set('status')}>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
              <div className="marketing-form-actions">
                <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : `Create ${noun}`}</button>
                <button type="button" onClick={() => navigateTo(basePath)}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              {list.isLoading && <LoadingState label={`Loading ${title.toLowerCase()}`} />}
              {list.isError && !list.isLoading && (
                <>
                  <p className="marketing-error-note">{describeApiError(list.error)}</p>
                  <ErrorState onRetry={list.refetch} />
                </>
              )}
              {!list.isLoading && !list.isError && (items.length === 0 ? (
                <EmptyState
                  icon="bullhorn"
                  title={`No ${title.toLowerCase()} yet`}
                  description={`Create a ${noun} and it will appear here.`}
                  actionLabel={`New ${noun}`}
                  onAction={() => navigateTo(`${basePath}/new`)}
                />
              ) : (
                <div className="marketing-table-wrap">
                  <table className="marketing-table">
                    <thead>
                      <tr><th>Name</th><th>Discount</th><th>Products</th><th>Owner</th><th>Window</th><th>Status</th><th /></tr>
                    </thead>
                    <tbody>
                      {items.map((promotion) => (
                        <tr key={promotion.id}>
                          <td>{promotion.name}</td>
                          <td>
                            {promotion.discountType === 'percentage' && `${promotion.discountPercent}%`}
                            {promotion.discountType === 'fixed' && (promotion.discountAmount?.display ?? '—')}
                            {promotion.discountType === 'none' && '—'}
                          </td>
                          <td>{promotion.productCount === 0 ? 'All' : promotion.productCount}</td>
                          <td>{promotion.owner ? promotion.owner.name : 'Mirwal'}</td>
                          <td>{formatDate(promotion.startsAt)} → {formatDate(promotion.endsAt)}</td>
                          <td><StatusPill value={promotion.effectiveStatus} /></td>
                          <td>
                            <button type="button" className="marketing-danger" disabled={busy} onClick={() => onDelete(promotion)} aria-label={`Delete ${promotion.name}`}>
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

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

const EMPTY_BANNER = { title: '', subtitle: '', imageUrl: '', linkUrl: '', placement: 'home_hero', position: '0', status: 'draft' }

function BannersPage({ create }) {
  const [form, setForm] = useState(EMPTY_BANNER)
  const list = useApiQuery((signal) => api.admin.banners.list({}, signal), [])
  const refresh = useCallback(async () => { list.refetch() }, [list])
  const { busy, flash, submit } = useSubmit(refresh)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const onCreate = async (event) => {
    event.preventDefault()
    const payload = {
      title: form.title.trim(),
      imageUrl: form.imageUrl.trim(),
      placement: form.placement,
      position: Number(form.position || 0),
      status: form.status,
      ...(form.subtitle ? { subtitle: form.subtitle } : {}),
      ...(form.linkUrl ? { linkUrl: form.linkUrl.trim() } : {}),
    }
    if (await submit(() => api.admin.banners.create(payload))) {
      setForm(EMPTY_BANNER)
      navigateTo('/banners')
    }
  }

  const banners = list.data ?? []

  return (
    <AdminLayout>
      <div className="marketing-page">
        <Heading
          section="marketing"
          crumb="Marketing"
          title={create ? 'Create Banner' : 'Banners'}
          action={create
            ? { label: 'Back to banners', icon: 'arrow-left', onClick: () => navigateTo('/banners') }
            : { label: 'New Banner', icon: 'plus', primary: true, onClick: () => navigateTo('/banners/new') }}
        />

        <section className="marketing-panel">
          <Flash value={flash} />

          {create ? (
            <form className="marketing-form" onSubmit={onCreate}>
              <label>
                <span>Title</span>
                <input value={form.title} onChange={set('title')} required minLength={2} />
              </label>
              <label>
                <span>Subtitle</span>
                <input value={form.subtitle} onChange={set('subtitle')} />
              </label>
              <label className="marketing-form-wide">
                <span>Image URL</span>
                <input value={form.imageUrl} onChange={set('imageUrl')} required type="url" placeholder="https://..." />
              </label>
              <label className="marketing-form-wide">
                <span>Link</span>
                <input value={form.linkUrl} onChange={set('linkUrl')} placeholder="/deals" />
                <small>An internal path only, starting with “/”. External links are rejected — the homepage hero must not redirect shoppers off Mirwal.</small>
              </label>
              <label>
                <span>Placement</span>
                <select value={form.placement} onChange={set('placement')}>
                  <option value="home_hero">Home hero</option>
                  <option value="home_strip">Home strip</option>
                  <option value="category_top">Category top</option>
                </select>
              </label>
              <label>
                <span>Position</span>
                <input type="number" min="0" value={form.position} onChange={set('position')} />
              </label>
              <label>
                <span>Status</span>
                <select value={form.status} onChange={set('status')}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
              <div className="marketing-form-actions">
                <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Create banner'}</button>
                <button type="button" onClick={() => navigateTo('/banners')}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              {list.isLoading && <LoadingState label="Loading banners" />}
              {list.isError && !list.isLoading && (
                <>
                  <p className="marketing-error-note">{describeApiError(list.error)}</p>
                  <ErrorState onRetry={list.refetch} />
                </>
              )}
              {!list.isLoading && !list.isError && (banners.length === 0 ? (
                <EmptyState
                  icon="rectangle-ad"
                  title="No banners yet"
                  description="Create a banner to merchandise a slot on the storefront."
                  actionLabel="New Banner"
                  onAction={() => navigateTo('/banners/new')}
                />
              ) : (
                <div className="marketing-banner-grid">
                  {banners.map((banner) => (
                    <article key={banner.id} className="marketing-banner-card">
                      <img src={banner.imageUrl} alt="" loading="lazy" />
                      <div>
                        <strong>{banner.title}</strong>
                        {banner.subtitle && <p>{banner.subtitle}</p>}
                        <small>{banner.placement} · position {banner.position}</small>
                      </div>
                      <div className="marketing-banner-actions">
                        <StatusPill value={banner.effectiveStatus} />
                        <button
                          type="button"
                          className="marketing-danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Delete banner "${banner.title}"?`)) return
                            submit(() => api.admin.banners.remove(banner.id))
                          }}
                          aria-label={`Delete ${banner.title}`}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}

export default function AdminMarketingPages({ type = 'flash', create = false, detail = false }) {
  if (type === 'coupons') return <CouponsPage create={create || detail} />
  if (type === 'banners') return <BannersPage create={create} />
  if (KINDS[type]) return <PromotionsPage type={type} create={create} />

  // Any other type lands on the flash-sale promotions view, which is what the remaining
  // marketing links point at. "Financial Sections" is redirected to Finances in App.jsx.
  return <PromotionsPage type="flash" create={create} />
}
