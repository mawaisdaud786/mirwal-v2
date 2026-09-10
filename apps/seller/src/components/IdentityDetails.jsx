import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * The identity details Mirwal checks documents against.
 *
 * These columns are filled when an application is approved and could never be touched again:
 * the store profile deliberately refuses them, because a seller who can rewrite their legal
 * name after verification can turn a verified store into an impersonation overnight.
 *
 * "Never editable" is the wrong rule though. A store created before applications existed has
 * none of these; a CNIC gets mistyped; a sole trader registers a company. So a blank field can
 * be filled in freely, and a verified one can be changed at the cost of the verification it
 * was carrying — stated here before the seller commits, not discovered afterwards.
 *
 * Approving a photograph of a CNIC is not verification. Verification is confirming the number
 * on the card matches the name on the account, and that needs the number to exist.
 */
const FIELDS = [
  { key: 'cnic', label: 'CNIC number', placeholder: '35202-1234567-1', help: 'As printed on your card — dashes are fine.' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'legalName', label: 'Registered business name', businessOnly: true },
  { key: 'ntn', label: 'NTN', businessOnly: true, help: 'Your tax number from FBR.' },
  { key: 'strn', label: 'Sales tax number (STRN)', businessOnly: true, help: 'Only if you are registered for sales tax.' },
  { key: 'businessRegNo', label: 'Company registration number', businessOnly: true, help: 'Required for a private limited company.' },
]

export default function IdentityDetails() {
  const kyc = useApiQuery((signal) => api.seller.kyc.get(signal), [])
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  if (kyc.isLoading) return <p className="verification-loading">Loading your details…</p>
  if (kyc.error) return <p className="verification-flash error">{describeApiError(kyc.error)}</p>

  const data = kyc.data
  const isBusiness = data.sellerType === 'business'
  const fields = FIELDS.filter((field) => !field.businessOnly || isBusiness)

  const value = (key) => draft[key] ?? (key === 'cnic' ? '' : data[key] ?? '')
  const dirty = Object.keys(draft).length > 0

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.seller.kyc.update(draft)
      setDraft({})
      setFlash({ tone: result?.data?.downgraded ? 'warn' : 'success', text: result?.message ?? 'Details saved.' })
      kyc.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  return (
    <section className="identity-card">
      <div className="identity-head">
        <span><Icon name="id-card" /></span>
        <div>
          <h2>Your details</h2>
          <p>What Mirwal checks your documents against.</p>
        </div>
      </div>

      {data.missing.length > 0 && (
        <p className="identity-missing">
          <Icon name="circle-exclamation" /> Still needed: {data.missing.map((key) => (
            FIELDS.find((field) => field.key === key)?.label ?? key
          )).join(', ')}
        </p>
      )}

      {/* Said before they edit anything, because the cost falls on someone fixing a typo. */}
      {data.locked && (
        <p className="identity-locked">
          <Icon name="lock" /> These have been verified. Changing any of them puts your store back
          in review and pauses your verified badge — your documents stay on file.
        </p>
      )}

      {flash && <p className={`verification-flash ${flash.tone}`} role="status">{flash.text}</p>}

      <form onSubmit={submit}>
        <div className="identity-grid">
          {fields.map((field) => (
            <label key={field.key} className="identity-field">
              <span>{field.label}</span>
              <input
                type={field.type ?? 'text'}
                value={value(field.key)}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.key === 'cnic' && data.cnic ? data.cnic : field.placeholder}
                maxLength={field.key === 'cnic' ? 20 : 200}
              />
              {/* The stored CNIC is only ever shown masked, here as the placeholder — a seller
                  knows their own number, and rendering it in full just creates something to be
                  shoulder-surfed. */}
              {field.help && <small>{field.help}</small>}
            </label>
          ))}
        </div>

        {isBusiness && (
          <label className="identity-field">
            <span>Business type</span>
            <select
              value={draft.businessType ?? data.businessType ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, businessType: event.target.value }))}
            >
              <option value="">Choose…</option>
              <option value="sole_proprietor">Sole proprietor</option>
              <option value="partnership">Partnership</option>
              <option value="private_limited">Private limited</option>
              <option value="other">Other</option>
            </select>
          </label>
        )}

        <button type="submit" className="btn-primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </form>
    </section>
  )
}
