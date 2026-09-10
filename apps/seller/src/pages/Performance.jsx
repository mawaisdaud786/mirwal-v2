import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import { navigateTo } from '@mirwal/shared/navigation'
import api from '../api'
import './performance.css'

/**
 * How Mirwal rates this store, and what to do about it.
 *
 * `seller_scores` has been computed hourly since the scoring service landed, and a seller had no
 * way to see any of it. A score that only staff can see is a score sellers cannot act on, which
 * makes every enforcement decision arrive as a surprise.
 *
 * What is deliberately **not** here: the risk score. Trust and risk are two different numbers —
 * trust is earned and is the seller's to improve, risk is a fraud signal and showing it teaches
 * exactly which behaviours to hide. `GET /seller/me/trust` never returns it; this page could not
 * display it if it wanted to.
 *
 * Every factor is shown with the count behind it, because "your score is 62" answers nothing.
 * A seller looking at "on-time dispatch 71%" knows what to change tomorrow morning.
 */

const TIERS = {
  new: { label: 'New seller', blurb: 'Your score settles once you have delivered a few orders.' },
  bronze: { label: 'Bronze', blurb: 'Steady delivery and good ratings move you up.' },
  silver: { label: 'Silver', blurb: 'A solid record. Consistency is what lifts you to gold.' },
  gold: { label: 'Gold', blurb: 'Among Mirwal’s strongest stores.' },
  platinum: { label: 'Platinum', blurb: 'Among Mirwal’s strongest stores.' },
}

/**
 * Every factor gets a plain-language name, a formatter, and — where it matters — the direction
 * that is good. A rate the seller wants low reads very differently from one they want high.
 */
const FACTORS = [
  {
    key: 'verificationLevel',
    label: 'Verification',
    // Sentence case in JS rather than `text-transform: capitalize` in CSS, which would also
    // reach "No ratings yet" and "2 days" and title-case both.
    format: (value) => {
      const words = String(value ?? 'unverified').replace(/_/g, ' ')
      return words.charAt(0).toUpperCase() + words.slice(1)
    },
    advice: (value) => (value && value !== 'unverified'
      ? null
      : 'Completing verification is the single fastest way to raise your score.'),
  },
  {
    key: 'deliveredItems',
    label: 'Items delivered',
    format: (value) => Number(value ?? 0).toLocaleString(),
    advice: (value) => (Number(value ?? 0) < 10
      ? 'Scores are provisional until you have delivered around ten items.'
      : null),
  },
  {
    key: 'rating',
    label: 'Average rating',
    // Stored as { average, count }: a 5.0 from one buyer is not the same claim as a 4.6 from
    // two hundred, and the count is what makes the number readable.
    format: (value) => (value?.count
      ? `${Number(value.average).toFixed(2)} / 5 from ${Number(value.count).toLocaleString()}`
      : 'No ratings yet'),
  },
  {
    key: 'onTimeDispatchRate',
    label: 'Dispatched on time',
    format: (value) => (value == null ? '—' : `${Math.round(Number(value))}%`),
    advice: (value) => (value != null && Number(value) < 90
      ? 'Add the tracking number as soon as the parcel leaves — dispatch is measured from that.'
      : null),
  },
  {
    key: 'sellerCancellationRate',
    label: 'Orders you cancelled',
    lowerIsBetter: true,
    format: (value) => (value == null ? '—' : `${Math.round(Number(value))}%`),
    advice: (value) => (value != null && Number(value) > 5
      ? 'Cancelling after a customer has paid is weighted heavily. Keep stock counts current.'
      : null),
  },
  {
    key: 'upheldReturnRate',
    label: 'Returns decided against you',
    lowerIsBetter: true,
    format: (value) => (value == null ? '—' : `${Math.round(Number(value))}%`),
    advice: (value) => (value != null && Number(value) > 10
      ? 'Usually a listing problem: photographs and specifications that do not match what ships.'
      : null),
  },
  {
    key: 'recentEnforcementActions',
    label: 'Recent policy actions',
    lowerIsBetter: true,
    format: (value) => Number(value ?? 0).toLocaleString(),
  },
  {
    key: 'accountAgeDays',
    label: 'Store age',
    format: (value) => `${Number(value ?? 0).toLocaleString()} days`,
  },
]

