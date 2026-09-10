import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { onAuthChange, restoreSession } from '@mirwal/shared/apiClient'
import api from './api'

/**
 * Admin session — deliberately separate from the storefront's customer session and from the
 * seller portal's.
 *
 * `user` is only ever set from a server response on the admin auth namespace
 * (`/admin/auth/login`, `/admin/auth/refresh`). That namespace refuses to issue a session to
 * a non-admin account at all, so a customer cannot obtain an admin session even with valid
 * customer credentials. Nothing here reads a client-controlled role: there is no
 * `localStorage.role` to forge, and the frontend guard is UX on top of server enforcement,
 * never the boundary itself.
 */
const AdminSessionContext = createContext(null)

export function AdminSessionProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    restoreSession().then((restored) => {
      if (active) { setUser(restored); setIsLoading(false) }
    })
    return () => { active = false }
  }, [])

  useEffect(() => onAuthChange((token) => { if (!token) setUser(null) }), [])

  const login = useCallback(async (credentials) => {
    const data = await api.auth.login(credentials)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await api.auth.logout()
    setUser(null)
  }, [])


  /**
   * May the signed-in operator do this?
   *
   * Any-of, matching `requirePermission(...permissions)` on the server so a button and the
   * route behind it can never disagree about who is allowed.
   *
   * This is presentation, not protection. Hiding a control the server would refuse spares
   * someone a pointless error; showing one it would allow is the only real failure mode. Every
   * endpoint enforces the same permission independently, so a forged `user` object in the
   * browser buys nothing.
   */
  const can = useCallback(
    (...permissions) => permissions.some((permission) => user?.permissions?.includes(permission)),
    [user],
  )

  return (
    <AdminSessionContext.Provider value={{ user, isLoading, login, logout, can }}>
      {children}
    </AdminSessionContext.Provider>
  )
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext)
  if (!context) throw new Error('useAdminSession must be used inside AdminSessionProvider')
  return context
}
