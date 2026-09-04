import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { onAuthChange, restoreSession } from '@mirwal/shared/apiClient'
import api from './api'

/**
 * Seller session — deliberately separate from the storefront's customer session and from the
 * seller portal's.
 *
 * `user` is only ever set from a server response on the seller auth namespace
 * (`/seller/auth/login`, `/seller/auth/refresh`). That namespace refuses to issue a session to
 * a non-seller account at all, so a customer cannot obtain a seller session even with valid
 * customer credentials. Nothing here reads a client-controlled role: there is no
 * `localStorage.role` to forge, and the frontend guard is UX on top of server enforcement,
 * never the boundary itself.
 */
const SellerSessionContext = createContext(null)

export function SellerSessionProvider({ children }) {
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

  return (
    <SellerSessionContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </SellerSessionContext.Provider>
  )
}

export function useSellerSession() {
  const context = useContext(SellerSessionContext)
  if (!context) throw new Error('useSellerSession must be used inside SellerSessionProvider')
  return context
}
