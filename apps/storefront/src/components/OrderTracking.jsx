import { useApiQuery } from '@mirwal/shared/useApiQuery'
import FaIcon from '@mirwal/shared/Icon'
import api from '../api'

/**
 * Following a parcel.
 *
 * Until shipments existed, "Shipped" was a word on the buyer's order with nothing behind it —
 * no carrier, no tracking number, no expected date. There was nothing to follow, and in an
 * "it never arrived" argument neither side had anything to point at.
 *
 * The endpoint deliberately withholds two things this component therefore cannot show: the
 * seller's internal notes, and the proof-of-delivery photograph. A proof image can contain a
 * doorway, a face or a neighbour — it exists to settle a dispute, not to be browsed.
 *
 * Rendered only when there is something to say. An empty tracking panel on an order that has
 * not shipped is worse than no panel: it reads as though something has gone wrong.
 */
const STATUS_STEPS = ['ready', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered']

const STATUS_COPY = {
  ready: { label: 'Packed', detail: 'The seller has packed this and is handing it to the courier.' },
  dispatched: { label: 'Dispatched', detail: 'Handed to the courier.' },
  in_transit: { label: 'On its way', detail: 'Moving through the courier network.' },
  out_for_delivery: { label: 'Out for delivery', detail: 'With a rider for delivery today.' },
  delivered: { label: 'Delivered', detail: 'Handed over.' },
  failed: { label: 'Delivery failed', detail: 'The courier could not deliver it.' },
  returned: { label: 'Returned to seller', detail: 'The parcel came back.' },
  cancelled: { label: 'Cancelled', detail: 'This shipment was cancelled.' },
}

export default function OrderTracking({ orderId }) {
  const { data, error, isLoading } = useApiQuery(
    (signal) => api.tracking.forOrder(orderId, signal),
    [orderId],
  )

  if (isLoading || error || !data?.length) {
    // Silent on error too: a tracking panel that says "we could not load tracking" on an order
    // that was never shipped is alarming and wrong. The order page above still shows status.
    return null
  }

  return (
    <section className="order-tracking">
      <h2><FaIcon name="truck-fast" /> Delivery</h2>
      {data.map((shipment) => <Shipment key={shipment.id} shipment={shipment} />)}
    </section>
  )
}

function Shipment({ shipment }) {
  const failed = ['failed', 'returned', 'cancelled'].includes(shipment.status)
  const reached = STATUS_STEPS.indexOf(shipment.status)

  return (
    <article className={failed ? 'tracking-card tracking-problem' : 'tracking-card'}>
      <header className="tracking-head">
        <div>
          <b>{STATUS_COPY[shipment.status]?.label ?? shipment.status}</b>
          <small>{STATUS_COPY[shipment.status]?.detail}</small>
        </div>
        {shipment.carrier && <span className="tracking-carrier">{shipment.carrier.name}</span>}
      </header>

      {!failed && (
        <ol className="tracking-steps" aria-label="Delivery progress">
          {STATUS_STEPS.map((step, index) => (
            <li key={step} className={index <= reached ? 'done' : ''}>
              <span aria-hidden="true" />
              {STATUS_COPY[step].label}
            </li>
          ))}
        </ol>
      )}

      {shipment.failureReason && <p className="tracking-reason">{shipment.failureReason}</p>}

      <dl className="tracking-facts">
        {shipment.trackingNumber && (
          <>
            <dt>Tracking number</dt>
            <dd>
              {/* The courier's own page. `rel` set because this leaves Mirwal for a site we
                  do not control. */}
              {shipment.trackingUrl
                ? <a href={shipment.trackingUrl} target="_blank" rel="noreferrer noopener">{shipment.trackingNumber}</a>
                : shipment.trackingNumber}
            </dd>
          </>
        )}
        {shipment.estimatedDeliveryAt && !shipment.deliveredAt && (
          <>
            <dt>Expected by</dt>
            <dd>{new Date(`${shipment.estimatedDeliveryAt}Z`).toLocaleDateString()}</dd>
          </>
        )}
        {shipment.deliveredAt && (
          <>
            <dt>Delivered</dt>
            <dd>
              {new Date(`${shipment.deliveredAt}Z`).toLocaleDateString()}
              {shipment.receivedBy ? ` · received by ${shipment.receivedBy}` : ''}
            </dd>
          </>
        )}
        {Number(shipment.codAmount?.amount) > 0 && !shipment.codCollectedAt && (
          <>
            <dt>Pay on delivery</dt>
            {/* Stated plainly: a buyer who does not have the cash ready is a failed delivery. */}
            <dd><b>{shipment.codAmount.display}</b></dd>
          </>
        )}
        {shipment.attemptCount > 1 && (
          <>
            <dt>Delivery attempts</dt>
            <dd>{shipment.attemptCount}</dd>
          </>
        )}
      </dl>

      {shipment.items?.length > 1 && (
        <p className="tracking-items">
          {shipment.items.length} items in this parcel: {shipment.items.map((item) => item.productName).join(', ')}
        </p>
      )}

      {shipment.carrier?.phone && (
        <p className="tracking-contact">
          Courier: <a href={`tel:${shipment.carrier.phone}`}>{shipment.carrier.phone}</a>
        </p>
      )}
    </article>
  )
}
