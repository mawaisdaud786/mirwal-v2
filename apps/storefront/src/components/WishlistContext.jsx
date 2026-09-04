import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api'
import { useSession } from './useSession'

/**
 * The signed-in shopper's real wishlist.
 *
 * Every heart in the app used to be its own local `useState` — it filled in, saved nothing,
 * and reset on the next navigation. This holds the one real list, loaded from
 * GET /wishlist (server/src/modules/wishlist), so a heart reflects what is actually stored.
 *
 * Nothing is kept in localStorage on purpose. The wishlist belongs to an account, not a
 * browser: it is fetched when a session exists and is dropped the moment one doesn't, so
 * signing out leaves nothing of the previous shopper behind on a shared device.
 *
 * The loaded list is stamped with the user id it belongs to, and anything stamped with a
 * different id is ignored rather than cleared in an effect. That makes "signed out, or
 * signed in as someone else" a derived state instead of a second render pass, so a stale
 * list can never be shown for even one frame while a clearing effect catches up.
 */
const WishlistContext = createContext(null)

const EMPTY = []

export function WishlistProvider({ children }) {
  const { user } = useSession()
  const [loaded, setLoaded] = useState({ userId: null, items: EMPTY })

  const items = loaded.userId && loaded.userId === user?.id ? loaded.items : EMPTY
  const slugs = useMemo(() => new Set(items.map((item) => item.slug)), [items])

  useEffect(() => {
    if (!user) return undefined
    let active = true
    api.wishlist.list()
      .then((data) => { if (active) setLoaded({ userId: user.id, items: data.items }) })
      // A failed load leaves the wishlist empty rather than guessed-at: the hearts show
      // unsaved instead of claiming a state the server never confirmed.
      .catch(() => { if (active) setLoaded({ userId: user.id, items: EMPTY }) })
    return () => { active = false }
  }, [user])

  const toggle = useCallback(async (slug) => {
    if (!user) return { requiresAuth: true }
    const saved = slugs.has(slug)
    try {
      const data = saved ? await api.wishlist.remove(slug) : await api.wishlist.add(slug)
      setLoaded({ userId: user.id, items: data.items })
      return { saved: !saved }
    } catch {
      return { failed: true }
    }
  }, [user, slugs])

  const isSaved = useCallback((slug) => slugs.has(slug), [slugs])

  const value = useMemo(
    () => ({ items, count: items.length, isSaved, toggle, isSignedIn: Boolean(user) }),
    [items, isSaved, toggle, user],
  )

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export { WishlistContext }
