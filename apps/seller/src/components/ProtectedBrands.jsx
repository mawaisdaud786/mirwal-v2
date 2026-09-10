import { useState } from 'react'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * Brands that need Mirwal's permission before you can list against them.
 *
 * Any seller could attach any brand to any listing, which is the primary counterfeit route on a
 * Pakistani marketplace: it is how unauthorised "Apple" and "Nike" listings reach search. The
 * `brand_authorizations` table has existed since migration 023 and nothing ever read it.
 *
 * Only gated brands appear here — most brands need nothing, and a page listing every brand with
 * a "request access" button would teach sellers that Mirwal is obstructive rather than that a
 * handful of brands are protected.
 *
 * A pending request does not let you list yet. That is stated on the row, because the costly
 * version of this is a seller building a listing and discovering it at the point of submission.
 */

const STATE = {
  approved: { tone: 'ok', label: 'Approved' },
  pending: { tone: 'wait', label: 'With Mirwal' },
  rejected: { tone: 'no', label: 'Not accepted' },
  revoked: { tone: 'no', label: 'Withdrawn' },
  expired: { tone: 'no', label: 'Expired' },
}

export default function ProtectedBrands() {
  const { data, error, isLoading, refetch } = useApiQuery((signal) => api.seller.brandAuth.list(signal), [])
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  if (isLoading) return null
  if (error) return <p className="verification-flash error">{describeApiError(error)}</p>

  const rows = data ?? []
  // Nothing gated means nothing to explain. An empty panel would only add noise.
  if (rows.length === 0) return null

  async function ask(slug) {
    setBusy(slug)
    setFlash(null)
    try {
      const result = await api.seller.brandAuth.request({ brandSlug: slug })
      setFlash({ tone: 'success', text: result?.message ?? 'Request sent.' })
      refetch()
    } catch (requestError) {
      setFlash({ tone: 'error', text: describeApiError(requestError) })
    } finally { setBusy(null) }
  }

  return (
    <section className="brandauth-card">
      <header>
        <h2>Protected brands</h2>
        <p>
          These brands need Mirwal&rsquo;s permission before you can list against them. Send your
          authorisation letter or distributor agreement under <b>Verification &rarr; Documents</b>{' '}
          first, then request access here.
        </p>
      </header>

      {flash && <p className={`verification-flash ${flash.tone}`} role="status">{flash.text}</p>}

      <ul className="brandauth-list">
        {rows.map(({ brand, authorization }) => {
          const state = authorization ? STATE[authorization.status] : null
          const canAsk = !authorization || ['rejected', 'revoked', 'expired'].includes(authorization.status)
          return (
            <li key={brand.slug}>
              <div>
                <strong>{brand.name}</strong>
                {state && <em className={`brandauth-state brandauth-${state.tone}`}>{state.label}</em>}
                {/* Why it was refused, in the seller's own words back to them — a bare
                    "not accepted" gives them nothing to act on. */}
                {authorization?.note && <small>{authorization.note}</small>}
                {authorization?.status === 'approved' && authorization.validUntil && (
                  <small>Valid until {new Date(authorization.validUntil).toLocaleDateString()}</small>
                )}
                {authorization?.status === 'pending' && <small>You cannot list this brand until it is approved.</small>}
                {!authorization && brand.note && <small>{brand.note}</small>}
              </div>
              {canAsk && (
                <button type="button" onClick={() => ask(brand.slug)} disabled={busy === brand.slug}>
                  {busy === brand.slug ? 'Sending…' : authorization ? 'Request again' : 'Request access'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
