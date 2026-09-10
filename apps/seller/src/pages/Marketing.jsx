import { useCallback, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './marketing.css'

/**
 * Seller marketing — coupons and promotions.
 *
 * Every view here was fabricated, down to a campaign-creation flow that ended in a "Campaign
 * Launched!" screen with an invented campaign ID and nothing behind it. Coupons and
 * promotions are real now (migration 012) and scoped server-side to this store: a seller sees
 * and edits only their own, and Mirwal-wide coupons are not listed here at all.
 *
 * Performance is real: a coupon redemption records the order it discounted
 * (`coupon_redemptions.order_id`), so coupon results are measured, not estimated. Promotion
 * results are reported as what sold while the promotion ran and labelled as exactly that —
 * nothing records that a shopper bought *because* of a price change.
 *
 * Ad placements are not a thing Mirwal sells. That is a fact about the marketplace rather
 * than a missing connection, so the Ads view says so and points at what does exist.
 */

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusPill({ value }) {
  return <span className={`seller-marketing-status ${value}`}>{value.replace('_', ' ')}</span>
}

function Flash({ value }) {
  if (!value) return null
  return (
    <p className={`seller-marketing-flash ${value.tone}`} role="status">
      <Icon name={value.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {value.text}
    </p>
  )
}

const EMPTY_COUPON = { code: '', name: '', discountType: 'percentage', discountPercent: '', discountAmount: '', minOrderAmount: '0.00', usageLimit: '', status: 'draft' }
const EMPTY_PROMOTION = { name: '', description: '', discountType: 'percentage', discountPercent: '', discountAmount: '', startsAt: '', endsAt: '', status: 'draft' }

function CouponsView({ create }) {
  const [form, setForm] = useState(EMPTY_COUPON)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  /**
   * Editing, not just creating.
   *
   * The API has had `GET`/`PATCH /seller/me/coupons/:id` all along — the client already called
   * them — but nothing in this form ever loaded an id or sent a patch, so a coupon's code
   * became permanent the moment it was created and every mistake needed a fresh coupon.
   */
  const editingId = create && typeof window !== 'undefined'
    ? window.location.pathname.split('/').filter(Boolean).slice(2).find((part) => part !== 'create')
    : undefined
  const editing = useApiQuery(
    (signal) => (editingId ? api.seller.coupons.get(editingId, signal) : Promise.resolve(null)),
    [editingId],
  )
  const [loadedFor, setLoadedFor] = useState(null)
  if (editing.data && loadedFor !== editingId) {
    setLoadedFor(editingId)
    setForm({
      code: editing.data.code ?? '',
      name: editing.data.name ?? '',
      discountType: editing.data.discountType ?? 'percentage',
      discountPercent: String(editing.data.discountPercent ?? ''),
      discountAmount: editing.data.discountAmount?.amount ?? '',
      minOrderAmount: editing.data.minOrderAmount?.amount ?? '0.00',
      usageLimit: editing.data.usageLimit == null ? '' : String(editing.data.usageLimit),
      status: editing.data.status ?? 'draft',
    })
  }

  const stats = useApiQuery((signal) => api.seller.coupons.stats(signal), [])
  const list = useApiQuery((signal) => api.seller.coupons.list({ pageSize: 50 }, signal), [])
  const refresh = useCallback(() => { list.refetch(); stats.refetch() }, [list, stats])

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
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
      // The code identifies the coupon shoppers already hold; changing its terms is a
      // different act from renaming it, so an edit does not resend the code.
      if (editingId) await api.seller.coupons.update(editingId, { ...payload, code: undefined })
      else await api.seller.coupons.create(payload)
      setForm(EMPTY_COUPON)
      setLoadedFor(null)
      navigateTo('/marketing/coupons')
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const remove = async (coupon) => {
    if (!window.confirm(`Withdraw coupon ${coupon.code}? Orders that already used it are unaffected.`)) return
    setBusy(true)
    try { await api.seller.coupons.remove(coupon.id); refresh() }
    catch (error) { setFlash({ tone: 'error', text: describeApiError(error) }) }
    finally { setBusy(false) }
  }

  const items = list.data?.items ?? []

  if (create) {
    return (
      <>
        <Flash value={flash} />
        <form className="seller-marketing-form" onSubmit={submit}>
          <label>
            <span>Code</span>
            <input value={form.code} onChange={set('code')} required minLength={3} maxLength={40} placeholder="ALPHA10" />
            <small>Shoppers type this at checkout. Letters, numbers, hyphens and underscores only.</small>
          </label>
          <label>
            <span>Name</span>
            <input value={form.name} onChange={set('name')} required minLength={2} placeholder="10% off my store" />
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
              <input value={form.discountAmount} onChange={set('discountAmount')} required placeholder="250.00" />
            </label>
          )}
          <label>
            <span>Minimum order (PKR)</span>
            <input value={form.minOrderAmount} onChange={set('minOrderAmount')} />
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
          <div className="seller-marketing-actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : editingId ? 'Save changes' : 'Create coupon'}</button>
            <button type="button" onClick={() => navigateTo('/marketing/coupons')}>Cancel</button>
          </div>
        </form>
      </>
    )
  }

  return (
    <>
      <Flash value={flash} />
      {stats.data && (
        <div className="seller-marketing-kpis">
          {[['Coupons', stats.data.total], ['Active', stats.data.active], ['Draft', stats.data.draft], ['Redemptions', stats.data.redemptions]].map(([label, value]) => (
            <article key={label}><small>{label}</small><strong>{value}</strong></article>
          ))}
        </div>
      )}

      <div className="seller-marketing-bar">
        <button type="button" className="primary" onClick={() => navigateTo('/marketing/coupons/create')}>
          <Icon name="plus" /> New coupon
        </button>
      </div>

      {list.isLoading ? <p className="seller-marketing-loading">Loading coupons...</p>
        : list.isError ? <Flash value={{ tone: 'error', text: describeApiError(list.error) }} />
          : items.length === 0 ? (
            <EmptyState icon="ticket" title="No coupons yet" description="Create a coupon and shoppers can use it on your products. Its real redemption count shows here." />
          ) : (
            <div className="seller-marketing-table-wrap">
              <table className="seller-marketing-table">
                <thead><tr><th>Code</th><th>Name</th><th>Discount</th><th>Used</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {items.map((coupon) => (
                    <tr key={coupon.id}>
                      <td>
                        <button type="button" className="table-link" onClick={() => navigateTo(`/marketing/coupons/${coupon.id}`)}>
                          <code>{coupon.code}</code>
                        </button>
                      </td>
                      <td>{coupon.name}</td>
                      <td>
                        {coupon.discountType === 'percentage' && `${coupon.discountPercent}%`}
                        {coupon.discountType === 'fixed' && (coupon.discountAmount?.display ?? '—')}
                        {coupon.discountType === 'free_shipping' && 'Free shipping'}
                      </td>
                      <td>{coupon.usageCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}</td>
                      <td><StatusPill value={coupon.effectiveStatus} /></td>
                      <td>
                        <button type="button" className="seller-marketing-danger" disabled={busy} onClick={() => remove(coupon)} aria-label={`Withdraw ${coupon.code}`}>
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
  )
}

function PromotionsView({ create }) {
  const [form, setForm] = useState(EMPTY_PROMOTION)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  // Same reasoning as CouponsView: `/marketing/promotions/:id` reuses the create route, and the
  // API already had `.get`/`.update` with nothing in this form ever calling them.
  const editingId = create && typeof window !== 'undefined'
    ? window.location.pathname.split('/').filter(Boolean).slice(2).find((part) => part !== 'create')
    : undefined
  const editing = useApiQuery(
    (signal) => (editingId ? api.seller.promotions.get(editingId, signal) : Promise.resolve(null)),
    [editingId],
  )
  const [loadedFor, setLoadedFor] = useState(null)
  if (editing.data && loadedFor !== editingId) {
    setLoadedFor(editingId)
    setForm({
      name: editing.data.name ?? '',
      description: editing.data.description ?? '',
      discountType: editing.data.discountType ?? 'percentage',
      discountPercent: String(editing.data.discountPercent ?? ''),
      discountAmount: editing.data.discountAmount?.amount ?? '',
      // `datetime-local` wants a naked local timestamp, not the ISO string with a zone the API
      // returns.
      startsAt: editing.data.startsAt ? String(editing.data.startsAt).replace(' ', 'T').slice(0, 16) : '',
      endsAt: editing.data.endsAt ? String(editing.data.endsAt).replace(' ', 'T').slice(0, 16) : '',
      status: editing.data.status ?? 'draft',
    })
  }

  const list = useApiQuery((signal) => api.seller.promotions.list({ pageSize: 50 }, signal), [])
  const refresh = useCallback(() => { list.refetch() }, [list])

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const payload = {
        name: form.name.trim(),
        discountType: form.discountType,
        status: form.status,
        ...(form.description ? { description: form.description } : {}),
        ...(form.discountType === 'percentage' ? { discountPercent: Number(form.discountPercent) } : {}),
        ...(form.discountType === 'fixed' ? { discountAmount: form.discountAmount } : {}),
        ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}),
        ...(form.endsAt ? { endsAt: new Date(form.endsAt).toISOString() } : {}),
      }
      if (editingId) await api.seller.promotions.update(editingId, payload)
      else await api.seller.promotions.create(payload)
      setForm(EMPTY_PROMOTION)
      setLoadedFor(null)
      navigateTo('/marketing/promotions')
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const items = list.data?.items ?? []

  if (create) {
    return (
      <>
        <Flash value={flash} />
        <form className="seller-marketing-form" onSubmit={submit}>
          <label>
            <span>Name</span>
            <input value={form.name} onChange={set('name')} required minLength={2} placeholder="Winter clearance" />
          </label>
          <label className="seller-marketing-form-wide">
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
            <span>Ends</span>
            <input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
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
          <div className="seller-marketing-actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : editingId ? 'Save changes' : 'Create promotion'}</button>
            <button type="button" onClick={() => navigateTo('/marketing/promotions')}>Cancel</button>
          </div>
        </form>
      </>
    )
  }

  return (
    <>
      <Flash value={flash} />
      <div className="seller-marketing-bar">
        <button type="button" className="primary" onClick={() => navigateTo('/marketing/promotions/create')}>
          <Icon name="plus" /> New promotion
        </button>
      </div>

      {list.isLoading ? <p className="seller-marketing-loading">Loading promotions...</p>
        : list.isError ? <Flash value={{ tone: 'error', text: describeApiError(list.error) }} />
          : items.length === 0 ? (
            <EmptyState icon="bullhorn" title="No promotions yet" description="Run a promotion across your catalogue and it will appear here." />
          ) : (
            <div className="seller-marketing-table-wrap">
              <table className="seller-marketing-table">
                <thead><tr><th>Name</th><th>Discount</th><th>Products</th><th>Window</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {items.map((promotion) => (
                    <tr key={promotion.id}>
                      <td>
                        <button type="button" className="table-link" onClick={() => navigateTo(`/marketing/promotions/${promotion.id}`)}>
                          {promotion.name}
                        </button>
                      </td>
                      <td>
                        {promotion.discountType === 'percentage' && `${promotion.discountPercent}%`}
                        {promotion.discountType === 'fixed' && (promotion.discountAmount?.display ?? '—')}
                        {promotion.discountType === 'none' && '—'}
                      </td>
                      <td>{promotion.productCount === 0 ? 'Whole store' : promotion.productCount}</td>
                      <td>{formatDate(promotion.startsAt)} → {formatDate(promotion.endsAt)}</td>
                      <td><StatusPill value={promotion.effectiveStatus} /></td>
                      <td>
                        <button
                          type="button"
                          className="seller-marketing-danger"
                          disabled={busy}
                          onClick={async () => {
                            if (!window.confirm(`Delete "${promotion.name}"?`)) return
                            setBusy(true)
                            try { await api.seller.promotions.remove(promotion.id); refresh() }
                            catch (error) { setFlash({ tone: 'error', text: describeApiError(error) }) }
                            finally { setBusy(false) }
                          }}
                          aria-label={`Delete ${promotion.name}`}
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
  )
}

/**
 * What the store's marketing actually did.
 *
 * The two halves are reported differently on purpose. A coupon redemption names the order it
 * discounted, so those figures are attribution. A promotion changes a price and nothing
 * records that a shopper bought because of it, so its row is headed "sold while running" —
 * a real number, honestly labelled, rather than a caused one it cannot be.
 */
function PerformanceView() {
  const query = useApiQuery((signal) => api.seller.marketing.performance(signal), [])

  if (query.isLoading) return <p className="marketing-loading">Loading results...</p>
  if (query.isError) {
    return <EmptyState icon="triangle-exclamation" title="Could not load results" description={describeApiError(query.error)} />
  }

  const { totals, coupons, promotions } = query.data
  const money = (value) => value.display

  if (coupons.length === 0 && promotions.length === 0) {
    return (
      <EmptyState
        icon="chart-line"
        title="Nothing to measure yet"
        description="Create a coupon or a promotion and its results appear here. Coupon figures are exact — every redemption records the order it discounted."
      />
    )
  }

  return (
    <div className="marketing-performance">
      <div className="marketing-perf-kpis">
        <article><small>Coupons</small><strong>{totals.activeCoupons}</strong><em>{totals.coupons} in total</em></article>
        <article><small>Redemptions</small><strong>{totals.redemptions.toLocaleString('en-PK')}</strong><em>coupon uses</em></article>
        <article><small>Discount given</small><strong>{money(totals.discountGiven)}</strong><em>what it cost</em></article>
        <article><small>Value of those orders</small><strong>{money(totals.attributedOrderValue)}</strong><em>what it bought</em></article>
      </div>

      <section>
        <h2>Coupons</h2>
        <p className="marketing-perf-note">
          Exact. Every redemption records the order it discounted, so &ldquo;discount given&rdquo; and the value of
          the orders it appeared on are both measured, not estimated.
        </p>
        {coupons.length === 0 ? <p className="marketing-perf-note">No coupons yet.</p> : (
          <div className="marketing-perf-table">
            <table>
              <thead><tr><th>Code</th><th>Status</th><th className="num">Used</th><th className="num">Shoppers</th><th className="num">Discount given</th><th className="num">Order value</th></tr></thead>
              <tbody>
                {coupons.map((coupon) => (
                  <tr key={coupon.id}>
                    <td><b>{coupon.code}</b><small>{coupon.name}</small></td>
                    <td><span className={`marketing-status ${coupon.status}`}>{coupon.status}</span></td>
                    <td className="num">{coupon.redemptions}</td>
                    <td className="num">{coupon.shoppers}</td>
                    <td className="num">{money(coupon.discountGiven)}</td>
                    <td className="num">{money(coupon.orderValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Promotions</h2>
        <p className="marketing-perf-note">
          <Icon name="circle-info" /> These are sales of the promoted products <b>while the promotion was
          running</b> — not sales caused by it. A price change leaves no trace on an order, so nothing can
          honestly claim the credit. Compare against a quiet period to judge it.
        </p>
        {promotions.length === 0 ? <p className="marketing-perf-note">No promotions yet.</p> : (
          <div className="marketing-perf-table">
            <table>
              <thead><tr><th>Promotion</th><th>Status</th><th className="num">Products</th><th className="num">Orders</th><th className="num">Units</th><th className="num">Sold while running</th></tr></thead>
              <tbody>
                {promotions.map((promotion) => (
                  <tr key={promotion.id}>
                    <td><b>{promotion.name}</b><small>{promotion.kind}</small></td>
                    <td><span className={`marketing-status ${promotion.status}`}>{promotion.status}</span></td>
                    <td className="num">{promotion.products}</td>
                    <td className="num">{promotion.orders}</td>
                    <td className="num">{promotion.units}</td>
                    <td className="num">{money(promotion.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Ads.
 *
 * Mirwal does not sell placements. That is a fact about the marketplace rather than a missing
 * integration, so this says so plainly and points at the two things that do exist — rather
 * than implying a feature is on its way.
 */
function AdsView() {
  return (
    <>
      <EmptyState
        icon="rectangle-ad"
        title="Mirwal does not sell ad placements"
        description="There is no paid promotion to buy, and no advertising to bill you for. Visibility on Mirwal comes from your listings, your prices and your reviews."
      />
      <div className="seller-marketing-cards">
        <button type="button" onClick={() => navigateTo('/marketing/coupons')}>
          <Icon name="ticket" /><strong>Coupons</strong>
          <small>Discount codes shoppers type at checkout.</small>
        </button>
        <button type="button" onClick={() => navigateTo('/marketing/promotions')}>
          <Icon name="bullhorn" /><strong>Promotions</strong>
          <small>Discount your catalogue for a set period.</small>
        </button>
      </div>
    </>
  )
}

const VIEW_TITLES = {
  overview: 'Marketing',
  promotions: 'Promotions',
  'create-promotion': 'Create Promotion',
  coupons: 'Coupons',
  'create-coupon': 'Create Coupon',
  performance: 'Marketing Performance',
  ads: 'Ads Campaigns',
  'create-ads': 'Ads Campaigns',
}

export default function SellerMarketing({ view = 'overview' }) {
  // `/marketing/coupons/:id` and `/marketing/promotions/:id` reuse the create view (see
  // App.jsx) rather than a separate route, so the only sign this is an edit is the third path
  // segment being an id rather than the literal word "create".
  const pathSegments = typeof window !== 'undefined' ? window.location.pathname.split('/').filter(Boolean) : []
  const isEditingRoute = pathSegments.length > 2 && pathSegments[2] !== 'create'
  const title = isEditingRoute && view === 'create-coupon' ? 'Edit Coupon'
    : isEditingRoute && view === 'create-promotion' ? 'Edit Promotion'
      : VIEW_TITLES[view] ?? 'Marketing'

  return (
    <SellerLayout
      activeItem="marketing"
      breadcrumbs={[
        { label: 'Dashboard', onClick: () => navigateTo('/') },
        { label: 'Marketing', onClick: () => navigateTo('/marketing') },
        { label: title },
      ]}
    >
      <div className="seller-marketing-page">
        <h1>{title}</h1>

        {view === 'coupons' || view === 'create-coupon' ? (
          <CouponsView create={view === 'create-coupon'} />
        ) : view === 'promotions' || view === 'create-promotion' ? (
          <PromotionsView create={view === 'create-promotion'} />
        ) : view === 'performance' ? (
          <PerformanceView />
        ) : view === 'ads' || view === 'create-ads' ? (
          <AdsView />
        ) : (
          <div className="seller-marketing-cards">
            <button type="button" onClick={() => navigateTo('/marketing/coupons')}>
              <Icon name="ticket" /><strong>Coupons</strong>
              <small>Discount codes shoppers type at checkout, valid on your products.</small>
            </button>
            <button type="button" onClick={() => navigateTo('/marketing/promotions')}>
              <Icon name="bullhorn" /><strong>Promotions</strong>
              <small>Run a discount across your catalogue for a set period.</small>
            </button>
            <button type="button" onClick={() => navigateTo('/marketing/performance')}>
              <Icon name="chart-line" /><strong>Performance</strong>
              <small>What your coupons and promotions actually sold.</small>
            </button>
          </div>
        )}
      </div>
    </SellerLayout>
  )
}
