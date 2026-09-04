import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isApiConfigured } from './apiClient'

/**
 * Data fetching for API-backed pages.
 *
 * Deliberately does NOT fall back to the mock data in src/data when a request fails.
 * Showing seed data as though it were live is exactly the class of problem the Phase 0
 * audit catalogued — the page reports the failure honestly instead.
 *
 * Loading is *derived* by comparing the key of the request we want against the key of the
 * result we have, rather than by calling setState synchronously inside the effect. That
 * keeps the effect free of cascading renders.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetcher
 * @param {Array} deps  re-fetch when these change
 * @param {{ enabled?: boolean }} [options]
 */
export function useApiQuery(fetcher, deps = [], { enabled = true } = {}) {
  const [reloadCount, setReloadCount] = useState(0)
  const key = `${reloadCount}:${JSON.stringify(deps)}`

  const [result, setResult] = useState({ key: null, data: null, error: null })

  // Latest-fetcher ref, updated after render so the effect below can stay keyed on `deps`
  // rather than on an inline arrow that changes identity every render.
  const fetcherRef = useRef(fetcher)
  useEffect(() => { fetcherRef.current = fetcher })

  useEffect(() => {
    if (!enabled) return undefined

    const controller = new AbortController()
    let active = true

    fetcherRef.current(controller.signal)
      .then((data) => { if (active) setResult({ key, data, error: null }) })
      .catch((error) => {
        // An aborted request is a navigation, not a failure worth showing.
        if (!active || error?.name === 'AbortError') return
        setResult({ key, data: null, error })
      })

    return () => { active = false; controller.abort() }
  }, [key, enabled])

  const refetch = useCallback(() => setReloadCount((count) => count + 1), [])

  const settled = result.key === key
  const error = settled ? result.error : null

  return {
    data: settled ? result.data : null,
    error,
    isLoading: enabled && !settled,
    isError: Boolean(error),
    // Distinguishes "the API is not set up" from "the request failed", because the fix
    // for each is completely different.
    notConfigured: error instanceof ApiError && error.code === 'API_NOT_CONFIGURED',
    isApiConfigured: isApiConfigured(),
    refetch,
  }
}

/** Human-readable message for an API failure, without leaking anything internal. */
export function describeApiError(error) {
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.code === 'API_NOT_CONFIGURED') {
      return 'The Mirwal API is not configured for this environment.'
    }
    if (error.status === 0 || error.code === 'REQUEST_FAILED') {
      return 'We could not reach Mirwal. Check your connection and try again.'
    }
    return error.message
  }
  if (error?.message === 'Failed to fetch') {
    return 'We could not reach Mirwal. The service may be temporarily unavailable.'
  }
  return 'Something went wrong loading this page.'
}
