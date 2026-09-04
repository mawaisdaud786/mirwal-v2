/**
 * Low-level Mirwal API client.
 *
 * Two things here are deliberate departures from what the app did before:
 *
 * 1. The access token lives in a module variable, NOT in localStorage. The Phase 0 audit
 *    found `localStorage['mirwal-session']` holding a self-asserted role that route guards
 *    trusted — one console command granted Super Admin. Anything in localStorage is also
 *    readable by any XSS. The token now lives in memory only, and the long-lived refresh
 *    token is an httpOnly cookie the page cannot read at all.
 *
 * 2. Session is restored by asking the server, not by reading local state. On load the app
 *    calls its refresh endpoint; the cookie travels automatically and the server decides who
 *    you are. The client never decides its own identity.
 *
 * 3. The refresh endpoint is per-application, not global. The storefront, admin and seller
 *    apps each authenticate against their own namespace (`/auth`, `/admin/auth`,
 *    `/seller/auth`) whose refresh cookies are scoped to different paths — so a customer
 *    session can never be silently upgraded into an admin one by hitting a shared refresh
 *    route. Each app calls `configureAuth()` once at startup.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

/** Per-application auth namespace. Overridden by configureAuth() at app startup. */
let authBase = '/auth'

/**
 * @param {{ authBase: string }} options e.g. '/admin/auth' for the admin application.
 */
export function configureAuth({ authBase: base }) {
  authBase = base.replace(/\/$/, '')
}

/** Error carrying the server's stable machine-readable code. */
export class ApiError extends Error {
  constructor(code, message, status, details, requestId) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
    this.requestId = requestId
  }
}

export const isApiConfigured = () => Boolean(BASE_URL)

let accessToken = null
let refreshPromise = null
const listeners = new Set()

export function setAccessToken(token) {
  accessToken = token
  for (const listener of listeners) listener(token)
}
export const getAccessToken = () => accessToken
export function onAuthChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function parse(response) {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

async function raw(path, { method = 'GET', body, signal, headers = {}, auth = true, envelope = false } = {}) {
  if (!BASE_URL) {
    throw new ApiError('API_NOT_CONFIGURED', 'The Mirwal API is not configured.', 0)
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    signal,
    // Sends and receives the httpOnly refresh cookie.
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const payload = await parse(response)

  if (!response.ok || payload?.success === false) {
    const error = payload?.error ?? {}
    throw new ApiError(
      error.code ?? 'REQUEST_FAILED',
      error.message ?? `Request failed (${response.status})`,
      response.status,
      error.details,
      payload?.requestId,
    )
  }

  // Callers normally want just the payload. `envelope: true` returns `{ data, message }`
  // instead, for the writes whose server message carries information the UI cannot derive —
  // "this listing has gone back for review", "95 products were delisted", "copy this secret
  // now". Those sentences are written once, on the server, next to the logic that makes them
  // true; re-deriving them in each app would let them drift out of step with the behaviour.
  if (envelope) return { data: payload?.data ?? null, message: payload?.message ?? null }
  return payload?.data ?? null
}

/** Refresh once even if several requests fail concurrently. */
function refreshAccessToken() {
  refreshPromise ??= raw(`${authBase}/refresh`, { method: 'POST', auth: false })
    .then((data) => { setAccessToken(data.accessToken); return data })
    .catch((error) => { setAccessToken(null); throw error })
    .finally(() => { refreshPromise = null })
  return refreshPromise
}

/**
 * Perform a request, transparently refreshing once on an expired access token.
 * A failed refresh clears the session rather than retrying forever.
 */
export async function request(path, options = {}) {
  try {
    return await raw(path, options)
  } catch (error) {
    const expired = error instanceof ApiError
      && (error.code === 'TOKEN_EXPIRED' || (error.status === 401 && accessToken))
    if (!expired || options._retried) throw error

    try { await refreshAccessToken() } catch { throw error }
    return raw(path, { ...options, _retried: true })
  }
}

/** Restore a session from the refresh cookie. Returns the user, or null if signed out. */
export async function restoreSession() {
  try {
    const data = await refreshAccessToken()
    return data.user ?? null
  } catch {
    return null
  }
}

export const buildQuery = (params = {}) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
