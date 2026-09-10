import { buildQuery, request, setAccessToken } from '@mirwal/shared/apiClient'

/**
 * The seller application's API surface.
 *
 * Every `/seller/me/*` endpoint is scoped server-side to the authenticated seller — there is
 * deliberately no route anywhere that takes a seller id as a parameter, so "read another
 * seller's orders" is not a request this client could make even if it tried. No admin
 * endpoints and no customer cart/checkout endpoints are exposed here.
 */
export const api = {
  auth: {
    login: async (payload) => {
      const data = await request('/seller/auth/login', { method: 'POST', body: payload, auth: false })
      setAccessToken(data.accessToken)
      return data
    },
    logout: async () => {
      try { await request('/seller/auth/logout', { method: 'POST', auth: false }) }
      finally { setAccessToken(null) }
    },
    session: () => request('/seller/auth/session'),

    /**
     * Account security, on the shared `/auth/me/*` routes.
     *
     * These are not seller-specific: they act on whichever account the access token belongs
     * to, and a seller's token is as valid there as a shopper's. A seller account controls a
     * storefront and a payout balance, so it has more to protect, not less.
     */
    changePassword: (payload) => request('/auth/me/password', { method: 'PATCH', body: payload, envelope: true }),
    sessions: (signal) => request('/auth/me/sessions', { signal }),
    revokeSession: (id) => request(`/auth/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
    twoFactor: (signal) => request('/auth/me/two-factor', { signal }),
    /**
     * Confirming the email and phone on the account.
     *
     * Shares the customer endpoints deliberately — a seller is a user with a store, and the
     * columns being written (`users.email_verified_at`, `phone_verified_at`) are the same ones
     * the seller-application gate checks.
     */
    verification: {
      status: (signal) => request('/auth/me/verification', { signal }),
      request: (purpose) => request('/auth/me/verification/request', { method: 'POST', body: { purpose }, envelope: true }),
      confirm: (purpose, code) => request('/auth/me/verification/confirm', { method: 'POST', body: { purpose, code }, envelope: true }),
    },
    beginTwoFactor: () => request('/auth/me/two-factor/setup', { method: 'POST', envelope: true }),
    confirmTwoFactor: (code) => request('/auth/me/two-factor/confirm', { method: 'POST', body: { code }, envelope: true }),
    disableTwoFactor: (password) => request('/auth/me/two-factor/disable', { method: 'POST', body: { password }, envelope: true }),
    regenerateBackupCodes: (password) => request('/auth/me/two-factor/backup-codes', { method: 'POST', body: { password }, envelope: true }),
  },

  seller: {
    store: (signal) => request('/seller/me/store', { signal }),
    /**
     * Editing the store.
     *
     * `GET /seller/me/store` returned three fields and there was no PATCH at all, so the eight
     * store-profile screens in this panel could display nothing and save nothing.
     *
     * A partial patch: only the keys sent are touched, so one section's form cannot blank out
     * another's fields.
     */
    updateStore: (patch) => request('/seller/me/store', { method: 'PATCH', body: patch, envelope: true }),
    setVacation: (body) => request('/seller/me/store/vacation', { method: 'PATCH', body, envelope: true }),

    bankAccounts: {
      list: (signal) => request('/seller/me/bank-accounts', { signal }),
      // Adding a second account archives the first and holds payouts while Mirwal verifies it —
      // a changed payout destination is the primary account-takeover cash-out path.
      add: (body) => request('/seller/me/bank-accounts', { method: 'POST', body, envelope: true }),
    },
    /**
     * Identity details.
     *
     * Distinct from the store profile: presentation is the seller's to change freely, identity
     * is not. A blank field may be filled in; changing one that has already been verified
     * costs the verification it was carrying, and the response says so.
     */
    kyc: {
      get: (signal) => request('/seller/me/kyc', { signal }),
      update: (body) => request('/seller/me/kyc', { method: 'PATCH', body, envelope: true }),
    },

    policies: {
      get: (signal) => request('/seller/me/policies', { signal }),
      update: (body) => request('/seller/me/policies', { method: 'PATCH', body, envelope: true }),
    },
    payoutEligibility: (signal) => request('/seller/me/payout-eligibility', { signal }),

    media: {
      list: (params, signal) => request(`/seller/me/media${buildQuery(params)}`, { signal }),
      /**
       * Multipart, so no JSON content-type: the browser must set its own boundary. `upload`
       * bypasses the JSON body helper for that reason.
       */
      upload: (file, purpose) => {
        const form = new FormData()
        form.append('file', file)
        return request(`/seller/me/media?purpose=${encodeURIComponent(purpose)}`, { method: 'POST', body: form, envelope: true })
      },
      remove: (id) => request(`/seller/me/media/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
    },
    setProductImages: (productId, images) =>
      request(`/seller/me/products/${encodeURIComponent(productId)}/images`, { method: 'PUT', body: { images }, envelope: true }),
    /**
     * The store's own listings, paged and filtered by the server. This used to return every
     * listing the store had ever created, which a seller with two thousand SKUs downloaded in
     * full to look at ten of them.
     */
    products: (params, signal) => request(`/seller/me/products${buildQuery(params)}`, { signal }),
    productStatusCounts: (signal) => request('/seller/me/products/status-counts', { signal }),

    /**
     * Product management.
     *
     * `create` and `update` land the listing in `pending_review`, never `active` — Mirwal
     * publishes, the seller submits. Editing a live listing returns it to review, and the
     * response message says so.
     */
    product: {
      // Categories, brands and conditions for the add/edit form.
      options: (signal) => request('/seller/me/products/options', { signal }),
      get: (id, signal) => request(`/seller/me/products/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/seller/me/products', { method: 'POST', body, envelope: true }),
      update: (id, body) => request(`/seller/me/products/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
      setStatus: (id, status) => request(`/seller/me/products/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
      remove: (id) => request(`/seller/me/products/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
    inventory: {
      update: (variantId, body) => request(`/seller/me/inventory/${encodeURIComponent(variantId)}`, { method: 'PATCH', body }),
    },

    /**
     * The lines this store has to fulfil, paged and filtered by the server. It used to return
     * every line the store had ever sold, so working today's dispatches meant downloading
     * years of history.
     */
    orders: (params, signal) => request(`/seller/me/orders${buildQuery(params)}`, { signal }),
    orderCounts: (signal) => request('/seller/me/orders/counts', { signal }),

    /**
     * Shipments.
     *
     * "Shipped" is no longer a status a seller can assert — the API refuses it — because it is
     * what a shipment *means*: a carrier, a tracking number and a dispatch time. Creating one
     * is what moves the item, so the two can never disagree.
     */
    carriers: (signal) => request('/seller/me/carriers', { signal }),
    shipments: {
      list: (params, signal) => request(`/seller/me/shipments${buildQuery(params)}`, { signal }),
      create: (body) => request('/seller/me/shipments', { method: 'POST', body, envelope: true }),
      update: (id, body) => request(`/seller/me/shipments/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
    },
    updateOrderItemStatus: (id, status) =>
      request(`/seller/me/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
    /**
     * Returns.
     *
     * `advance` replaced a two-outcome approve/reject. A seller can now ask the buyer for a
     * photograph, acknowledge that the parcel arrived, refund part of a line, or send a
     * replacement — each of which previously had to be misrepresented as one of the two.
     *
     * Which moves are legal from a given state is decided server-side, so this client cannot
     * offer one the API would refuse.
     */
    /**
     * Cancelling what the store cannot supply, and answering the buyer.
     *
     * Neither existed. An item with no stock behind it sat in `processing` until a human
     * noticed, and a buyer's question could only ever reach Mirwal. A reason is required on a
     * cancellation because the buyer is shown it.
     */
    cancelItem: (itemId, body) =>
      request(`/seller/me/orders/${encodeURIComponent(itemId)}/cancel`, { method: 'PATCH', body, envelope: true }),
    orderMessages: {
      list: (params, signal) => request(`/seller/me/order-messages${buildQuery(params)}`, { signal }),
      unread: (signal) => request('/seller/me/order-messages/unread', { signal }),
      thread: (orderId, signal) => request(`/seller/me/orders/${encodeURIComponent(orderId)}/messages`, { signal }),
      send: (orderId, body) =>
        request(`/seller/me/orders/${encodeURIComponent(orderId)}/messages`, { method: 'POST', body: { body }, envelope: true }),
    },

    returns: (params, signal) => request(`/seller/me/returns${buildQuery(params)}`, { signal }),
    returnDetail: (id, signal) => request(`/seller/me/returns/${encodeURIComponent(id)}`, { signal }),
    advanceReturn: (id, payload) => request(`/seller/me/returns/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: payload, envelope: true }),
    replyToReturn: (id, body) => request(`/seller/me/returns/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body }, envelope: true }),
    refunds: (signal) => request('/seller/me/refunds', { signal }),
    settleRefund: (id) => request(`/seller/me/refunds/${encodeURIComponent(id)}/settle`, { method: 'PATCH' }),
    finance: (params, signal) => request(`/seller/me/finance${buildQuery(params)}`, { signal }),
    customers: (params, signal) => request(`/seller/me/customers${buildQuery(params)}`, { signal }),
    reviews: (params, signal) => request(`/seller/me/reviews${buildQuery(params)}`, { signal }),

    /**
     * Marketing. Scoped server-side to this store: a seller sees and edits only their own
     * coupons and promotions, and Mirwal-wide ones are not listed here at all.
     */
    coupons: {
      list: (params, signal) => request(`/seller/me/coupons${buildQuery(params)}`, { signal }),
      stats: (signal) => request('/seller/me/coupons/stats', { signal }),
      get: (id, signal) => request(`/seller/me/coupons/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/seller/me/coupons', { method: 'POST', body }),
      update: (id, body) => request(`/seller/me/coupons/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id) => request(`/seller/me/coupons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
    promotions: {
      list: (params, signal) => request(`/seller/me/promotions${buildQuery(params)}`, { signal }),
      get: (id, signal) => request(`/seller/me/promotions/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/seller/me/promotions', { method: 'POST', body }),
      update: (id, body) => request(`/seller/me/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id) => request(`/seller/me/promotions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    /**
     * What the store's marketing sold. Coupon figures are attribution — a redemption records
     * the order it discounted; promotion figures are what sold while the promotion ran, and
     * the page labels them as that rather than as cause.
     */
    marketing: {
      performance: (signal) => request('/seller/me/marketing/performance', { signal }),
    },

    /** Support. These threads are the same ones Mirwal staff answer from the admin panel. */
    tickets: {
      list: (params, signal) => request(`/seller/me/tickets${buildQuery(params)}`, { signal }),
      stats: (signal) => request('/seller/me/tickets/stats', { signal }),
      get: (id, signal) => request(`/seller/me/tickets/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/seller/me/tickets', { method: 'POST', body, envelope: true }),
      reply: (id, body) => request(`/seller/me/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body }),
      close: (id) => request(`/seller/me/tickets/${encodeURIComponent(id)}/close`, { method: 'POST' }),
    },

    /**
     * Earnings and withdrawals. `balance` is what is actually payable right now — delivered
     * order items not already claimed by another payout. Approving and paying are admin
     * actions and are not exposed here.
     */
    /**
     * Verification documents. Upload is a raw multipart POST from the page — the shared
     * client serialises bodies as JSON, which would corrupt the file — so only the read and
     * delete paths go through here.
     */
    documents: {
      list: (signal) => request('/seller/me/documents', { signal }),
      remove: (id) => request(`/seller/me/documents/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
    },

    /**
     * Protected brands.
     *
     * Only brands Mirwal has gated appear here — most brands need nothing. A pending request
     * does not let a seller list yet, and the page says so rather than letting them find out
     * when the listing is refused.
     */
    brandAuth: {
      list: (signal) => request('/seller/me/brand-authorizations', { signal }),
      request: (body) => request('/seller/me/brand-authorizations', { method: 'POST', body, envelope: true }),
    },

    /** How Mirwal rates this store, and why. The risk score is never part of this response. */
    trust: (signal) => request('/seller/me/trust', { signal }),
    compliance: (signal) => request('/seller/me/compliance', { signal }),
    // One appeal per action, while it is still in force. The API rejects a second.
    appeal: (id, note) =>
      request(`/seller/me/compliance/${encodeURIComponent(id)}/appeal`, { method: 'POST', body: { note }, envelope: true }),

    balance: (signal) => request('/seller/me/balance', { signal }),
    payouts: {
      list: (params, signal) => request(`/seller/me/payouts${buildQuery(params)}`, { signal }),
      get: (id, signal) => request(`/seller/me/payouts/${encodeURIComponent(id)}`, { signal }),
      request: (body) => request('/seller/me/payouts', { method: 'POST', body, envelope: true }),
    },
  },

  notifications: {
    list: (signal) => request('/notifications', { signal }),
    /**
     * The same account-level preferences the storefront exposes, on the same endpoint. A
     * seller is a user with a store, and these live on `users` — a store-scoped copy would be
     * a second answer to one question.
     */
    preferences: (signal) => request('/notifications/preferences', { signal }),
    setPreferences: (body) => request('/notifications/preferences', { method: 'PUT', body, envelope: true }),
    markRead: (id) => request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
    markAllRead: () => request('/notifications/read-all', { method: 'PATCH' }),
  },

  // Catalogue reads the portal legitimately needs (category/brand pickers, product lookups).
  products: {
    list: (params, signal) => request(`/products${buildQuery(params)}`, { signal }),
    get: (slug, signal) => request(`/products/${encodeURIComponent(slug)}`, { signal }),
  },
  /**
   * The marketplace's published delivery rates. Read-only for a seller: Mirwal sets these
   * once for everyone so a mixed basket carries one delivery charge, not one per store.
   */
  shipping: { zones: (signal) => request('/shipping/zones', { signal }) },

  categories: { list: (signal) => request('/categories', { signal }) },
  brands: { list: (signal) => request('/brands', { signal }) },
}

export { ApiError, isApiConfigured } from '@mirwal/shared/apiClient'
export default api
