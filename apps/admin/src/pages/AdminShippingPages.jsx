import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import AdminLayout from './AdminLayout'
import { EmptyState, ErrorState, LoadingState } from './AdminStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './shipping-pages.css'

/**
 * Shipping zones, methods and warehouses.
 *
 * The template drew invented zones, four courier partners all marked "Active", a fake 98.2%
 * on-time ring and "12,456 orders shipped" — none of which had a table behind it. Migration
 * 018 adds `shipping_zones`, `shipping_methods` and `warehouses`, and the storefront's
 * `GET /shipping/quote` prices a basket from them.
 *
 * That quote is why this page matters: without a caller, this would be three CRUD screens
 * that decide nothing. What is configured here is what a shopper is charged.
 *
 * Two tabs the old version had are deliberately gone rather than rebuilt:
 *  - Delivery Partners. A carrier is a free-text field on a method, not an integration —
 *    Mirwal does not call TCS or Leopards, and a page of connected-looking couriers would
 *    say it does.
 *  - Tracking & Notifications. Order status changes already email the customer through
 *    Messaging; a second page of toggles would be a duplicate that could disagree.
 */

const TABS = [
  ['Zones & rates', 'zones', 'map'],
  ['Warehouses', 'warehouses', 'warehouse'],
]

const number = (value) => Number(value ?? 0).toLocaleString('en-PK')

const RATE_TYPES = [
  ['flat', 'Flat fee', 'The same amount on every order.'],
  ['free_over', 'Free over a threshold', 'A flat fee, waived once the basket reaches an amount.'],
  ['percentage', 'Percentage of basket', 'A share of the order value, optionally clamped.'],
]

function describeRate(method) {
  if (method.rateType === 'free_over') {
    return `${method.baseAmount.display}, free over ${method.freeOverAmount?.display ?? '—'}`
  }
  if (method.rateType === 'percentage') {
    const bounds = [
      method.minAmount ? `min ${method.minAmount.display}` : null,
      method.maxAmount ? `max ${method.maxAmount.display}` : null,
    ].filter(Boolean).join(', ')
    return `${(method.rateBps ?? 0) / 100}% of basket${bounds ? ` (${bounds})` : ''}`
  }
  return method.baseAmount.display
}

const describeDays = (method) => {
  if (method.minDays === null && method.maxDays === null) return 'No estimate'
  if (method.minDays === method.maxDays) return `${method.minDays} day${method.minDays === 1 ? '' : 's'}`
  return `${method.minDays ?? '?'}–${method.maxDays ?? '?'} days`
}

// ---------------------------------------------------------------------------

