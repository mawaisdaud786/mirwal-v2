/**
 * How a return's states and reasons are worded in the seller panel.
 *
 * In their own file because two screens use them and a component module that also exports
 * constants breaks fast refresh — the lint rule that says so is right, and the shared copy is
 * the point anyway: a status wording that differs between the list and the detail is a bug
 * report waiting to happen.
 *
 * The wire values are codes rather than sentences. A code can be counted — which is what makes
 * "what share of this store's returns are its own fault" answerable — and `not_as_described`
 * printed in a table is a database column leaking onto a page someone has to read.
 */

export const STATUS_CLASS = {
  requested: 'pending', more_info_required: 'pending', approved: 'approved', in_transit: 'approved',
  received: 'approved', refunded: 'approved', replaced: 'approved', rejected: 'rejected',
  cancelled: 'rejected', escalated: 'escalated',
}

/** Where it is somebody's turn, the label says whose. */
export const STATUS_LABEL = {
  requested: 'Needs your decision', more_info_required: 'Waiting on buyer', approved: 'Approved',
  in_transit: 'On its way back', received: 'With you', refunded: 'Refunded', replaced: 'Replaced',
  rejected: 'Declined', cancelled: 'Withdrawn', escalated: 'With Mirwal',
}

export const REASON_LABEL = {
  damaged: 'Arrived damaged', faulty: 'Faulty', wrong_item: 'Wrong item',
  not_as_described: 'Not as described', counterfeit: 'Says not genuine', missing_parts: 'Parts missing',
  changed_mind: 'Changed their mind', size_or_fit: 'Size or fit', found_cheaper: 'Found it cheaper',
  arrived_late: 'Arrived too late', other: 'Something else',
}

/**
 * What the seller may do next, mirroring the transition table in `returns.service.js`.
 *
 * Mirrored, not owned: the API refuses anything illegal regardless of what this offers, so a
 * mistake here is a missing button rather than an unguarded action.
 */
export const NEXT_MOVES = {
  requested: [['approved', 'Approve'], ['more_info_required', 'Ask for more'], ['rejected', 'Decline']],
  more_info_required: [['approved', 'Approve'], ['rejected', 'Decline']],
  approved: [['received', 'Mark received'], ['refunded', 'Refund'], ['replaced', 'Replacement sent']],
  in_transit: [['received', 'Mark received'], ['refunded', 'Refund'], ['replaced', 'Replacement sent']],
  received: [['refunded', 'Refund'], ['replaced', 'Replacement sent'], ['rejected', 'Decline']],
}

/** The moves the API insists carry an explanation, because the buyer is shown it. */
export const NEEDS_NOTE = new Set(['rejected', 'more_info_required'])
