import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * Handing a parcel to a courier.
 *
 * "Shipped" used to be a value in a dropdown — a seller picked it and the buyer's order said
 * "Shipped" with nothing behind it: no carrier, no tracking number, no dispatch time. There
 * was nothing for the buyer to follow and nothing for either side to point at when a parcel
 * went missing.
 *
 * The API now refuses that status outright and takes a shipment instead, so this dialog is the
 * only way an item becomes shipped. That is deliberate: the status and the evidence for it can
 * never disagree if there is only one way to produce both.
 *
 * The tracking number is optional because it honestly sometimes is — a seller delivering by
 * their own rider has none, and blocking dispatch over a field they cannot fill would push
 * them back to lying about the status.
 */
export default function ShipItemDialog({ item, onClose, onShipped }) {
  const carriers = useApiQuery((signal) => api.seller.carriers(signal), [])
  const [form, setForm] = useState({ carrierSlug: '', trackingNumber: '', estimatedDeliveryAt: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (field) => (event) => setForm((state) => ({ ...state, [field]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.seller.shipments.create({
        orderItemIds: [item.id],
        carrierSlug: form.carrierSlug || null,
        trackingNumber: form.trackingNumber.trim() || null,
        // The input gives a local date; the API wants an ISO instant with an offset, and an
        // unparseable one would render as "Invalid Date" on the buyer's tracking page.
        estimatedDeliveryAt: form.estimatedDeliveryAt
          ? new Date(`${form.estimatedDeliveryAt}T12:00:00`).toISOString()
          : null,
        notes: form.notes.trim() || null,
      })
      onShipped()
    } catch (shipError) {
      setError(describeApiError(shipError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ship-backdrop" role="dialog" aria-modal="true" aria-label="Mark as shipped">
      <form className="ship-dialog" onSubmit={submit}>
        <header className="ship-header">
          <h2>Mark as shipped</h2>
          <button type="button" onClick={onClose} aria-label="Close"><Icon name="xmark" /></button>
        </header>

        <p className="ship-item">{item.product?.name ?? item.productName} &middot; qty {item.quantity}</p>

        <label className="ship-field">
          <span>Courier</span>
          <select value={form.carrierSlug} onChange={set('carrierSlug')}>
            <option value="">Choose a courier…</option>
            {(carriers.data ?? []).map((carrier) => (
              <option key={carrier.slug} value={carrier.slug}>{carrier.name}</option>
            ))}
          </select>
        </label>

        <label className="ship-field">
          <span>Tracking number</span>
          <input
            value={form.trackingNumber}
            onChange={set('trackingNumber')}
            placeholder="As printed on the parcel"
            maxLength={80}
          />
          <small>Leave blank if you are delivering this yourself — the buyer is told that instead.</small>
        </label>

        <label className="ship-field">
          <span>Expected delivery</span>
          <input type="date" value={form.estimatedDeliveryAt} onChange={set('estimatedDeliveryAt')} />
          <small>Shown to the buyer as your delivery promise.</small>
        </label>

        <label className="ship-field">
          <span>Notes <em>(optional)</em></span>
          <input value={form.notes} onChange={set('notes')} placeholder="Anything the buyer should know" maxLength={500} />
        </label>

        {error && <p className="ship-error" role="alert">{error}</p>}

        <div className="ship-actions">
          <button type="submit" className="ship-primary" disabled={busy}>
            {busy ? 'Marking shipped…' : 'Mark shipped'}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
