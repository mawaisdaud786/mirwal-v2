import { useState } from 'react'
import Icon from '@mirwal/shared/Icon'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import api from '../api'

/**
 * What Mirwal tells this seller about, and how.
 *
 * The same account-level preferences the storefront exposes, on the same endpoint — a seller
 * is a user with a store, and the columns behind this are `users.notification_channels` and
 * `users.notification_preferences`, not anything seller-scoped. A second, store-scoped copy
 * would be two sources of truth for one question.
 *
 * Sellers get by far the most messages on Mirwal — an order, a dispatch reminder, a return, a
 * payout, a moderation decision — so this is the panel most likely to be used in anger. Two
 * things it must therefore be honest about:
 *
 *   * **Security cannot be switched off.** A changed payout destination is the cash-out step
 *     of an account takeover; the alert exists for the person who did not do it.
 *
 *   * **Turning a category off does not pause the obligation.** A seller who stops the order
 *     emails still has to dispatch on time, and the dispatch clock keeps running. The copy
 *     says so, because the alternative is a seller discovering it through a late-dispatch
 *     penalty.
 */

const CHANNEL_ICON = { inApp: 'bell', email: 'envelope', sms: 'mobile-screen' }
const CATEGORY_ICON = {
  orders: 'truck', returns: 'rotate-left', account: 'store',
  security: 'shield-halved', marketing: 'tag',
}

export default function NotificationPreferences() {
  const prefs = useApiQuery((signal) => api.notifications.preferences(signal), [])
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')

  if (prefs.isLoading || prefs.error) return null

  const save = async (kind, key, enabled) => {
    setSaving(key)
    setError('')
    try {
      await api.notifications.setPreferences({ [kind]: { [key]: enabled } })
      await prefs.refetch()
    } catch (saveError) { setError(describeApiError(saveError)) } finally { setSaving(null) }
  }

  return (
    <section className="seller-prefs">
      <header>
        <h2>What we tell you about</h2>
        <p>
          Turning something off stops the message, not the work &mdash; your dispatch promise and
          return deadlines keep running either way.
        </p>
      </header>

      {error && <p className="seller-prefs-error" role="alert">{error}</p>}

      <div className="seller-prefs-group">
        <h3>How we reach you</h3>
        {prefs.data.channels.map((channel) => (
          <button
            key={channel.key}
            type="button"
            className="seller-pref"
            disabled={channel.forced || saving === channel.key}
            onClick={() => save('channels', channel.key, !channel.enabled)}
          >
            <Icon name={CHANNEL_ICON[channel.key] ?? 'bell'} />
            <b>
              {channel.label}
              {channel.forced && <small>Always on &mdash; this is your record of what happened.</small>}
            </b>
            <i className={channel.enabled ? 'on' : 'off'}>{channel.enabled ? 'On' : 'Off'}</i>
          </button>
        ))}
      </div>

      <div className="seller-prefs-group">
        <h3>Topics</h3>
        {prefs.data.categories.map((category) => (
          <button
            key={category.key}
            type="button"
            className="seller-pref"
            disabled={category.forced || saving === category.key}
            onClick={() => save('categories', category.key, !category.enabled)}
          >
            <Icon name={CATEGORY_ICON[category.key] ?? 'bell'} />
            <b>
              {category.label}
              <small>
                {category.forced
                  ? 'Always on — these warn you about things you did not do.'
                  : category.description}
              </small>
            </b>
            <i className={category.enabled ? 'on' : 'off'}>{category.enabled ? 'On' : 'Off'}</i>
          </button>
        ))}
      </div>
    </section>
  )
}
