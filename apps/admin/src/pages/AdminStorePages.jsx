import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import AdminLayout from './AdminLayout'
import { EmptyState, LoadingState, ErrorState } from './AdminStates'
import { useApiQuery } from '@mirwal/shared/useApiQuery'
import api from '../api'
import Icon from '@mirwal/shared/Icon'
import './seller-pages.css'

/**
 * "Stores" and "Sellers" (`AdminSellerPages.jsx`) were built as two separate fabricated
 * sections in the original template, but Mirwal's schema has exactly one `sellers` table — a
 * seller account and its one storefront are the same real entity, not two. So this page is a
 * real conversion of the exact same duplication rather than a second fabrication to invent: it
 * shows the same real `GET /sellers` / `GET /sellers/:slug` data as the Sellers section, minus
 * the moderation actions that belong on the account view rather than the storefront view. It
 * was previously a hard-coded list of invented stores/owners/sales figures with a fake
 * "Verified Store" badge; the detail page did correctly extract a real-looking slug from the
 * URL (unlike the seller/customer detail pages found earlier), it just had nothing real to look
 * the slug up against.
 *
 * Also found and fixed: the sidebar's "Store Applications" link (`/admin/store-applications`)
 * had no matching route in `App.jsx` at all — a plain broken link, 404ing for as long as the
 * page has existed. Routed it to the already-built Seller Applications not-connected page,
 * since "a pending queue of stores to approve" is the same non-existent concept as "a pending
 * queue of sellers to approve."
 */

function Status({ value }) { return <span className={`seller-status ${value.toLowerCase()}`}>{value}</span> }

