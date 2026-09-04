import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import './catalog.css'

/**
 * Categories and brands are sitewide marketplace taxonomy, not something owned by an individual
 * seller — `products.category_id`/`brand_id` reference shared tables every seller's products
 * draw from. The mock version let a seller freely create, rename, disable and delete rows here,
 * which would be a real authorization problem if it were wired to anything real: one seller
 * deleting "Electronics" would break every other seller's products in that category. There is
 * no `/seller/me/categories` write endpoint, and there shouldn't be one shaped like this one —
 * taxonomy management belongs to admins, not individual sellers.
 *
 * What sellers can usefully see here: the real categories/brands that exist marketplace-wide
 * (the same `GET /categories` / `GET /brands` the public storefront uses), as reference for
 * what to pick when listing a product. Add/Edit/Delete are disabled and explained rather than
 * removed outright, so it's clear this isn't a missing feature so much as the wrong owner for
 * the feature.
 */
export default function CatalogPage({ type = 'categories' }) {
  const isBrands = type === 'brands'
  const [search, setSearch] = useState('')

  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => isBrands ? api.brands.list(signal) : api.categories.list(signal),
    [isBrands],
  )
  const rows = (data ?? []).filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))

  return <SellerLayout activeItem={isBrands ? 'brands' : 'categories'} breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: isBrands ? 'Brands' : 'Categories' }]}>
    <div className="catalog-container">
      <div className="catalog-header">
        <div><h1>{isBrands ? 'Brands' : 'Categories'}</h1><p>Real {isBrands ? 'brands' : 'categories'} available across the Mirwal marketplace.</p></div>
        <button type="button" disabled title="Categories and brands are managed by Mirwal, not per seller">Add New {isBrands ? 'Brand' : 'Category'}</button>
      </div>
      <div className="catalog-toolbar">
        <label><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${isBrands ? 'brands' : 'categories'}...`} /></label>
      </div>

      {isLoading && <LoadingState label={`Loading ${isBrands ? 'brands' : 'categories'}`} />}
      {error && !isLoading && <ErrorState title={`We could not load ${isBrands ? 'brands' : 'categories'}`} description={describeApiError(error)} onRetry={refetch} />}

      {!isLoading && !error && (rows.length ? (
        <section className="catalog-table">
          <div className={`catalog-row catalog-table-head ${isBrands ? 'brands-row' : ''}`}>
            <span>{isBrands ? 'Brand' : 'Category'}</span><span>Products</span><span>Actions</span>
          </div>
          {rows.map((row) => (
            <div className={`catalog-row ${isBrands ? 'brands-row' : ''}`} key={row.slug}>
              <strong>{row.name}</strong>
              <span>{row.productCount}</span>
              <span className="catalog-actions">
                <button type="button" disabled title="Managed by Mirwal, not per seller"><i className="fa-solid fa-pen" aria-hidden="true" /></button>
                <button type="button" disabled title="Managed by Mirwal, not per seller"><i className="fa-solid fa-trash" aria-hidden="true" /></button>
              </span>
            </div>
          ))}
        </section>
      ) : (
        <EmptyState icon={<i className={`fa-solid fa-${isBrands ? 'tags' : 'layer-group'}`} aria-hidden="true" />} title={`No ${isBrands ? 'brands' : 'categories'} found`} text="Nothing matches your search." actionLabel="Reset" onAction={() => setSearch('')} />
      ))}
    </div>
  </SellerLayout>
}
