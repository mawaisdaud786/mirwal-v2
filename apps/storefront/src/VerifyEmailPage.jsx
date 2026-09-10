import { useEffect, useRef, useState } from 'react'
import { navigateTo } from '@mirwal/shared/navigation'
import { describeApiError } from '@mirwal/shared/useApiQuery'
import api from './api'

/**
 * Where the confirmation link in the email lands.
 *
 * Deliberately outside every session guard. This link is clicked from an inbox, which is very
 * often not the browser the account was created in — on a phone, in a webmail tab, from a
 * desktop client. Requiring a signed-in session here would make the link fail for exactly the
 * people most likely to use it. The token itself is the proof: unguessable, single-use, and
 * valid for an hour.
 *
 * The confirmation is fired once, from a ref-guarded effect. React's development StrictMode
 * mounts every component twice, and a single-use token consumed by the first mount would make
 * the second one report "that link is not valid" — a bug that appears only in development and
 * looks exactly like a real failure.
 */
export default function VerifyEmailPage() {
  // Read once, during render. The URL cannot change under this component, and a token that is
  // simply absent is knowable without a round trip — pushing that case through an effect would
  // flash "Confirming…" before admitting there was nothing to confirm.
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token'))

  const [state, setState] = useState(() => (token
    ? { status: 'working', message: null }
    : { status: 'error', message: 'That link is incomplete. Please use the button in the email.' }))

  const fired = useRef(false)

  useEffect(() => {
    if (!token || fired.current) return
    fired.current = true

    api.verification.confirmEmailLink(token)
      .then(() => setState({ status: 'done', message: null }))
      .catch((error) => setState({ status: 'error', message: describeApiError(error) }))
  }, [token])

  const copy = {
    working: {
      icon: 'spinner',
      title: 'Confirming your email address',
      body: 'One moment.',
    },
    done: {
      icon: 'circle-check',
      title: 'Your email address is confirmed',
      body: 'Thank you. You can close this tab, or carry on shopping.',
    },
    error: {
      icon: 'circle-exclamation',
      title: 'We could not confirm this link',
      body: state.message ?? 'The link may have expired or already been used.',
    },
  }[state.status]

  return (
    <main className="verify-email-page">
      <div className={`verify-email-card verify-email-${state.status}`}>
        <div className="verify-email-icon"><i className={`fa-solid fa-${copy.icon}`} aria-hidden="true" /></div>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>

        {state.status === 'done' && (
          <div className="verify-email-actions">
            <button type="button" className="primary" onClick={() => navigateTo('/')}>Continue shopping</button>
            <button type="button" onClick={() => navigateTo('/security')}>Account security</button>
          </div>
        )}

        {state.status === 'error' && (
          <div className="verify-email-actions">
            {/* Sending a fresh link needs a session, so this points at the page that can do it
                rather than pretending to retry a token that is already spent. */}
            <button type="button" className="primary" onClick={() => navigateTo('/security')}>
              Send a new link
            </button>
            <button type="button" onClick={() => navigateTo('/')}>Back home</button>
          </div>
        )}
      </div>
    </main>
  )
}
