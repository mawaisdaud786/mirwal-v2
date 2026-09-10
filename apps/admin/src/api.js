import { buildQuery, request, setAccessToken } from '@mirwal/shared/apiClient'

/**
 * The admin application's API surface.
 *
 * Deliberately narrow: it exposes the admin namespace plus the read-only catalogue endpoints
 * the panel legitimately reads. It does NOT re-export the storefront's cart/checkout/wishlist
 * surface — an admin build has no business carrying customer shopping calls.
 */
export const api = {
  auth: {
    login: async (payload) => {
      const data = await request('/admin/auth/login', { method: 'POST', body: payload, auth: false })
      setAccessToken(data.accessToken)
      return data
    },
    logout: async () => {
      try { await request('/admin/auth/logout', { method: 'POST', auth: false }) }
      finally { setAccessToken(null) }
    },
    session: () => request('/admin/auth/session'),
  },

  admin: {
    orders: {
      // Paged, searched and filtered server-side: the whole order table used to cross the wire
      // on every visit, and the panel filtered whatever had arrived.
      list: (params, signal) => request(`/admin/orders${buildQuery(params)}`, { signal }),
      counts: (signal) => request('/admin/orders/counts', { signal }),
      get: (id, signal) => request(`/admin/orders/${encodeURIComponent(id)}`, { signal }),
    },
    analytics: (params, signal) => request(`/admin/analytics${buildQuery(params)}`, { signal }),
    customers: (signal) => request('/admin/customers', { signal }),
    // One buyer: what they bought, what went wrong, and what they are owed. A support and risk
    // view — there is deliberately no endpoint here that edits somebody's profile.
    customer: (id, signal) => request(`/admin/customers/${encodeURIComponent(id)}`, { signal }),
    /**
     * Reviews.
     *
     * `list` is the plain read the customer pages use. The rest is moderation: verified
     * purchase is enforced in the database, so nothing here decides whether a review is
     * genuine — only whether it may stand. `hidden` keeps the rating and drops the text;
     * `removed` drops both, which is why they are separate actions rather than one delete.
     */
    reviews: {
      // Paged and filterable now. It used to return a hard LIMIT 200, so on a marketplace
      // with more reviews than that the rest were unreachable from the panel entirely.
      list: (params, signal) => request(`/admin/reviews${buildQuery(params)}`, { signal }),
      queue: (params, signal) => request(`/admin/reviews/queue${buildQuery(params)}`, { signal }),
      patterns: (signal) => request('/admin/reviews/patterns', { signal }),
      moderate: (id, body) => request(`/admin/reviews/${encodeURIComponent(id)}/moderate`, { method: 'PATCH', body, envelope: true }),
    },

    /**
     * Catalogue management — the admin-scoped product surface, distinct from the public
     * `products` reads below. This one returns every status (drafts, rejections, archived)
     * and admin-only fields such as cost price; the public one never will.
     */
    products: {
      list: (params, signal) => request(`/admin/products${buildQuery(params)}`, { signal }),
      statusCounts: (signal) => request('/admin/products/status-counts', { signal }),
      get: (id, signal) => request(`/admin/products/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/admin/products', { method: 'POST', body }),
      update: (id, body) => request(`/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      setStatus: (id, status) => request(`/admin/products/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
      // `approved: false` requires a reason — the API rejects it otherwise, so the UI must
      // collect one rather than sending a bare rejection.
      setApproval: (id, body) => request(`/admin/products/${encodeURIComponent(id)}/approval`, { method: 'PATCH', body, envelope: true }),
      remove: (id) => request(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    categories: {
      list: (signal) => request('/admin/categories', { signal }),
      create: (body) => request('/admin/categories', { method: 'POST', body }),
      update: (slug, body) => request(`/admin/categories/${encodeURIComponent(slug)}`, { method: 'PATCH', body }),
      remove: (slug) => request(`/admin/categories/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    },

    /**
     * Brand authorisation — who may list against a protected brand.
     *
     * Gating is per brand rather than marketplace-wide: most brands need nothing, and demanding
     * paperwork for all of them would stall the catalogue for no safety gain. `setGate` is the
     * switch that decides where the control applies; `decide` handles one seller's request.
     */
    brandAuth: {
      list: (params, signal) => request(`/admin/brand-authorizations${buildQuery(params)}`, { signal }),
      decide: (id, body) => request(`/admin/brand-authorizations/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
      setGate: (slug, body) => request(`/admin/brands/${encodeURIComponent(slug)}/gate`, { method: 'PATCH', body, envelope: true }),
    },

    brands: {
      list: (signal) => request('/admin/brands', { signal }),
      create: (body) => request('/admin/brands', { method: 'POST', body }),
      update: (slug, body) => request(`/admin/brands/${encodeURIComponent(slug)}`, { method: 'PATCH', body }),
      remove: (slug) => request(`/admin/brands/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    },

    inventory: {
      list: (params, signal) => request(`/admin/inventory${buildQuery(params)}`, { signal }),
      update: (variantId, body) => request(`/admin/inventory/${encodeURIComponent(variantId)}`, { method: 'PATCH', body }),
    },

    /**
   * Trust & safety cases.
   *
   * One resource for reports, complaints and disputes: they are the same object with different
   * subjects. Resolving a case says what Mirwal concluded; enforcement (see `sellers.enforce`)
   * is what it did about it, and the two are deliberately separate because one case can produce
   * several actions or none.
   */
  cases: {
    list: (params, signal) => request(`/admin/cases${buildQuery(params)}`, { signal }),
    stats: (signal) => request('/admin/cases/stats', { signal }),
    get: (id, signal) => request(`/admin/cases/${encodeURIComponent(id)}`, { signal }),
    assign: (id) => request(`/admin/cases/${encodeURIComponent(id)}/assign`, { method: 'POST', envelope: true }),
    message: (id, body) => request(`/admin/cases/${encodeURIComponent(id)}/messages`, { method: 'POST', body, envelope: true }),
    resolve: (id, body) => request(`/admin/cases/${encodeURIComponent(id)}/resolve`, { method: 'POST', body, envelope: true }),
  },

  /**
   * Seller applications.
   *
   * Separate from `sellers` because an application is a submission with a decision history and
   * a store is a trading entity: approval creates the store, so before that point there is no
   * store row to filter for. The old queue — `GET /sellers?status=pending` — could only ever
   * be empty in production, because nothing outside the seeder created a pending store.
   */
  applications: {
    list: (params, signal) => request(`/admin/applications${buildQuery(params)}`, { signal }),
    counts: (signal) => request('/admin/applications/counts', { signal }),
    get: (id, signal) => request(`/admin/applications/${encodeURIComponent(id)}`, { signal }),
    // Claiming stops two reviewers working the same case.
    claim: (id) => request(`/admin/applications/${encodeURIComponent(id)}/claim`, { method: 'POST', envelope: true }),
    requestInfo: (id, body) => request(`/admin/applications/${encodeURIComponent(id)}/request-info`, { method: 'POST', body, envelope: true }),
    approve: (id, body) => request(`/admin/applications/${encodeURIComponent(id)}/approve`, { method: 'POST', body, envelope: true }),
    reject: (id, body) => request(`/admin/applications/${encodeURIComponent(id)}/reject`, { method: 'POST', body, envelope: true }),
  },

  /**
   * Intervening in an order after it is placed.
   *
   * Each of these is its own permission rather than riding on `order.write`: support can cancel
   * and read the conversation, finance can refund, and neither inherits the other. `onBehalfOf`
   * decides whose record a cancellation lands on — an operator cancelling for a seller who
   * telephoned is still the seller's failure.
   */
  fulfilment: {
    cancelItem: (itemId, body) =>
      request(`/admin/order-items/${encodeURIComponent(itemId)}/cancel`, { method: 'PATCH', body, envelope: true }),
    refund: (orderId, body) =>
      request(`/admin/orders/${encodeURIComponent(orderId)}/refund`, { method: 'POST', body, envelope: true }),
    invoice: (orderId, signal) => request(`/admin/orders/${encodeURIComponent(orderId)}/invoice`, { signal }),
    thread: (orderId, sellerId, signal) =>
      request(`/admin/orders/${encodeURIComponent(orderId)}/messages/${encodeURIComponent(sellerId)}`, { signal }),
    reply: (orderId, sellerId, body) =>
      request(`/admin/orders/${encodeURIComponent(orderId)}/messages/${encodeURIComponent(sellerId)}`, { method: 'POST', body, envelope: true }),
  },

  /**
   * Disputed returns.
   *
   * Distinct from the read-only `disputes` view: this is the queue where Mirwal actually
   * decides, on its own permission, because overturning a seller's decision moves money away
   * from them and is not the same authority as being able to read an order.
   */
  /**
   * Every queue that needs a human, in one call.
   *
   * Filtered server-side by permission, so this returns only what the signed-in operator can
   * act on — work everybody can see is work nobody owns.
   */
  workQueue: (signal) => request('/admin/work-queue', { signal }),

  returnDisputes: {
    list: (params, signal) => request(`/admin/returns/disputes${buildQuery(params)}`, { signal }),
    get: (id, signal) => request(`/admin/returns/disputes/${encodeURIComponent(id)}`, { signal }),
    decide: (id, body) => request(`/admin/returns/disputes/${encodeURIComponent(id)}/decide`, { method: 'POST', body, envelope: true }),
    note: (id, body) => request(`/admin/returns/disputes/${encodeURIComponent(id)}/messages`, { method: 'POST', body, envelope: true }),
  },

  sellers: {
      list: (params, signal) => request(`/admin/sellers${buildQuery(params)}`, { signal }),
      statusCounts: (signal) => request('/admin/sellers/status-counts', { signal }),
      get: (id, signal) => request(`/admin/sellers/${encodeURIComponent(id)}`, { signal }),
      approve: (id) => request(`/admin/sellers/${encodeURIComponent(id)}/approve`, { method: 'POST', envelope: true }),
      reject: (id, reason) => request(`/admin/sellers/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason }, envelope: true }),
      suspend: (id, reason) => request(`/admin/sellers/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: { reason }, envelope: true }),
      reinstate: (id) => request(`/admin/sellers/${encodeURIComponent(id)}/reinstate`, { method: 'POST', envelope: true }),
      /**
       * Enforcement, kept separate from the approve/suspend lifecycle above.
       *
       * Suspending a store is a lifecycle state; a warning, a payout hold or a listing
       * restriction is a recorded action with its own expiry and its own appeal. One case can
       * produce several, or none.
       */
      enforce: (id, body) => request(`/admin/sellers/${encodeURIComponent(id)}/enforce`, { method: 'POST', body, envelope: true }),
      enforcementHistory: (id, signal) => request(`/admin/sellers/${encodeURIComponent(id)}/enforcement`, { signal }),
    },

    auditLogs: {
      list: (params, signal) => request(`/admin/audit-logs${buildQuery(params)}`, { signal }),
      filters: (signal) => request('/admin/audit-logs/filters', { signal }),
    },

    // --- Marketing ---------------------------------------------------------
    coupons: {
      list: (params, signal) => request(`/admin/coupons${buildQuery(params)}`, { signal }),
      stats: (signal) => request('/admin/coupons/stats', { signal }),
      get: (id, signal) => request(`/admin/coupons/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/admin/coupons', { method: 'POST', body, envelope: true }),
      update: (id, body) => request(`/admin/coupons/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id) => request(`/admin/coupons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    // Promotions, campaigns and flash sales are one endpoint; `kind` selects the surface.
    promotions: {
      list: (params, signal) => request(`/admin/promotions${buildQuery(params)}`, { signal }),
      get: (id, signal) => request(`/admin/promotions/${encodeURIComponent(id)}`, { signal }),
      create: (body) => request('/admin/promotions', { method: 'POST', body, envelope: true }),
      update: (id, body) => request(`/admin/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id) => request(`/admin/promotions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    banners: {
      list: (params, signal) => request(`/admin/banners${buildQuery(params)}`, { signal }),
      create: (body) => request('/admin/banners', { method: 'POST', body, envelope: true }),
      update: (id, body) => request(`/admin/banners/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id) => request(`/admin/banners/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    // --- Support queue -----------------------------------------------------
    tickets: {
      list: (params, signal) => request(`/admin/tickets${buildQuery(params)}`, { signal }),
      stats: (signal) => request('/admin/tickets/stats', { signal }),
      get: (id, signal) => request(`/admin/tickets/${encodeURIComponent(id)}`, { signal }),
      reply: (id, body) => request(`/admin/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body }),
      update: (id, body) => request(`/admin/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    },

    // --- Payouts -----------------------------------------------------------
    payouts: {
      list: (params, signal) => request(`/admin/payouts${buildQuery(params)}`, { signal }),
      stats: (signal) => request('/admin/payouts/stats', { signal }),
      get: (id, signal) => request(`/admin/payouts/${encodeURIComponent(id)}`, { signal }),
      // `paid` requires an externalReference and `rejected`/`failed` a failureReason — the
      // API refuses otherwise, so the UI must collect them.
      setStatus: (id, body) => request(`/admin/payouts/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
    },

    // --- Platform configuration --------------------------------------------
    settings: {
      list: (params, signal) => request(`/admin/settings${buildQuery(params)}`, { signal }),
      // Takes the whole changed set at once: a settings page is one form, and a partial save
      // is worse than a failed one.
      save: (updates) => request('/admin/settings', { method: 'PATCH', body: { updates }, envelope: true }),
    },

    integrations: {
      list: (signal) => request('/admin/integrations', { signal }),
      update: (provider, body) => request(`/admin/integrations/${encodeURIComponent(provider)}`, { method: 'PATCH', body }),
    },

    webhooks: {
      list: (signal) => request('/admin/webhooks', { signal }),
      // The response carries the signing secret exactly once — it is not recoverable later.
      create: (body) => request('/admin/webhooks', { method: 'POST', body, envelope: true }),
      update: (id, body) => request(`/admin/webhooks/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      rotateSecret: (id) => request(`/admin/webhooks/${encodeURIComponent(id)}/rotate-secret`, { method: 'POST' }),
      remove: (id) => request(`/admin/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },

    // --- Roles & access control --------------------------------------------
    roles: {
      list: (signal) => request('/admin/roles', { signal }),
      get: (slug, signal) => request(`/admin/roles/${encodeURIComponent(slug)}`, { signal }),
      permissions: (signal) => request('/admin/permissions', { signal }),
      matrix: (signal) => request('/admin/access-matrix', { signal }),
      // Sends the full desired permission set, not a delta — avoids two admins each toggling
      // one box and the second overwriting the first.
      setPermissions: (slug, permissions) =>
        request(`/admin/roles/${encodeURIComponent(slug)}/permissions`, { method: 'PUT', body: { permissions }, envelope: true }),
    },

    // --- Staff, sessions, accounts -----------------------------------------
    staff: (signal) => request('/admin/staff', { signal }),

    sessions: {
      list: (params, signal) => request(`/admin/sessions${buildQuery(params)}`, { signal }),
      revoke: (id) => request(`/admin/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
      revokeAllFor: (userId) => request(`/admin/accounts/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST', envelope: true }),
    },

    accounts: {
      list: (params, signal) => request(`/admin/accounts${buildQuery(params)}`, { signal }),
      // Suspending also signs the account out everywhere; the message says how many sessions.
      setStatus: (id, status) => request(`/admin/accounts/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status }, envelope: true }),
    },

    notifications: (params, signal) => request(`/admin/notifications${buildQuery(params)}`, { signal }),
    sellerPerformance: (signal) => request('/admin/seller-performance', { signal }),

    productReports: {
      list: (params, signal) => request(`/admin/product-reports${buildQuery(params)}`, { signal }),
      resolve: (id, body) => request(`/admin/product-reports/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
    },

    systemLogs: (params, signal) => request(`/admin/system-logs${buildQuery(params)}`, { signal }),

    teams: {
      list: (signal) => request('/admin/teams', { signal }),
      create: (body) => request('/admin/teams', { method: 'POST', body, envelope: true }),
      setMembership: (slug, body) => request(`/admin/teams/${encodeURIComponent(slug)}/members`, { method: 'POST', body, envelope: true }),
      remove: (slug) => request(`/admin/teams/${encodeURIComponent(slug)}`, { method: 'DELETE', envelope: true }),
    },

    /**
     * Email & SMS. Real sending through SMTP / an SMS gateway configured in the API
     * environment — credentials are never editable or readable from here.
     */
    messaging: {
      capabilities: (signal) => request('/admin/messaging/capabilities', { signal }),
      testConnection: () => request('/admin/messaging/test-connection', { method: 'POST', envelope: true }),
      templates: (params, signal) => request(`/admin/messaging/templates${buildQuery(params)}`, { signal }),
      updateTemplate: (channel, key, body) =>
        request(`/admin/messaging/templates/${encodeURIComponent(channel)}/${encodeURIComponent(key)}`, { method: 'PATCH', body, envelope: true }),
      deliveries: (params, signal) => request(`/admin/messaging/deliveries${buildQuery(params)}`, { signal }),
      sendTest: (body) => request('/admin/messaging/send-test', { method: 'POST', body, envelope: true }),
    },

    /**
     * Seller verification documents. `fileUrl` is not a static path: the bytes come only from
     * an authenticated request, so the UI links to the API route rather than to storage.
     */
    sellerDocuments: {
      list: (params, signal) => request(`/admin/seller-documents${buildQuery(params)}`, { signal }),
      review: (id, body) => request(`/admin/seller-documents/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
    },

    attributes: {
      list: (signal) => request('/admin/attributes', { signal }),
      create: (body) => request('/admin/attributes', { method: 'POST', body, envelope: true }),
      remove: (slug) => request(`/admin/attributes/${encodeURIComponent(slug)}`, { method: 'DELETE', envelope: true }),
    },

    /**
     * Analytics. One endpoint per page, each aggregating orders, payouts, refunds or search
     * telemetry that already exists — no endpoint here writes anything.
     */
    insights: {
      marketplace: (params, signal) => request(`/admin/insights/marketplace${buildQuery(params)}`, { signal }),
      sellers: (params, signal) => request(`/admin/insights/sellers${buildQuery(params)}`, { signal }),
      customers: (params, signal) => request(`/admin/insights/customers${buildQuery(params)}`, { signal }),
      finance: (params, signal) => request(`/admin/insights/finance${buildQuery(params)}`, { signal }),
      search: (params, signal) => request(`/admin/insights/search${buildQuery(params)}`, { signal }),
      recommendations: (signal) => request('/admin/insights/recommendations', { signal }),
      store: (id, signal) => request(`/admin/insights/stores/${encodeURIComponent(id)}`, { signal }),
    },

    // Returns and refunds. Read-only except for settling a refund that has to be paid by hand.
    returns: {
      list: (params, signal) => request(`/admin/returns${buildQuery(params)}`, { signal }),
      get: (id, signal) => request(`/admin/returns/${encodeURIComponent(id)}`, { signal }),
    },
    /**
     * Disputes: the platform-wide return queue, and one return in full.
     *
     * `list` and `get` live on the same key — two separate `disputes` entries in this object
     * meant the second silently replaced the first, taking the list endpoint with it.
     */
    disputes: {
      list: (signal) => request('/admin/disputes', { signal }),
      get: (id, signal) => request(`/admin/disputes/${encodeURIComponent(id)}`, { signal }),
    },
    refunds: {
      list: (params, signal) => request(`/admin/refunds${buildQuery(params)}`, { signal }),
      get: (id, signal) => request(`/admin/refunds/${encodeURIComponent(id)}`, { signal }),
      settle: (id, body) => request(`/admin/refunds/${encodeURIComponent(id)}/settle`, { method: 'PATCH', body, envelope: true }),
    },

    // Shipping zones, the methods inside them, and warehouses.
    shipping: {
      overview: (signal) => request('/admin/shipping', { signal }),
      createZone: (body) => request('/admin/shipping/zones', { method: 'POST', body, envelope: true }),
      updateZone: (id, body) => request(`/admin/shipping/zones/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
      deleteZone: (id) => request(`/admin/shipping/zones/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
      createMethod: (zoneId, body) => request(`/admin/shipping/zones/${encodeURIComponent(zoneId)}/methods`, { method: 'POST', body, envelope: true }),
      updateMethod: (id, body) => request(`/admin/shipping/methods/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
      deleteMethod: (id) => request(`/admin/shipping/methods/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
      createWarehouse: (body) => request('/admin/shipping/warehouses', { method: 'POST', body, envelope: true }),
      updateWarehouse: (id, body) => request(`/admin/shipping/warehouses/${encodeURIComponent(id)}`, { method: 'PATCH', body, envelope: true }),
      deleteWarehouse: (id) => request(`/admin/shipping/warehouses/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
    },

    /**
     * Maintenance mode and database exports.
     *
     * A backup file is never linked directly: the download goes through an authenticated
     * request, because the file is a complete copy of the marketplace.
     */
    platform: {
      status: (signal) => request('/admin/platform/status', { signal }),
      setMaintenance: (body) => request('/admin/platform/maintenance', { method: 'PATCH', body, envelope: true }),
      backups: (params, signal) => request(`/admin/platform/backups${buildQuery(params)}`, { signal }),
      runBackup: () => request('/admin/platform/backups', { method: 'POST', envelope: true }),
      deleteBackup: (id) => request(`/admin/platform/backups/${encodeURIComponent(id)}`, { method: 'DELETE', envelope: true }),
    },

    /**
     * Security. The two-factor calls act on the SIGNED-IN admin's own account and take no
     * user id — enrolling a second factor for somebody else is not a coherent operation.
     */
    security: {
      overview: (signal) => request('/admin/security', { signal }),
      setPolicy: (body) => request('/admin/security/policy', { method: 'PATCH', body, envelope: true }),
      twoFactor: (signal) => request('/admin/security/two-factor', { signal }),
      beginTwoFactor: () => request('/admin/security/two-factor/setup', { method: 'POST', envelope: true }),
      confirmTwoFactor: (code) => request('/admin/security/two-factor/confirm', { method: 'POST', body: { code }, envelope: true }),
      disableTwoFactor: (password) => request('/admin/security/two-factor/disable', { method: 'POST', body: { password }, envelope: true }),
      regenerateBackupCodes: (password) => request('/admin/security/two-factor/backup-codes', { method: 'POST', body: { password }, envelope: true }),
    },
  },

  // Sitewide catalogue reads. The same public endpoints the storefront uses, but only the
  // read paths an administrator actually needs to see what is on the marketplace.
  products: {
    list: (params, signal) => request(`/products${buildQuery(params)}`, { signal }),
    get: (slug, signal) => request(`/products/${encodeURIComponent(slug)}`, { signal }),
  },
  categories: { list: (signal) => request('/categories', { signal }) },
  brands: { list: (signal) => request('/brands', { signal }) },

  sellers: {
    list: (signal) => request('/sellers', { signal }),
    get: (slug, signal) => request(`/sellers/${encodeURIComponent(slug)}`, { signal }),
  },
}

export { ApiError, isApiConfigured } from '@mirwal/shared/apiClient'
export default api
