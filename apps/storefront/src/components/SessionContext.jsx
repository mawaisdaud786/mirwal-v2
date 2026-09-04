import { createContext, useCallback, useEffect, useState } from 'react'
import api, { onAuthChange, restoreSession } from '../api'

/**
 * The real, server-verified signed-in user — see PROJECT_AUDIT.md S21 ("frontend route guards
 * trust localStorage, not the server"). Route guards and the header used to read a
 * self-asserted `{role}` blob out of localStorage, which nothing ever wrote to legitimately
 * but anything could write to illegitimately. This is what replaces it: `user` is only ever
 * set from a server response (`/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/me`),
 * never from client-supplied state.
 *
 * On mount, `restoreSession()` asks the server who the visitor is via the httpOnly refresh
 * cookie — the page never reads or writes that cookie directly, so nothing client-side can
 * forge it. `isLoading` covers that round trip so a route guard doesn't flash "signed out"
 * before the real answer comes back.
 */
const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    restoreSession().then((restoredUser) => {
      if (active) { setUser(restoredUser); setIsLoading(false) }
    })
    return () => { active = false }
  }, [])

  useEffect(() => onAuthChange((token) => { if (!token) setUser(null) }), [])

  const login = useCallback(async (credentials) => {
    const data = await api.auth.login(credentials)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (payload) => {
    const data = await api.auth.register(payload)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await api.auth.logout()
    setUser(null)
  }, [])

  // Re-fetches the user from the server rather than trusting a client-composed object —
  // after a profile edit, `refresh()` shows back exactly what the server actually stored.
  const refresh = useCallback(async () => {
    const { user: refreshed } = await api.auth.me()
    setUser(refreshed)
    return refreshed
  }, [])

  const hasRole = useCallback((role) => Boolean(user?.roles?.includes(role)), [user])

  return (
    <SessionContext.Provider value={{ user, isLoading, login, register, logout, refresh, hasRole }}>
      {children}
    </SessionContext.Provider>
  )
}

export { SessionContext }
