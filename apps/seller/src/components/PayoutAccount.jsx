import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * Where a seller's money goes.
 *
 * `payouts.destination_hint` was free text typed by staff, so a seller had no way to say where
 * their earnings should be sent. This page used to explain that as a deliberate privacy
 * feature — "Mirwal never stores your bank details" — which was true and is no longer: there
 * is a verified payout account now, and the honest version of that promise is narrower.
 *
 * What is actually stored is what a transfer needs and nothing more: an account title, an
 * IBAN or a wallet number, and the bank's name. No full account numbers beyond the IBAN
 * itself, no cheque images, nothing that would make this table worth stealing beyond what a
 * payout file already contains. Values are masked everywhere, including here.
 *
 * The consequential behaviour is the change flow. Swapping the payout destination is the
 * primary account-takeover cash-out path on any marketplace — an attacker does not steal
 * products, they change the bank details and wait. So a change archives the old account,
 * holds withdrawals for a cooling-off period, and emails the address on file *before* the
 * change. This component states that up front rather than letting a seller discover it.
 */
export default function PayoutAccount() {
  const accounts = useApiQuery((signal) => api.seller.bankAccounts.list(signal), [])
  const eligibility = useApiQuery((signal) => api.seller.payoutEligibility(signal), [])

  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [form, setForm] = useState({ method: 'bank', accountTitle: '', bankName: '', iban: '', msisdn: '' })

  const current = (accounts.data ?? []).find((account) => account.isDefault) ?? null
  const isWallet = form.method !== 'bank'

  const set = (field) => (event) => setForm((state) => ({ ...state, [field]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const payload = {
        method: form.method,
        accountTitle: form.accountTitle,
        ...(isWallet ? { msisdn: form.msisdn } : { bankName: form.bankName, iban: form.iban }),
      }
      const result = await api.seller.bankAccounts.add(payload)
      setFlash({ tone: 'success', text: result?.message ?? 'Payout account saved.' })
      setAdding(false)
      setForm({ method: 'bank', accountTitle: '', bankName: '', iban: '', msisdn: '' })
      accounts.refetch()
      eligibility.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="finance-panel settings-card">
      <div className="settings-heading">
        <span className="settings-icon purple"><Icon name="building-columns" /></span>
        <div>
          <h2>Payout account</h2>
          <p>Where Mirwal sends your earnings.</p>
        </div>
      </div>

      {flash && <p className={`payout-flash payout-flash-${flash.tone}`} role="status">{flash.text}</p>}

      {accounts.isLoading && <p className="settings-note">Loading…</p>}

      {!accounts.isLoading && current && !adding && (
        <>
          <div className="payout-account">
            <div>
              <b>{current.accountTitle}</b>
              <small>
                {current.bankName}
                {current.iban ? ` · ${current.iban}` : ''}
                {current.msisdn ? ` · ${current.msisdn}` : ''}
              </small>
            </div>
            <em className={`payout-status payout-${current.status}`}>
              <Icon name={current.status === 'verified' ? 'circle-check' : current.status === 'rejected' ? 'circle-xmark' : 'clock'} />
              {current.status === 'verified' ? 'Verified' : current.status === 'rejected' ? 'Not accepted' : 'Being verified'}
            </em>
          </div>
          {current.status === 'rejected' && current.rejectionReason && (
            <p className="settings-note payout-reason">{current.rejectionReason}</p>
          )}
          <button type="button" className="finance-link" onClick={() => setAdding(true)}>
            <Icon name="pen" /> Change payout account
          </button>
        </>
      )}

      {!accounts.isLoading && !current && !adding && (
        <>
          <p className="settings-note">
            You have not added a payout account yet. You can list and sell without one &mdash; it is only
            needed before your first withdrawal.
          </p>
          <button type="button" className="finance-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add a payout account
          </button>
        </>
      )}

      {adding && (
        <form className="payout-form" onSubmit={submit}>
          {current && (
            // Said before they fill the form in, not after they submit it.
            <p className="payout-warning">
              <Icon name="triangle-exclamation" /> Changing this holds your withdrawals while Mirwal verifies
              the new account, and we will email your current address to confirm it was you.
            </p>
          )}

          <label>
            <span>How should we pay you?</span>
            <select value={form.method} onChange={set('method')}>
              <option value="bank">Bank transfer</option>
              <option value="easypaisa">EasyPaisa</option>
              <option value="jazzcash">JazzCash</option>
            </select>
          </label>

          <label>
            <span>Account title</span>
            <input
              value={form.accountTitle}
              onChange={set('accountTitle')}
              placeholder="Exactly as your bank has it"
              required
              maxLength={150}
            />
            {/* The single most common KYC failure is a title that does not match the CNIC or
                the registered business name, so it is said here rather than discovered on
                rejection. */}
            <small>Must match your CNIC name, or your registered business name.</small>
          </label>

          {isWallet ? (
            <label>
              <span>{form.method === 'easypaisa' ? 'EasyPaisa' : 'JazzCash'} number</span>
              <input value={form.msisdn} onChange={set('msisdn')} placeholder="03001234567" required maxLength={20} />
            </label>
          ) : (
            <>
              <label>
                <span>Bank</span>
                <input value={form.bankName} onChange={set('bankName')} placeholder="e.g. Meezan Bank" required maxLength={120} />
              </label>
              <label>
                <span>IBAN</span>
                <input
                  value={form.iban}
                  onChange={set('iban')}
                  placeholder="PK36SCBL0000001123456702"
                  required
                  maxLength={34}
                  style={{ textTransform: 'uppercase' }}
                />
                <small>24 characters, starting PK. It is on your bank statement.</small>
              </label>
            </>
          )}

          <div className="payout-actions">
            <button type="submit" className="finance-primary" disabled={busy}>
              {busy ? 'Saving…' : current ? 'Change account' : 'Save account'}
            </button>
            <button type="button" className="finance-link" onClick={() => { setAdding(false); setFlash(null) }} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Why a withdrawal would be refused right now, stated before it is attempted. */}
      {!eligibility.isLoading && eligibility.data && !eligibility.data.eligible && (
        <p className="payout-blocked" role="status">
          <Icon name="circle-info" /> {eligibility.data.reason}
        </p>
      )}
    </section>
  )
}
