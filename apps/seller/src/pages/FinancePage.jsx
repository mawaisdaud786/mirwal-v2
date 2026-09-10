import { useState } from 'react'
import SellerLayout from '../SellerLayout'
import { StatCard, DataTable, StatusBadge, EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { ErrorState, LoadingState } from '@mirwal/shared/PageStates'
import api from '../api'
import './finance.css'
import './finance-extra.css'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import PayoutAccount from '../components/PayoutAccount'

/**
 * Finance overview and withdrawals were fully fabricated: a Rs. 52,430 "available balance",
 * a hand-drawn earnings chart, fake transaction/withdrawal/invoice history, and a withdrawal
 * request form that accepted any amount and showed a fake success message with no real
 * transfer behind it. There was no orders or payments system to source real earnings from.
 *
 * Both are real now, computed from this seller's own order_items/refunds (server/src/modules/
 * sellers/finance.service.js) — never another seller's, enforced server-side the same way
 * every other seller-scoped endpoint is. Withdrawals are real too since migration 014:
 * requesting one claims the delivered order items behind it so the same earnings cannot be
 * withdrawn twice. What is still honestly not connected: an actual
 * payout/withdrawal mechanism. There is no bank-account-on-file, no payout table, nothing that
 * could move money anywhere — so Withdrawals shows the real balance but keeps the withdrawal
 * action disabled, rather than pretending a request would do anything.
 *
 * `SettingsContent` now carries a real payout account (see components/PayoutAccount.jsx).
 * Seller tax-info fields remain unbuilt and the page says so rather than drawing them.
 */

const RANGE_OPTIONS = [
  ['7d', '7 Days'],
  ['30d', '30 Days'],
  ['90d', '3 Months'],
  ['1y', '12 Months'],
]

function useSellerFinance() {
  const [range, setRange] = useState('30d')
  const { data, error, isLoading, refetch } = useApiQuery(
    (signal) => api.seller.finance({ range }, signal),
    [range],
  )
  return { data, error, isLoading, refetch, range, setRange }
}

function RangePicker({ range, onChange }) {
  return <div className="finance-range-picker">
    {RANGE_OPTIONS.map(([value, label]) => (
      <button type="button" key={value} className={range === value ? 'active' : ''} onClick={() => onChange(value)}>{label}</button>
    ))}
  </div>
}

const STATUS_LABELS = { pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned' }

function TransactionsTable({ transactions }) {
  return <DataTable
    columns={[
      { key: 'orderNumber', label: 'Order' },
      { key: 'productName', label: 'Product' },
      { key: 'quantity', label: 'Qty' },
      { key: 'amount', label: 'Amount', render: (amount) => amount.display },
      { key: 'status', label: 'Status', render: (status) => <StatusBadge status={status} label={STATUS_LABELS[status] ?? status} /> },
      { key: 'createdAt', label: 'Date', render: (value) => new Date(value).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) },
    ]}
    data={transactions}
  />
}

function OverviewContent() {
  const { data, error, isLoading, refetch, range, setRange } = useSellerFinance()
  return <>
    <RangePicker range={range} onChange={setRange} />
    {isLoading && <LoadingState label="Loading earnings" />}
    {error && !isLoading && <ErrorState title="We could not load your earnings" description={describeApiError(error)} onRetry={refetch} />}
    {data && <>
      <div className="finance-stat-grid">
        <StatCard label="Delivered Revenue" value={data.kpis.revenue.value.display} icon={<Icon name="sack-dollar" />} change={data.kpis.revenue.changePercent != null ? `${data.kpis.revenue.changePercent >= 0 ? '+' : ''}${data.kpis.revenue.changePercent}% vs previous period` : 'No prior period yet'} isNegative={data.kpis.revenue.changePercent < 0} />
        <StatCard label="Pending (in fulfillment)" value={data.kpis.pending.value.display} icon={<Icon name="clock" />} change={`${data.kpis.pending.orderCount} order${data.kpis.pending.orderCount === 1 ? '' : 's'} in progress`} />
        <StatCard label="Refunded" value={data.kpis.refunded.value.display} icon={<Icon name="rotate-left" />} change={data.kpis.refunded.changePercent != null ? `${data.kpis.refunded.changePercent >= 0 ? '+' : ''}${data.kpis.refunded.changePercent}% vs previous period` : 'No prior period yet'} isNegative={data.kpis.refunded.changePercent > 0} />
        <StatCard label="Available Balance" value={data.kpis.availableBalance.value.display} icon={<Icon name="wallet" />} change="Delivered revenue minus refunds" />
      </div>

      <section className="finance-panel">
        <h2>Recent Transactions</h2>
        {data.recentTransactions.length === 0
          ? <EmptyState icon={<Icon name="receipt" />} title="No transactions yet" text="Order activity for your store will show up here." />
          : <TransactionsTable transactions={data.recentTransactions} />}
      </section>
    </>}
  </>
}

function formatPayoutDate(value) {
  if (!value) return '—'
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Withdrawals.
 *
 * `balance` is what is genuinely payable right now: delivered order items not already claimed
 * by another payout. Requesting one attaches those items to it, so the figure drops to zero
 * and the same earnings cannot be requested twice — which is why there is no amount field.
 * The seller withdraws what they are owed, not a number they type.
 *
 * Approving and paying are Mirwal's decisions and are not exposed here.
 */
function WithdrawalsContent() {
  const balance = useApiQuery((signal) => api.seller.balance(signal), [])
  const payouts = useApiQuery((signal) => api.seller.payouts.list({ pageSize: 20 }, signal), [])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const request = async () => {
    setBusy(true)
    setFlash(null)
    try {
      const { message } = await api.seller.payouts.request({ method: 'bank_transfer' })
      setFlash({ tone: 'success', text: message })
      balance.refetch()
      payouts.refetch()
    } catch (error) {
      setFlash({ tone: 'error', text: describeApiError(error) })
    } finally { setBusy(false) }
  }

  const available = balance.data
  const history = payouts.data?.items ?? []

  return <>
    {balance.isLoading && <LoadingState label="Loading balance" />}
    {balance.isError && !balance.isLoading && (
      <ErrorState title="We could not load your balance" description={describeApiError(balance.error)} onRetry={balance.refetch} />
    )}

    {flash && (
      <p className={`payout-flash ${flash.tone}`} role="status">
        <Icon name={flash.tone === 'success' ? 'circle-check' : 'triangle-exclamation'} /> {flash.text}
      </p>
    )}

    {available && <>
      <div className="finance-stat-grid">
        <StatCard label="Available to withdraw" value={available.netAmount.display} icon={<Icon name="wallet" />} change={`After ${available.commissionPercent}% Mirwal commission`} />
        <StatCard label="Gross earnings" value={available.grossAmount.display} icon={<Icon name="coins" />} change={`${available.itemCount} delivered item${available.itemCount === 1 ? '' : 's'} awaiting payout`} />
        <StatCard label="Commission" value={available.commissionAmount.display} icon={<Icon name="percent" />} change="Retained by Mirwal on this payout" />
      </div>

      <section className="finance-panel">
        <h2>Request a withdrawal</h2>
        <p className="muted">
          Withdrawing transfers everything currently owed to you — there is no amount to choose. Those
          order items are then attached to the request, so they cannot be withdrawn twice.
          The minimum is {available.minimumAmount.display}.
        </p>
        <button type="button" className="finance-primary" disabled={busy || !available.canRequest} onClick={request}>
          <Icon name="money-bill-transfer" /> {busy ? 'Requesting…' : `Withdraw ${available.netAmount.display}`}
        </button>
        {!available.canRequest && (
          <p className="muted payout-blocked">
            {available.itemCount === 0
              ? 'Nothing is awaiting payout right now. Earnings become withdrawable once an order is delivered.'
              : `Your balance is below the ${available.minimumAmount.display} minimum.`}
          </p>
        )}
        <p className="muted payout-note">
          Mirwal does not transfer funds automatically. A request is reviewed, then paid by bank transfer,
          and the reference appears here once it has been sent.
        </p>
      </section>
    </>}

    <section className="finance-panel">
      <h2>Withdrawal history</h2>
      {payouts.isLoading ? <LoadingState label="Loading withdrawals" />
        : history.length === 0
          ? <EmptyState icon="money-bill-transfer" title="No withdrawals yet" description="Your requests and their status appear here." />
          : (
            <div className="payout-table-wrap">
              <table className="payout-table">
                <thead><tr><th>Reference</th><th>Items</th><th>Net</th><th>Status</th><th>Requested</th><th>Paid</th></tr></thead>
                <tbody>
                  {history.map((payout) => (
                    <tr key={payout.id}>
                      <td><code>{payout.reference}</code>{payout.externalReference && <small>bank ref {payout.externalReference}</small>}</td>
                      <td>{payout.itemCount ?? '—'}</td>
                      <td><strong>{payout.netAmount?.display ?? '—'}</strong></td>
                      <td>
                        <StatusBadge status={payout.status} />
                        {payout.failureReason && <small>{payout.failureReason}</small>}
                      </td>
                      <td>{formatPayoutDate(payout.requestedAt)}</td>
                      <td>{formatPayoutDate(payout.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  </>
}

const FinancePage = ({ type = 'overview' }) => {
  const isWithdrawals = type === 'withdrawals'
  const isSettings = type === 'settings'
  const title = isWithdrawals ? 'Withdraw Funds' : isSettings ? 'Payment Settings' : 'Finance Overview'
  const subtitle = isWithdrawals ? 'What you are owed right now, and every withdrawal you have requested.' : isSettings ? 'Manage your payout methods, business details and security preferences.' : 'Track your real earnings, pending orders and refunds.'
  return <SellerLayout activeItem={isWithdrawals ? 'withdrawals' : isSettings ? 'payment-methods' : 'overview'} breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: title }]}>
    <div className="finance-container">
      <div className="finance-header"><div><h1>{title}</h1><p>{subtitle}</p></div></div>
      {isSettings ? <SettingsContent /> : isWithdrawals ? <WithdrawalsContent /> : <OverviewContent />}
    </div>
  </SellerLayout>
}
/**
 * Payout and account settings.
 *
 * The template drew a saved bank account, a payout schedule, a tax-registration field and a
 * security block whose every row read "Not available yet". None of it saved anywhere.
 *
 * What is here instead is what Mirwal actually does. Two of those things are deliberate
 * absences rather than missing features, and the page says which:
 *
 *  - No payout schedule. Nothing pays out automatically — a seller requests a withdrawal when
 *    they want one, which is why there is a Withdrawals page and no scheduler.
 */
const SettingsContent = () => {
  const balance = useApiQuery((signal) => api.seller.balance(signal), [])
  const store = useApiQuery((signal) => api.seller.store(signal), [])

  return (
    <>
      <div className="settings-layout">
        <section className="finance-panel settings-card">
          <div className="settings-heading">
            <span className="settings-icon purple"><Icon name="building-columns" /></span>
            <div>
              <h2>Getting paid</h2>
              <p>How money reaches you, and what is available right now.</p>
            </div>
          </div>

          <p className="settings-note">
            Mirwal stores only what a transfer needs &mdash; an account title and an IBAN or wallet number,
            shown masked. No full account numbers beyond the IBAN itself, and nothing that could be used to
            take money out.
          </p>

          <div className="settings-row">
            <span>Available to withdraw</span>
            {/* Net of commission — the figure a seller actually receives, not the gross. */}
            <b>{balance.isLoading ? 'Loading…' : balance.data?.netAmount?.display ?? '—'}</b>
          </div>
          <div className="settings-row">
            <span>Mirwal commission</span>
            <b>{balance.isLoading ? '—' : `${balance.data?.commissionPercent ?? 0}% · ${balance.data?.commissionAmount?.display ?? '—'}`}</b>
          </div>
          <div className="settings-row">
            <span>Minimum withdrawal</span>
            <b>{balance.data?.minimumAmount?.display ?? '—'}</b>
          </div>
          <div className="settings-row">
            <span>Payment methods offered</span>
            <b>Bank transfer, JazzCash, EasyPaisa</b>
          </div>

          <button type="button" className="finance-primary" onClick={() => navigateTo('/finance/withdrawals')}>
            <Icon name="arrow-right" /> Request a withdrawal
          </button>
        </section>

        <PayoutAccount />

        <section className="finance-panel settings-card">
          <div className="settings-heading">
            <span className="settings-icon purple"><Icon name="clock" /></span>
            <div>
              <h2>Payout schedule</h2>
              <p>There isn&rsquo;t one, on purpose.</p>
            </div>
          </div>
          <p className="settings-note">
            Nothing pays out automatically. You request a withdrawal when you want the money, Mirwal reviews
            it, and you can see exactly where each request has got to. A schedule would mean Mirwal deciding
            when you get paid.
          </p>
          <button type="button" className="finance-link" onClick={() => navigateTo('/finance/withdrawals')}>
            <Icon name="list" /> See your withdrawal history
          </button>
        </section>
      </div>

      <div className="settings-layout">
        <section className="finance-panel settings-card">
          <div className="settings-heading">
            <span className="settings-icon purple"><Icon name="building" /></span>
            <div>
              <h2>Business details</h2>
              <p>Who Mirwal is trading with.</p>
            </div>
          </div>
          <div className="settings-row"><span>Store name</span><b>{store.data?.name ?? '—'}</b></div>
          <div className="settings-row"><span>Status</span><b>{store.data?.status ?? '—'}</b></div>
          <p className="settings-note">
            Identity and business documents are handled under Verification, not typed in here &mdash; a tax
            number nobody checks proves nothing.
          </p>
          <button type="button" className="finance-link" onClick={() => navigateTo('/verification')}>
            <Icon name="id-card" /> Verification documents
          </button>
        </section>

        <section className="finance-panel settings-card">
          <div className="settings-heading">
            <span className="settings-icon purple"><Icon name="shield-halved" /></span>
            <div>
              <h2>Security</h2>
              <p>Your account controls your prices and your earnings.</p>
            </div>
          </div>
          <p className="settings-note">
            Change your password, switch on two-factor authentication, and see every device signed in to your
            store.
          </p>
          <button type="button" className="finance-primary" onClick={() => navigateTo('/account/security')}>
            <Icon name="arrow-right" /> Account security
          </button>
        </section>
      </div>
    </>
  )
}
export default FinancePage