function StoreList() {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.sellers.list(signal), [])
  const stores = useMemo(() => data ?? [], [data])
  const [search, setSearch] = useState('')
  const filtered = useMemo(
    () => stores.filter((row) => `${row.name} ${row.city ?? ''}`.toLowerCase().includes(search.toLowerCase())),
    [stores, search],
  )

  return (
    <AdminLayout>
      <div className="seller-page">
        <div className="seller-heading">
          <div>
            <h1>All Stores</h1>
            <p>Home <Icon name="chevron-right" /> Stores <Icon name="chevron-right" /> All Stores</p>
          </div>
          <button type="button" className="primary" disabled title="There is no admin backend yet — nowhere to save a new store">
            <Icon name="plus" /> Add New Store
          </button>
        </div>

        {stores.length > 0 && (
          <div className="seller-kpis">
            <article><span className="seller-kpi-icon tone-0"><Icon name="store" /></span><small>Total Stores</small><strong>{stores.length}</strong></article>
          </div>
        )}

        <section className="seller-panel">
          <div className="seller-filters">
            <label><Icon name="magnifying-glass" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search store or city..." aria-label="Search stores" /></label>
            <button type="button" onClick={() => setSearch('')}><Icon name="rotate-left" /> Reset</button>
          </div>

          {isLoading && <LoadingState label="Loading stores" />}
          {error && !isLoading && <ErrorState onRetry={refetch} />}

          {!isLoading && !error && (filtered.length === 0 ? (
            <EmptyState icon="store" title="No stores found" description="Nothing matches your search." actionLabel="Reset Search" onAction={() => setSearch('')} />
          ) : (
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead><tr><th>Store</th><th>City</th><th>Products</th><th>Rating</th><th>Action</th></tr></thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.slug}>
                      <td><button type="button" className="seller-link" onClick={() => navigateTo(`/stores/${row.slug}`)}>{row.name}</button></td>
                      <td>{row.city || '—'}</td>
                      <td>{row.productCount}</td>
                      <td>{row.rating.count > 0 ? `${row.rating.average.toFixed(1)} ★ (${row.rating.count})` : 'No reviews yet'}</td>
                      <td><button type="button" aria-label={`View ${row.name}`} onClick={() => navigateTo(`/stores/${row.slug}`)}><Icon name="eye" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {filtered.length > 0 && <div className="seller-footer"><span>Showing {filtered.length} of {stores.length} stores</span></div>}
        </section>
      </div>
    </AdminLayout>
  )
}

function StoreDetail() {
  const { pathname } = useLocation()
  // `/stores/<slug>` → index 1. This read index 3, which is only correct when the app is
  // served under an extra path segment; it is not, so the slug was always empty and every
  // store detail page 404ed against the API.
  const slug = pathname.split('/').filter(Boolean)[1] ?? ''
  const { data: store, error, isLoading, refetch } = useApiQuery((signal) => api.sellers.get(slug, signal), [slug])
  const { data: productPage } = useApiQuery(
    (signal) => api.products.list({ seller: slug, pageSize: 5 }, signal),
    [slug],
    { enabled: !!store },
  )
  // Orders and reviews for this store. Previously a not-connected panel; both were always
  // reachable — order lines carry `seller_id`, and reviews join through products.
  const activity = useApiQuery((signal) => api.admin.insights.store(slug, signal), [slug], { enabled: !!store })

  if (isLoading) return <AdminLayout><LoadingState label="Loading store" /></AdminLayout>
  if (error || !store) return <AdminLayout><ErrorState onRetry={refetch} /></AdminLayout>

  return (
    <AdminLayout>
      <div className="seller-detail">
        <div className="seller-heading">
          <div>
            <h1>Store Details</h1>
            <p>Home <Icon name="chevron-right" /> Stores <Icon name="chevron-right" /> {store.name}</p>
          </div>
        </div>
        <div className="seller-profile-card">
          <div className="seller-avatar">{store.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <h2>{store.name} <Status value="Approved" /></h2>
            <p>{store.city || 'City not set'}</p>
            <small>Member since {new Date(store.memberSince).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' })}</small>
          </div>
          <dl>
            <div><dt>Products</dt><dd>{productPage?.pagination.total ?? '—'}</dd></div>
            <div><dt>Rating</dt><dd>{store.rating.count > 0 ? `${store.rating.average.toFixed(1)} ★ (${store.rating.count})` : 'No reviews yet'}</dd></div>
          </dl>
        </div>
        {store.description && <p className="seller-description">{store.description}</p>}

        <div className="seller-detail-grid">
          <section className="seller-panel">
            <h2>Products</h2>
            {productPage?.items.length ? (
              <div className="detail-columns">
                <div>
                  {productPage.items.map((product) => (
                    <p key={product.id}><b>{product.name}</b><span>Rs. {Number(product.price.amount).toLocaleString('en-PK')}</span></p>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState icon="box-open" title="No products yet" description="This store has no active products." />
            )}
          </section>
          <section className="seller-panel">
            <h2>Trading</h2>
            {activity.isLoading ? <LoadingState label="Loading orders and reviews" />
              : activity.isError || !activity.data ? (
                <EmptyState icon="clock-rotate-left" title="Could not load activity" description="Orders and reviews for this store are temporarily unavailable." />
              ) : (
                <>
                  <dl className="store-totals">
                    <div><dt>Orders</dt><dd>{activity.data.totals.orders.toLocaleString('en-PK')}</dd></div>
                    <div><dt>Units sold</dt><dd>{activity.data.totals.units.toLocaleString('en-PK')}</dd></div>
                    <div><dt>Revenue</dt><dd>{activity.data.totals.revenue.display}</dd></div>
                    <div>
                      <dt>Rating</dt>
                      {/* Null, not 0, when nobody has reviewed — "0.0 ★" reads as a bad store. */}
                      <dd>{activity.data.totals.averageRating !== null
                        ? `${activity.data.totals.averageRating} ★ (${activity.data.totals.reviews})`
                        : 'No reviews yet'}</dd>
                    </div>
                  </dl>

                  <h3 className="store-subhead">Recent orders</h3>
                  {activity.data.orders.length === 0 ? (
                    <p className="store-note">This store has not sold anything yet.</p>
                  ) : (
                    <div className="store-list">
                      {activity.data.orders.map((order) => (
                        <p key={order.id}>
                          <b>{order.orderNumber}</b>
                          <span>{order.buyer} · {order.items} item{order.items === 1 ? '' : 's'} · {order.status}</span>
                          {/* This store's share of the order, not the order total: a mixed
                              basket belongs to several sellers. */}
                          <em>{order.value.display}</em>
                        </p>
                      ))}
                    </div>
                  )}

                  <h3 className="store-subhead">Recent reviews</h3>
                  {activity.data.reviews.length === 0 ? (
                    <p className="store-note">No shopper has reviewed a product from this store yet.</p>
                  ) : (
                    <div className="store-list">
                      {activity.data.reviews.map((review) => (
                        <p key={review.id}>
                          <b>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} {review.title || review.productName}</b>
                          <span>{review.body.slice(0, 120)}{review.body.length > 120 ? '…' : ''}</span>
                          <em>{review.author}</em>
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
          </section>
        </div>
      </div>
    </AdminLayout>
  )
}

export default function AdminStorePages({ detail = false }) {
  return detail ? <StoreDetail /> : <StoreList />
}
