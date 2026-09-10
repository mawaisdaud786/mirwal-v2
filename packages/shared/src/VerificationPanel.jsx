import { useState } from 'react'
import Icon from './Icon.jsx'
import { useApiQuery, describeApiError } from './useApiQuery.js'

/**
 * Confirming an email address and a mobile number.
 *
 * `users.email_verified_at` and `phone_verified_at` have existed since migration 001 and were
 * written by exactly one thing — the database seeder. There was no endpoint that could set
 * them and no screen that could ask, so every account on Mirwal was formally unverified and
 * the seller-application gate had nothing real to check.
 *
 * Lives in `shared` rather than in one app, alongside `PageStates`, because it is identical
 * for a shopper and for a seller and carries no application-specific chrome. The API is passed
 * in rather than imported, so this file has no idea which app is rendering it.
 *
 * Two differences between the channels drive the whole design:
 *
 *   * **Email is a link, phone is a code.** A link carries 256 bits of entropy and is clicked
 *     from an inbox — very often in a different browser, which is why the confirming endpoint
 *     needs no session. A six-digit code is one in a million, so it is entered here, and the
 *     server limits attempts: unlimited guesses on six digits is not a second factor.
 *
 *   * **A code expires quickly.** Ten minutes for SMS against an hour for email, and the panel
 *     says which, because "that code has expired" with no prior warning reads as a bug.
 *
 * @param {object} props
 * @param {object} props.api        `{ status, request, confirm }` — see the storefront/seller clients
 * @param {Function} [props.onChange] called after a channel is confirmed, so a parent can refetch
 * @param {string}  [props.phoneHint] where to change the number, when there is none on file
 */
export function VerificationPanel({ api, onChange, phoneHint = 'Add a mobile number to your profile first.' }) {
  const { data, isLoading, error, refetch } = useApiQuery((signal) => api.status(signal), [])

  if (isLoading) return <div className="verify-panel"><p className="verify-note">Checking your contact details…</p></div>
  if (error) {
    return (
      <div className="verify-panel">
        <p className="verify-note verify-error">{describeApiError(error)}</p>
        <button type="button" onClick={refetch}>Try again</button>
      </div>
    )
  }

  const done = () => { refetch(); onChange?.() }

  return (
    <div className="verify-panel">
      <EmailChannel api={api} state={data.email} onDone={done} />
      <PhoneChannel api={api} state={data.phone} onDone={done} phoneHint={phoneHint} />
    </div>
  )
}

/**
 * Email.
 *
 * There is no code box here on purpose. The link is the proof, and asking someone to copy a
 * token out of an email and paste it into a form is a worse version of clicking the link —
 * with more ways to go wrong.
 */
function EmailChannel({ api, state, onDone }) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [devLink, setDevLink] = useState(null)

  async function send() {
    setBusy(true)
    setFlash(null)
    setDevLink(null)
    try {
      const result = (await api.request('email'))?.data

      /**
       * Say what actually happened.
       *
       * This used to report "check your inbox" unconditionally, while the server had just
       * recorded the message as skipped because no mail server is configured. Someone then
       * waits for an email that was never sent and concludes the feature is broken.
       */
      if (result?.delivery?.status === 'queued') {
        setFlash({ tone: 'success', text: 'On its way — check your inbox. The link works for one hour.' })
      } else {
        setFlash({
          tone: 'warn',
          text: `We could not send the email. ${result?.delivery?.reason ?? ''}`.trim(),
        })
      }
      // Present in development only; the API omits it entirely in production.
      if (result?.devOnly?.link) setDevLink(result.devOnly.link)
    } catch (requestError) {
      setFlash({ tone: 'error', text: describeApiError(requestError) })
    } finally { setBusy(false) }
  }

  return (
    <Channel
      icon="envelope"
      title="Email address"
      value={state.address}
      verified={state.verified}
      verifiedAt={state.verifiedAt}
      onDone={onDone}
    >
      <p>We will send a link to confirm this address is yours.</p>
      {flash && <p className={`verify-note verify-${flash.tone}`} role="status">{flash.text}</p>}
      {devLink && <DevFallback label="Confirmation link" value={devLink} href={devLink} />}
      <button type="button" disabled={busy} onClick={send}>
        {busy ? 'Sending…' : 'Send confirmation link'}
      </button>
    </Channel>
  )
}

/**
 * Phone.
 *
 * The code box only appears after a code has actually been sent. Showing an empty six-digit
 * field to someone who has not requested anything invites them to type a guess and be told
 * they are wrong.
 */
