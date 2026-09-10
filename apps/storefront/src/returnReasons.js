/**
 * The reasons a buyer can give for a return.
 *
 * Codes, not sentences. They used to be free text the API stored in a `VARCHAR(100)`, which
 * made them useless for the two things a reason is actually for: deciding who pays return
 * carriage — a fault is the seller's, a change of mind is the buyer's — and measuring whether
 * a store's returns are its own doing. A sentence cannot be counted, and "Item damaged or
 * defective" and "damaged" are the same claim written two ways.
 *
 * Kept in one place because three screens offer them and a fourth reads them back; the server
 * holds the authoritative list in `returns.controller.js` and rejects anything not on it.
 */

/** Ordered for the picker: faults first, because that is what most returns actually are. */
export const RETURN_REASONS = [
  ['damaged', 'Arrived damaged'],
  ['faulty', 'Faulty or stopped working'],
  ['wrong_item', 'Not what I ordered'],
  ['not_as_described', 'Does not match the listing'],
  ['counterfeit', 'Not genuine'],
  ['missing_parts', 'Parts missing'],
  ['size_or_fit', 'Wrong size or fit'],
  ['changed_mind', 'Changed my mind'],
  ['found_cheaper', 'Found it cheaper'],
  ['arrived_late', 'Arrived too late'],
  ['other', 'Something else'],
]

export const REASON_LABEL = Object.fromEntries(RETURN_REASONS)

/** Every state a return can be in, in the buyer's words. */
export const RETURN_STATUS_LABEL = {
  requested: 'Return requested',
  more_info_required: 'Seller needs more',
  approved: 'Return approved',
  in_transit: 'On its way back',
  received: 'Seller has it',
  refunded: 'Refunded',
  replaced: 'Replaced',
  rejected: 'Return declined',
  cancelled: 'Return withdrawn',
  escalated: 'With Mirwal',
}
