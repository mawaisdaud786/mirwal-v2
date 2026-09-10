import SellerLayout from '../SellerLayout'
import { EmptyState } from '../components/SellerComponents'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import NotificationPreferences from '../components/NotificationPreferences'
import api from '../api'
import { navigateTo } from '@mirwal/shared/navigation'
import Icon from '@mirwal/shared/Icon'
import './seller-notifications.css'

/**
 * Was a fixed, fabricated notification feed ("New order received" referencing the same fake
 * order number used elsewhere in the mock data, a fake "Payout processed"). Now real: the
 * same generic `GET /notifications` a buyer sees, which this account also receives real
 * events on — a new order placed against one of this seller's products, or a buyer requesting
 * a return (server/src/modules/notifications, wired into server/src/modules/orders).
 */
const NOTIFICATION_ICON = {
  new_order: 'bag-shopping',
  return_requested: 'rotate-left',
  item_cancelled: 'circle-xmark',
}

export default function SellerNotifications() {
  const { data: notifications, error, isLoading, refetch } = useApiQuery((signal) => api.notifications.list(signal), [])

  async function openNotification(notification) {
    if (!notification.read) {
      try { await api.notifications.markRead(notification.id) } catch { /* not fatal, still navigate */ }
      refetch()
    }
    if (notification.link) navigateTo(notification.link)
  }

  async function markRead(notification) {
    try { await api.notifications.markRead(notification.id); refetch() } catch { /* surfaced via refetch's own error state on next load */ }
  }

  async function markAllRead() {
    try { await api.notifications.markAllRead(); refetch() } catch { /* surfaced via refetch's own error state on next load */ }
  }

  return <SellerLayout activeItem="notifications" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/') }, { label: 'Notifications' }]}>
    <div className="seller-notifications-page">
      <div className="seller-notifications-header">
        <div><h1>Notifications</h1><p>Stay up to date with activity in your seller account.</p></div>
        {notifications?.some((notification) => !notification.read) && <button type="button" onClick={markAllRead}>Mark all as read</button>}
      </div>

      {isLoading && <EmptyState icon={<Icon name="spinner" />} title="Loading notifications" text="Fetching your notifications…" />}
      {error && !isLoading && (
        <EmptyState icon={<Icon name="triangle-exclamation" />} title="Couldn't load notifications" text={describeApiError(error)} actionLabel="Try again" onAction={refetch} />
      )}

      {!isLoading && !error && (notifications.length === 0 ? (
        <div className="seller-notifications-empty">
          <Icon name="bell" />
          <h2>No notifications yet</h2>
          <p>New orders, cancellations and return requests will show up here.</p>
        </div>
      ) : (
        <div className="seller-notification-list">
          {notifications.map((notification) => (
            <div className={notification.read ? 'seller-notification-row' : 'seller-notification-row unread'} key={notification.id}>
              <span><Icon name={NOTIFICATION_ICON[notification.type] ?? 'bell'} /></span>
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <small>{new Date(notification.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</small>
              </div>
              <div className="seller-notification-actions">
                {notification.link && <button type="button" onClick={() => openNotification(notification)}>View</button>}
                {!notification.read && <button type="button" onClick={() => markRead(notification)}>Mark read</button>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
    {/* The feed answers what happened; this answers what should reach them next time. */}
    <NotificationPreferences />
  </SellerLayout>
}
