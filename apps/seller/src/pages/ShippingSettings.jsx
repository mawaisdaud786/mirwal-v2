import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import api from '../api'
import './shipping-settings.css'

/**
 * Delivery rates, as they apply to this store.
 *
 * The template drew eight tabs of fabricated settings — invented zones and rates, fake pickup
 * addresses and phone numbers, and TCS/Leopards/M&P marked "Connected" as though real courier
 * integrations existed. `const [zones] = useState(defaultZones)` had no setter anywhere in the
 * file, so none of it was ever interactive.
 *
 * Shipping is real now (migration 018), but it belongs to Mirwal, not to the seller. Rates are
 * set once for the whole marketplace so a shopper is quoted the same delivery price whichever
 * store an item comes from — a per-seller rate table would mean a five-item basket carrying
 * five different delivery charges.
 *
 * So this page is read-only, and says why. Showing a seller an editable form over settings
 * they do not own would be a worse lie than the fabricated data it replaces.
 */

function describeRate(method) {
  if (method.rateType === 'free_over') {
    return `${method.baseAmount.display}, free over ${method.freeOverAmount?.display ?? '—'}`
  }
  if (method.rateType === 'percentage') {
    const bounds = [
      method.minAmount ? `min ${method.minAmount.display}` : null,
      method.maxAmount ? `max ${method.maxAmount.display}` : null,
    ].filter(Boolean).join(', ')
    return `${(method.rateBps ?? 0) / 100}% of the basket${bounds ? ` (${bounds})` : ''}`
  }
  return method.baseAmount.display
}

const describeDays = (method) => {
  if (method.minDays === null && method.maxDays === null) return 'No estimate published'
  if (method.minDays === method.maxDays) return `${method.minDays} working day${method.minDays === 1 ? '' : 's'}`
  return `${method.minDays ?? '?'}–${method.maxDays ?? '?'} working days`
}

function ShippingSettings() {
  const query = useApiQuery((signal) => api.shipping.zones(signal), [])

  return (
    <SellerLayout
      activeItem="shipping-settings"
      breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Delivery' }]}
    >
      <div className="shipping-settings-container">
        <div className="shipping-settings-header">
          <div>
            <h1>Delivery</h1>
            <p>What buyers are charged to have your products delivered, and how long it takes.</p>
          </div>
        </div>

        <div className="shipping-callout">
          <Icon name="circle-info" />
          <div>
            <b>Mirwal sets delivery rates, not sellers.</b>
            <p>
              One set of rates for the whole marketplace, so a basket with items from three stores carries one
              delivery charge instead of three. You keep whatever you charge for the goods; delivery is
              collected and handled by Mirwal.
            </p>
          </div>
        </div>

        {query.isLoading && <p className="shipping-loading">Loading delivery rates…</p>}

        {query.isError && !query.isLoading && (
          <EmptyState
            icon={<Icon name="triangle-exclamation" />}
            title="Could not load delivery rates"
            text={describeApiError(query.error)}
          />
        )}

        {!query.isLoading && !query.isError && (
          (query.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Icon name="truck" />}
              title="No delivery zones published yet"
              text="Mirwal has not published delivery rates yet. Until it does, orders are charged the platform default and delivery estimates are not shown at checkout."
            />
          ) : (
            <div className="shipping-zone-list">
              {query.data.map((zone) => (
                <section className="shipping-zone-card" key={zone.id}>
                  <header>
                    <div>
                      <h2>{zone.name}</h2>
                      <p>
                        {zone.cities.length > 0
                          ? zone.cities.map((city) => city.replace(/\b\w/g, (letter) => letter.toUpperCase())).join(', ')
                          : `Anywhere in ${zone.countryCodes.join(', ') || 'Pakistan'}`}
                      </p>
                    </div>
                  </header>

                  {zone.methods.length === 0 ? (
                    <p className="shipping-empty-note">
                      No delivery method is published for this zone, so it is skipped at checkout.
                    </p>
                  ) : (
                    <table className="shipping-rate-table">
                      <thead>
                        <tr><th>Option</th><th>Carrier</th><th>Buyer pays</th><th>Estimate</th></tr>
                      </thead>
                      <tbody>
                        {zone.methods.map((method) => (
                          <tr key={method.id}>
                            <td>
                              <b>{method.name}</b>
                              {method.description && <small>{method.description}</small>}
                            </td>
                            {/* A label, not an integration: Mirwal does not call the courier's
                                systems, which is why there is no "Connected" status here. */}
                            <td>{method.carrier ?? '—'}</td>
                            <td>{describeRate(method)}</td>
                            <td>{describeDays(method)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              ))}
            </div>
          )
        )}

        <p className="shipping-footnote">
          Mirwal does not connect to courier tracking systems, so no live parcel position is shown to you or to
          the buyer. You mark each item shipped and delivered from <button type="button" onClick={() => navigateTo('/orders')}>Orders</button>,
          and that is what the buyer sees.
        </p>
      </div>
    </SellerLayout>
  )
}

export default ShippingSettings