export default function Performance() {
  const trust = useApiQuery((signal) => api.seller.trust(signal), [])
  const compliance = useApiQuery((signal) => api.seller.compliance(signal), [])

  const crumbs = [{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Performance' }]

  return (
    <SellerLayout activeItem="performance-page" breadcrumbs={crumbs}>
      <div className="perf-page">
        <header className="perf-head">
          <h1>Performance</h1>
          <p>How Mirwal rates your store, and what moves each number.</p>
        </header>

        {trust.isLoading && <LoadingState label="Loading your score" />}
        {trust.error && !trust.isLoading && (
          <ErrorState title="We could not load your score" description={describeApiError(trust.error)} onRetry={trust.refetch} />
        )}

        {trust.data && <ScoreCard trust={trust.data} />}
        {trust.data && <Factors factors={trust.data.factors ?? {}} />}

        {compliance.data && <Compliance data={compliance.data} onChanged={compliance.refetch} />}
      </div>
    </SellerLayout>
  )
}

function ScoreCard({ trust }) {
  const tier = TIERS[trust.tier] ?? TIERS.new
  // A brand-new store has no score yet. Showing "0 / 100" would read as a penalty rather than
  // an absence, so the two states are drawn differently.
  const scored = trust.score != null

  return (
    <section className="perf-score">
      <div className={`perf-dial perf-${trust.tier}`} aria-hidden="true">
        <strong>{scored ? Math.round(trust.score) : '—'}</strong>
        <small>{scored ? 'out of 100' : 'not yet scored'}</small>
      </div>
      <div>
        <h2>{tier.label}</h2>
        <p>{tier.blurb}</p>
        {trust.computedAt && (
          <small className="perf-stamp">
            Last worked out {new Date(trust.computedAt).toLocaleString()}. Updated hourly.
          </small>
        )}
      </div>
    </section>
  )
}

function Factors({ factors }) {
  const rows = FACTORS.filter((factor) => factors[factor.key] !== undefined)
  if (rows.length === 0) {
    return (
      <section className="perf-card">
        <p>Your first orders will fill this in. Nothing has been measured yet.</p>
      </section>
    )
  }

  return (
    <section className="perf-card">
      <h2>What goes into it</h2>
      <ul className="perf-factors">
        {rows.map((factor) => {
          const value = factors[factor.key]
          const advice = factor.advice?.(value)
          return (
            <li key={factor.key}>
              <div>
                <span>{factor.label}</span>
                <strong>{factor.format(value)}</strong>
              </div>
              {/* Only shown when it applies. A page of advice against numbers that are already
                  fine is noise, and teaches the seller to stop reading it. */}
              {advice && <p className="perf-advice">{advice}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * What is on the store's record, and the way to argue with it.
 *
 * Every action shows the reason the seller was given, not a status code — an enforcement
 * notice a seller cannot understand is one they cannot fix. Appealing is a real endpoint
 * (`POST /seller/me/compliance/:id/appeal`) and is offered here rather than pointing at a
 * support form, because the API already refuses a second appeal and knows which action is
 * being disputed.
 */
function Compliance({ data, onChanged }) {
  const active = data.active ?? []
  const past = (data.history ?? []).filter((action) => !action.active)
  const nothingWrong = !data.restricted && !data.payoutHold && active.length === 0

  return (
    <section className="perf-card">
      <h2>Standing</h2>

      {nothingWrong && <p className="perf-clear">Your store is in good standing. Nothing is in force against it.</p>}

      {data.payoutHold && (
        <p className="perf-warn">
          Payouts are on hold. This usually clears once Mirwal has confirmed your bank details.
        </p>
      )}
      {data.restricted && (
        <p className="perf-warn">
          Your store is restricted{data.restrictedUntil ? ` until ${new Date(data.restrictedUntil).toLocaleDateString()}` : ''}.
        </p>
      )}

      {active.length > 0 && (
        <ul className="perf-actions">
          {active.map((action) => <ActionRow key={action.id} action={action} onChanged={onChanged} />)}
        </ul>
      )}

      {past.length > 0 && (
        <details className="perf-history">
          <summary>Past actions ({past.length})</summary>
          <ul className="perf-actions">
            {past.map((action) => (
              <li key={action.id}>
                <b>{String(action.type).replace(/_/g, ' ')}</b>
                {action.reason && <p>{action.reason}</p>}
                <small>
                  {new Date(action.at).toLocaleDateString()}
                  {action.liftedAt ? ` · lifted ${new Date(action.liftedAt).toLocaleDateString()}` : ' · expired'}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function ActionRow({ action, onChanged }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const result = await api.seller.appeal(action.id, note.trim())
      setFlash({ tone: 'success', text: result?.message ?? 'Your appeal has been submitted.' })
      setOpen(false)
      onChanged?.()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  return (
    <li>
      <b>{String(action.type).replace(/_/g, ' ')}</b>
      {action.reason && <p>{action.reason}</p>}
      <small>
        {new Date(action.at).toLocaleDateString()}
        {action.expiresAt ? ` · lifts ${new Date(action.expiresAt).toLocaleDateString()}` : ' · no end date'}
        {action.caseReference ? ` · case ${action.caseReference}` : ''}
      </small>

      {flash && <p className={`perf-flash ${flash.tone}`} role="status">{flash.text}</p>}

      {action.appeal?.status !== 'none' && !flash && (
        <small className="perf-appealed">Appeal {action.appeal.status.replace(/_/g, ' ')}.</small>
      )}

      {action.appeal?.canAppeal && !open && !flash && (
        <button type="button" onClick={() => setOpen(true)}>Appeal this</button>
      )}

      {open && (
        <form className="perf-appeal" onSubmit={submit}>
          {/* The API refuses anything under twenty characters — said here rather than returned
              as an error after the seller has written something. */}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Tell Mirwal why you think this is wrong, in a sentence or two."
          />
          <div>
            <button type="submit" disabled={busy || note.trim().length < 20}>
              {busy ? 'Sending…' : 'Send appeal'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setNote('') }} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </li>
  )
}