function ZoneForm({ onSubmit, onCancel, busy }) {
  const [name, setName] = useState('')
  const [cities, setCities] = useState('')
  const [priority, setPriority] = useState(100)

  return (
    <form
      className="shipping-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          name: name.trim(),
          cities: cities.split(',').map((city) => city.trim()).filter(Boolean),
          countryCodes: ['PK'],
          priority: Number(priority),
        })
      }}
    >
      <h3>New zone</h3>
      <label>
        Zone name
        <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} placeholder="e.g. Karachi metro" />
      </label>
      <label>
        Cities <small>Comma-separated. Leave empty to match anywhere in Pakistan — that is how a nationwide fallback is written.</small>
        <input value={cities} onChange={(event) => setCities(event.target.value)} placeholder="karachi, hyderabad" />
      </label>
      <label>
        Priority <small>Lower wins when several zones match, so a city zone can sit in front of a nationwide one.</small>
        <input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} min={0} max={9999} />
      </label>
      <div className="shipping-form-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Create zone'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function MethodForm({ onSubmit, onCancel, busy }) {
  const [form, setForm] = useState({
    name: '', carrier: '', rateType: 'flat', baseAmount: '0',
    freeOverAmount: '', rateBps: '', minDays: '', maxDays: '',
  })
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const chosen = RATE_TYPES.find(([value]) => value === form.rateType)

  return (
    <form
      className="shipping-form"
      onSubmit={(event) => {
        event.preventDefault()
        const payload = {
          name: form.name.trim(),
          rateType: form.rateType,
          baseAmount: form.baseAmount || '0',
          ...(form.carrier.trim() ? { carrier: form.carrier.trim() } : {}),
          // Only sent when the chosen rate type uses them — the API rejects a method whose
          // numbers cannot produce a price, and an empty string is not a number.
          ...(form.rateType === 'free_over' && form.freeOverAmount ? { freeOverAmount: form.freeOverAmount } : {}),
          ...(form.rateType === 'percentage' && form.rateBps ? { rateBps: Math.round(Number(form.rateBps) * 100) } : {}),
          ...(form.minDays !== '' ? { minDays: Number(form.minDays) } : {}),
          ...(form.maxDays !== '' ? { maxDays: Number(form.maxDays) } : {}),
        }
        onSubmit(payload)
      }}
    >
      <h3>New delivery method</h3>
      <label>
        Name
        <input value={form.name} onChange={set('name')} required minLength={2} maxLength={120} placeholder="e.g. Standard delivery" />
      </label>
      <label>
        Carrier <small>Shown to the shopper. Mirwal does not call the courier&rsquo;s systems — this is a label, not an integration.</small>
        <input value={form.carrier} onChange={set('carrier')} maxLength={80} placeholder="TCS" />
      </label>
      <label>
        How it is priced
        <select value={form.rateType} onChange={set('rateType')}>
          {RATE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>{chosen?.[2]}</small>
      </label>
      <label>
        {form.rateType === 'percentage' ? 'Minimum charge' : 'Fee'} (Rs.)
        <input value={form.baseAmount} onChange={set('baseAmount')} inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="199" />
      </label>
      {form.rateType === 'free_over' && (
        <label>
          Free once the basket reaches (Rs.)
          <input value={form.freeOverAmount} onChange={set('freeOverAmount')} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="3000" />
        </label>
      )}
      {form.rateType === 'percentage' && (
        <label>
          Percentage of basket
          <input value={form.rateBps} onChange={set('rateBps')} required inputMode="decimal" placeholder="2.5" />
        </label>
      )}
      <div className="shipping-form-row">
        <label>Fastest (days)<input type="number" value={form.minDays} onChange={set('minDays')} min={0} max={365} /></label>
        <label>Slowest (days)<input type="number" value={form.maxDays} onChange={set('maxDays')} min={0} max={365} /></label>
      </div>
      <div className="shipping-form-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Add method'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function WarehouseForm({ onSubmit, onCancel, busy }) {
  const [form, setForm] = useState({ name: '', code: '', city: '', addressLine: '', contactPhone: '', isDefault: false })
  const set = (key) => (event) => setForm((current) => ({
    ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  }))

  return (
    <form className="shipping-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form) }}>
      <h3>New warehouse</h3>
      <div className="shipping-form-row">
        <label>Name<input value={form.name} onChange={set('name')} required minLength={2} maxLength={120} /></label>
        <label>Code<input value={form.code} onChange={set('code')} required minLength={2} maxLength={30} pattern="[A-Za-z0-9_-]+" placeholder="KHI-1" /></label>
      </div>
      <label>City<input value={form.city} onChange={set('city')} required maxLength={100} /></label>
      <label>Address<input value={form.addressLine} onChange={set('addressLine')} maxLength={255} /></label>
      <label>Contact phone<input value={form.contactPhone} onChange={set('contactPhone')} maxLength={20} /></label>
      <label className="shipping-check">
        <input type="checkbox" checked={form.isDefault} onChange={set('isDefault')} />
        Make this the default dispatch origin
      </label>
      <div className="shipping-form-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Add warehouse'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------

export default function AdminShippingPages() {
  const { pathname } = useLocation()
  const segment = pathname.split('/')[2] || 'zones'
  const tab = TABS.find(([, key]) => key === segment)?.[1] ?? 'zones'

  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [adding, setAdding] = useState(null)

  const query = useApiQuery((signal) => api.admin.shipping.overview(signal), [])
  const refresh = useCallback(() => { query.refetch() }, [query])

  const run = async (action, closeForm = true) => {
    setBusy(true)
    setFlash(null)
    try {
      const result = await action()
      setFlash({ tone: 'success', text: result?.message ?? 'Saved.' })
      if (closeForm) setAdding(null)
      refresh()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const data = query.data
  const stats = data?.stats

  return (
    <AdminLayout>
      <div className="shipping-page">
        <div className="shipping-heading">
          <div>
            <h1>Shipping &amp; Delivery</h1>
            <p>Home <Icon name="chevron-right" /> System <Icon name="chevron-right" /> Shipping &amp; Delivery</p>
          </div>
        </div>

        <nav className="shipping-tabs" aria-label="Shipping sections">
          {TABS.map(([label, key, icon]) => (
            <button type="button" key={key} className={key === tab ? 'active' : ''} onClick={() => navigateTo(`/shipping/${key}`)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        </nav>

        {flash && (
          <p className={`shipping-flash ${flash.tone}`} role="status">
            <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
          </p>
        )}

        {query.isLoading && <LoadingState label="Loading shipping configuration" />}
        {query.isError && !query.isLoading && (
          <section className="shipping-panel">
            <p className="shipping-note error">{describeApiError(query.error)}</p>
            <ErrorState onRetry={query.refetch} />
          </section>
        )}

        {!query.isLoading && !query.isError && data && (
          <>
            {stats && (
              <div className="shipping-kpis">
                <article><small>Zones</small><strong>{number(stats.activeZones)}</strong><em>{number(stats.zones)} configured</em></article>
                <article><small>Delivery methods</small><strong>{number(stats.activeMethods)}</strong><em>{number(stats.methods)} configured</em></article>
                <article><small>Warehouses</small><strong>{number(stats.warehouses)}</strong><em>active</em></article>
              </div>
            )}

            {tab === 'zones' && (
              <>
                <section className="shipping-panel">
                  <div className="shipping-panel-head">
                    <div>
                      <h2>Zones &amp; rates</h2>
                      <p className="shipping-note">
                        A zone matches a delivery address; its methods are what the shopper can choose and what
                        checkout charges. When no zone matches, the <b>shipping.default_fee</b> setting applies —
                        so checkout is never left with nothing to offer.
                      </p>
                    </div>
                    <button type="button" className="primary" onClick={() => setAdding({ kind: 'zone' })}>
                      <Icon name="plus" /> New zone
                    </button>
                  </div>

                  {adding?.kind === 'zone' && (
                    <ZoneForm busy={busy} onCancel={() => setAdding(null)} onSubmit={(body) => run(() => api.admin.shipping.createZone(body))} />
                  )}

                  {data.zones.length === 0 ? (
                    <EmptyState
                      icon="map"
                      title="No shipping zones yet"
                      description="Add a zone to start charging real delivery rates. Until then every order falls back to the platform default fee."
                    />
                  ) : data.zones.map((zone) => (
                    <article key={zone.id} className={`shipping-zone ${zone.isActive ? '' : 'inactive'}`}>
                      <header>
                        <div>
                          <strong>{zone.name}</strong>
                          <small>
                            {zone.cities.length > 0 ? zone.cities.join(', ') : 'Anywhere in '}
                            {zone.cities.length === 0 && zone.countryCodes.join(', ')}
                            {' · priority '}{zone.priority}
                          </small>
                        </div>
                        <div className="shipping-zone-actions">
                          <button type="button" disabled={busy} onClick={() => run(() => api.admin.shipping.updateZone(zone.id, { isActive: !zone.isActive }), false)}>
                            {zone.isActive ? 'Disable' : 'Enable'}
                          </button>
                          <button type="button" disabled={busy} onClick={() => setAdding({ kind: 'method', zoneId: zone.id })}>
                            <Icon name="plus" /> Method
                          </button>
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`Remove "${zone.name}" and its ${zone.methodCount} method(s)?`)) return
                              run(() => api.admin.shipping.deleteZone(zone.id), false)
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </header>

                      {adding?.kind === 'method' && adding.zoneId === zone.id && (
                        <MethodForm busy={busy} onCancel={() => setAdding(null)} onSubmit={(body) => run(() => api.admin.shipping.createMethod(zone.id, body))} />
                      )}

                      {zone.methods.length === 0 ? (
                        <p className="shipping-note">
                          No methods yet. A zone with no methods offers a shopper nothing, so it is skipped at checkout.
                        </p>
                      ) : (
                        <table className="shipping-methods">
                          <thead><tr><th>Method</th><th>Carrier</th><th>Rate</th><th>Delivery</th><th /></tr></thead>
                          <tbody>
                            {zone.methods.map((method) => (
                              <tr key={method.id} className={method.isActive ? '' : 'inactive'}>
                                <td><b>{method.name}</b>{!method.isActive && <small>Disabled</small>}</td>
                                <td>{method.carrier ?? '—'}</td>
                                <td>{describeRate(method)}</td>
                                <td>{describeDays(method)}</td>
                                <td className="shipping-row-actions">
                                  <button type="button" disabled={busy} onClick={() => run(() => api.admin.shipping.updateMethod(method.id, { isActive: !method.isActive }), false)}>
                                    {method.isActive ? 'Disable' : 'Enable'}
                                  </button>
                                  <button
                                    type="button"
                                    className="danger"
                                    disabled={busy}
                                    onClick={() => {
                                      if (!window.confirm(`Remove "${method.name}"?`)) return
                                      run(() => api.admin.shipping.deleteMethod(method.id), false)
                                    }}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </article>
                  ))}
                </section>
              </>
            )}

            {tab === 'warehouses' && (
              <section className="shipping-panel">
                <div className="shipping-panel-head">
                  <div>
                    <h2>Warehouses</h2>
                    <p className="shipping-note">
                      Where stock is dispatched from. Stock levels stay on the product variants — a warehouse
                      records the origin, it does not own the inventory.
                    </p>
                  </div>
                  <button type="button" className="primary" onClick={() => setAdding({ kind: 'warehouse' })}>
                    <Icon name="plus" /> New warehouse
                  </button>
                </div>

                {adding?.kind === 'warehouse' && (
                  <WarehouseForm busy={busy} onCancel={() => setAdding(null)} onSubmit={(body) => run(() => api.admin.shipping.createWarehouse(body))} />
                )}

                {data.warehouses.length === 0 ? (
                  <EmptyState icon="warehouse" title="No warehouses yet" description="Add the location orders are dispatched from." />
                ) : (
                  <table className="shipping-methods">
                    <thead><tr><th>Name</th><th>Code</th><th>City</th><th>Contact</th><th /></tr></thead>
                    <tbody>
                      {data.warehouses.map((warehouse) => (
                        <tr key={warehouse.id} className={warehouse.isActive ? '' : 'inactive'}>
                          <td>
                            <b>{warehouse.name}</b>
                            {warehouse.isDefault && <small>Default origin</small>}
                            {warehouse.addressLine && <small>{warehouse.addressLine}</small>}
                          </td>
                          <td><code>{warehouse.code}</code></td>
                          <td>{warehouse.city}</td>
                          <td>{warehouse.contactPhone || '—'}</td>
                          <td className="shipping-row-actions">
                            {!warehouse.isDefault && (
                              <button type="button" disabled={busy} onClick={() => run(() => api.admin.shipping.updateWarehouse(warehouse.id, { isDefault: true }), false)}>
                                Make default
                              </button>
                            )}
                            <button
                              type="button"
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(`Remove ${warehouse.name}?`)) return
                                run(() => api.admin.shipping.deleteWarehouse(warehouse.id), false)
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  )
}