function PhoneChannel({ api, state, onDone, phoneHint }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [flash, setFlash] = useState(null)
  const [devCode, setDevCode] = useState(null)

  async function send() {
    setBusy(true)
    setFlash(null)
    setDevCode(null)
    try {
      // `envelope: true` on these clients returns `{ data, message }`, so the payload is one
      // level down — reading `result.destination` silently produced "your phone" instead of
      // the masked number the endpoint went to the trouble of returning.
      const result = (await api.request('phone'))?.data
      setSent(true)

      // Same rule as email: report the delivery outcome, not the intention.
      if (result?.delivery?.status === 'queued') {
        setFlash({
          tone: 'success',
          text: `Code sent to ${result?.destination ?? 'your phone'}. It expires in ${result?.expiresInMinutes ?? 10} minutes.`,
        })
      } else {
        setFlash({
          tone: 'warn',
          text: `We could not send the text message. ${result?.delivery?.reason ?? ''}`.trim(),
        })
      }
      if (result?.devOnly?.code) setDevCode(result.devOnly.code)
    } catch (requestError) {
      setFlash({ tone: 'error', text: describeApiError(requestError) })
    } finally { setBusy(false) }
  }

  async function confirm(event) {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      await api.confirm('phone', code.trim())
      setCode('')
      setSent(false)
      onDone()
    } catch (confirmError) {
      setFlash({ tone: 'error', text: describeApiError(confirmError) })
      // A wrong code costs an attempt server-side, so clearing the box makes the next try a
      // deliberate one rather than an edit of a value that was already refused.
      setCode('')
    } finally { setBusy(false) }
  }

  if (!state.number) {
    return (
      <Channel icon="mobile-screen" title="Mobile number" value={null} verified={false}>
        <p className="verify-note">{phoneHint}</p>
      </Channel>
    )
  }

  return (
    <Channel
      icon="mobile-screen"
      title="Mobile number"
      value={state.number}
      verified={state.verified}
      verifiedAt={state.verifiedAt}
      onDone={onDone}
    >
      <p>We will text you a six-digit code.</p>
      {flash && <p className={`verify-note verify-${flash.tone}`} role="status">{flash.text}</p>}
      {devCode && <DevFallback label="Your code" value={devCode} onUse={() => setCode(devCode)} />}

      {sent ? (
        <form onSubmit={confirm} className="verify-code-form">
          <label>
            <span>Code from the text message</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              required
              autoFocus
            />
          </label>
          <div className="verify-actions">
            <button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Confirm'}
            </button>
            <button type="button" className="verify-secondary" disabled={busy} onClick={send}>
              Send a new code
            </button>
          </div>
        </form>
      ) : (
        <button type="button" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : 'Send code'}
        </button>
      )}
    </Channel>
  )
}

/**
 * The link or code, shown when the server could not deliver it.
 *
 * Only ever rendered from `devOnly`, which the API omits entirely outside development — so
 * this cannot appear in production however the component is used. It exists because without a
 * mail server or an SMS gateway the flow is otherwise impossible to exercise at all, and the
 * alternative is reading tokens out of the database by hand.
 *
 * Labelled as a development aid rather than presented as normal output, so nobody mistakes it
 * for something a real user would see.
 */
function DevFallback({ label, value, href, onUse }) {
  return (
    <div className="verify-dev">
      <b><Icon name="wrench" /> Development only</b>
      <p>Mirwal could not deliver this, so here it is directly. Configure SMTP or an SMS gateway to send it for real.</p>
      <span className="verify-dev-label">{label}</span>
      {href
        ? <a className="verify-dev-value" href={href}>{value}</a>
        : <code className="verify-dev-value">{value}</code>}
      {onUse && <button type="button" className="verify-secondary" onClick={onUse}>Use this code</button>}
    </div>
  )
}

/** One channel row: what it is, whether it is confirmed, and what can be done about it. */
function Channel({ icon, title, value, verified, verifiedAt, children }) {
  return (
    <div className={verified ? 'verify-channel verified' : 'verify-channel'}>
      <div className="verify-channel-head">
        <span className="verify-channel-icon"><Icon name={icon} /></span>
        <div>
          <b>{title}</b>
          {value && <small>{value}</small>}
        </div>
        <em className={verified ? 'verify-badge on' : 'verify-badge off'}>
          <Icon name={verified ? 'circle-check' : 'circle-exclamation'} />
          {verified ? 'Confirmed' : 'Not confirmed'}
        </em>
      </div>

      {verified ? (
        <p className="verify-note">
          Confirmed{verifiedAt ? ` on ${new Date(`${verifiedAt}Z`).toLocaleDateString()}` : ''}.
        </p>
      ) : (
        <div className="verify-channel-body">{children}</div>
      )}
    </div>
  )
}
