import { useWishlist } from './useWishlist'
import { navigateTo } from '@mirwal/shared/navigation'

/**
 * The one real "save to wishlist" control.
 *
 * Every page had its own copy of this as local `useState` — the heart filled in and saved
 * nothing. This is backed by WishlistContext / the real /wishlist endpoint, so the filled
 * state means the product is genuinely stored against the shopper's account.
 *
 * Signed out, saving is not silently swallowed: the wishlist belongs to an account, so the
 * shopper is sent to sign in rather than being shown a heart that appears to have saved
 * something no server will remember.
 *
 * `className` is passed through because each surface styles its heart differently
 * (`heart btn`, `explore-wishlist`, `deal-heart`) — the behaviour is shared, the skin isn't.
 */
export default function WishlistHeart({ product, className = 'heart btn', savedClassName = 'selected' }) {
  const { isSaved, toggle, isSignedIn } = useWishlist()
  const saved = isSaved(product.slug)

  const onClick = (event) => {
    event.stopPropagation()
    if (!isSignedIn) { navigateTo('/login'); return }
    toggle(product.slug)
  }

  return (
    <button
      type="button"
      className={saved ? `${className} ${savedClassName}` : className}
      aria-label={`${saved ? 'Remove' : 'Save'} ${product.name} ${saved ? 'from' : 'to'} wishlist`}
      aria-pressed={saved}
      title={isSignedIn ? (saved ? 'Remove from wishlist' : 'Save to wishlist') : 'Sign in to save to your wishlist'}
      onClick={onClick}
    >
      <i className="fa-solid fa-heart" aria-hidden="true" />
    </button>
  )
}
