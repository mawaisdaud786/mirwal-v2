import { buildQuery, request, setAccessToken } from '@mirwal/shared/apiClient'

/**
 * Mirwal API surface.
 *
 * The customer storefront's API surface. Maps onto the endpoints implemented in server/ —
 * see docs/API.md. Endpoints that are not built yet are deliberately absent rather than
 * stubbed, so a caller gets a compile-time-obvious mistake instead of a silent fake response.
 *
 * Deliberately excludes the `/admin/*` and `/seller/me/*` namespaces: those belong to the
 * admin and seller applications, which ship their own narrow API surfaces. A shopper's
 * bundle should not even contain the strings for endpoints it may never call.
 */

export const api = {
  auth: {
    // Both responses include a fresh accessToken (the httpOnly refresh cookie is set
    // separately by the server). Without storing it here, the very next authenticated
    // request would have no token, fail with 401, and only succeed via the retry-on-expiry
    // path in apiClient's request() — a guaranteed wasted round trip after every login.
    register: async (payload) => {
      const data = await request('/auth/register', { method: 'POST', body: payload, auth: false })
      setAccessToken(data.accessToken)
      return data
    },
    login: async (payload) => {
      const data = await request('/auth/login', { method: 'POST', body: payload, auth: false })
      setAccessToken(data.accessToken)
      return data
    },
    logout: async () => {
      try { await request('/auth/logout', { method: 'POST', auth: false }) }
      finally { setAccessToken(null) }
    },
    me: () => request('/auth/me'),
    /** Update the signed-in shopper's own name/phone. Email and roles are not editable. */
    updateMe: (payload) => request('/auth/me', { method: 'PATCH', body: payload }),

    /**
     * Password reset. Both are unauthenticated by definition — the whole point is that the
     * caller cannot sign in.
     *
     * `forgotPassword` replies the same way whether or not the address has an account, so the
     * UI must not treat a success as confirmation that the account exists.
     */
    forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false, envelope: true }),
    resetPassword: (payload) => request('/auth/reset-password', { method: 'POST', body: payload, auth: false, envelope: true }),

    /**
     * Account security. Every call here acts on the caller's own account and takes no user
     * id — the server reads the account from the access token, so there is no id to tamper
     * with and nothing to confuse one shopper's session for another's.
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

  /**
   * Delivery options and cost for one address. Public — a shopper has to see a delivery price
   * before signing in.
   */
  shipping: {
    quote: (params, signal) => request(`/shipping/quote${buildQuery(params)}`, { signal, auth: false }),
  },

  products: {
    /**
     * @param {object} params q, category[], brand[], seller, minPrice, maxPrice, rating,
     *                        availability, sort, page, pageSize
     * @returns {Promise<{items: object[], pagination: object}>}
     */
    list: (params, signal) => request(`/products${buildQuery(params)}`, { signal }),
    get: (slug, signal) => request(`/products/${encodeURIComponent(slug)}`, { signal }),
    facets: (signal) => request('/products/facets', { signal }),
  },

  categories: {
    list: (signal) => request('/categories', { signal }),
    get: (slug, signal) => request(`/categories/${encodeURIComponent(slug)}`, { signal }),
  },

  brands: {
    list: (signal) => request('/brands', { signal }),
  },

  sellers: {
    list: (signal) => request('/sellers', { signal }),
    get: (slug, signal) => request(`/sellers/${encodeURIComponent(slug)}`, { signal }),
  },


  orders: {
    create: (payload) => request('/orders', { method: 'POST', body: payload }),
    list: (signal) => request('/orders', { signal }),
    get: (id, signal) => request(`/orders/${encodeURIComponent(id)}`, { signal }),
    cancelItem: (itemId) => request(`/orders/items/${encodeURIComponent(itemId)}/cancel`, { method: 'PATCH' }),
    requestReturn: (itemId, payload) => request(`/orders/items/${encodeURIComponent(itemId)}/return-request`, { method: 'POST', body: payload }),
  },

  ai: {
    /**
     * Grounded shopping assistant. Returns only real catalogue products — see
     * server/src/modules/ai/ai.service.js.
     * @returns {Promise<{reply: string, question: string|null, products: object[], understood: object, relaxed: string[]}>}
     */
    ask: (message, signal) => request('/ai/ask', { method: 'POST', body: { message }, signal }),
  },

  reviews: {
    /** Public: a product's real, purchase-backed reviews plus its rating breakdown. */
    forProduct: (slug, signal) => request(`/reviews/product/${encodeURIComponent(slug)}`, { signal, auth: false }),
    /** Delivered items the signed-in buyer has not reviewed yet. */
    pending: (signal) => request('/reviews/mine/pending', { signal }),
    create: (payload) => request('/reviews', { method: 'POST', body: payload }),
  },

  wishlist: {
    /** The signed-in shopper's own wishlist. Server-scoped to their token — see
     * server/src/modules/wishlist. Returns `{items, count}`. */
    list: (signal) => request('/wishlist', { signal }),
    add: (slug) => request('/wishlist', { method: 'POST', body: { slug } }),
    remove: (slug) => request(`/wishlist/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  },


  /**
   * Support threads. The same threads Mirwal staff answer from the admin panel — a question
   * asked here reaches a person, rather than being acknowledged and dropped.
   */
  support: {
    list: (params, signal) => request(`/support/tickets${buildQuery(params)}`, { signal }),
    get: (id, signal) => request(`/support/tickets/${encodeURIComponent(id)}`, { signal }),
    create: (body) => request('/support/tickets', { method: 'POST', body, envelope: true }),
  },

  payments: {
    // Which methods are actually configured server-side. The checkout UI offers only these,
    // so an unconfigured gateway is never presented as if it worked.
    methods: (signal) => request('/payments/methods', { signal }),
    start: (orderId, method) => request(`/payments/orders/${encodeURIComponent(orderId)}/start`, { method: 'POST', body: { method } }),
    status: (orderId, signal) => request(`/payments/orders/${encodeURIComponent(orderId)}/status`, { signal }),
  },

  notifications: {
    list: (signal) => request('/notifications', { signal }),
    markRead: (id) => request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
    markAllRead: () => request('/notifications/read-all', { method: 'PATCH' }),
  },

  addresses: {
    list: (signal) => request('/addresses', { signal }),
    create: (payload) => request('/addresses', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/addresses/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
    remove: (id) => request(`/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
}

export { ApiError, isApiConfigured, restoreSession, onAuthChange } from '@mirwal/shared/apiClient'
export default api
