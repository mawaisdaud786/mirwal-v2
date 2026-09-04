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
    beginTwoFactor: () => request('/auth/me/two-factor/setup', { method: 'POST', envelope: true }),
    confirmTwoFactor: (code) => request('/auth/me/two-factor/confirm', { method: 'POST', body: { code }, envelope: true }),
    disableTwoFactor: (password) => request('/auth/me/two-factor/disable', { method: 'POST', body: { password }, envelope: true }),
    regenerateBackupCodes: (password) => request('/auth/me/two-factor/backup-codes', { method: 'POST', body: { password }, envelope: true }),
  },

  seller: {
    store: (signal) => request('/seller/me/store', { signal }),
    products: (signal) => request('/seller/me/products', { signal }),

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

    orders: (signal) => request('/seller/me/orders', { signal }),
    updateOrderItemStatus: (id, status) =>
      request(`/seller/me/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
    returns: (signal) => request('/seller/me/returns', { signal }),
    resolveReturn: (id, payload) => request(`/seller/me/returns/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: payload }),
    refunds: (signal) => request('/seller/me/refunds', { signal }),
    settleRefund: (id) => request(`/seller/me/refunds/${encodeURIComponent(id)}/settle`, { method: 'PATCH' }),
    finance: (params, signal) => request(`/seller/me/finance${buildQuery(params)}`, { signal }),
    customers: (signal) => request('/seller/me/customers', { signal }),
    reviews: (signal) => request('/seller/me/reviews', { signal }),

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

    balance: (signal) => request('/seller/me/balance', { signal }),
    payouts: {
      list: (params, signal) => request(`/seller/me/payouts${buildQuery(params)}`, { signal }),
      get: (id, signal) => request(`/seller/me/payouts/${encodeURIComponent(id)}`, { signal }),
      request: (body) => request('/seller/me/payouts', { method: 'POST', body, envelope: true }),
    },
  },

  notifications: {
    list: (signal) => request('/notifications', { signal }),
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
