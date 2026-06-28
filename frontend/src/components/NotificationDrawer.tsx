import { memo, useState, useEffect } from 'react'
import { X, Bell, AlertCircle, CheckCircle, Info, Zap, TrendingUp } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { apiGet } from '@/lib/wails'
import { fmtTokens, fmtCost } from '@/lib/utils'

interface Notification {
  id: string
  type: 'info' | 'warning' | 'success' | 'quota' | 'insight'
  title: string
  message: string
  time: string
  read: boolean
  action?: { label: string; onClick: () => void }
}

interface NotificationDrawerProps {
  open: boolean
  onClose: () => void
}

export const NotificationDrawer = memo(function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (open) loadNotifications() }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const loadNotifications = async () => {
    setLoading(true)
    const items: Notification[] = []
    try {
      const status = await apiGet('/ocgt/api/status')
      if (status?.api_key_configured === false) {
        items.push({ id: 'no-api-key', type: 'warning', title: t('status_api_key_not_configured'), message: t('hint_save'), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), read: false, action: { label: t('nav_settings'), onClick: () => { onClose(); window.dispatchEvent(new CustomEvent('nav-to', { detail: 'settings' })) } } })
      }
    } catch {}
    try {
      const quota = await apiGet('/ocgt/api/quota')
      if (quota?.data) {
        const rolling = quota.data.rolling
        if (rolling && rolling.usage_percent > 80) {
          items.push({ id: 'quota-warning', type: 'quota', title: t('quota_title'), message: `${t('quota_rolling')}: ${rolling.usage_percent}% (${rolling.reset_display})`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), read: false })
        }
      }
    } catch {}
    try {
      const summary = await apiGet('/ocgt/api/stats/summary?days=1')
      if (summary?.summary) {
        const s = summary.summary
        if (s.estimated_cost > 5) items.push({ id: 'cost-insight', type: 'insight', title: t('insight_daily_cost'), message: `${t('traf_tokens')}: ${fmtTokens(s.total_tokens)} | ${t('traf_limit')}: ${fmtCost(s.estimated_cost)}`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), read: false })
        if (s.cache_hit_rate < 20 && s.total_tokens > 100000) items.push({ id: 'cache-insight', type: 'insight', title: t('insight_cache_hint'), message: t('insight_cache_msg'), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), read: false })
      }
    } catch {}
    setNotifications(items)
    setLoading(false)
  }

  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  const clearAll = () => setNotifications([])
  const unreadCount = notifications.filter((n) => !n.read).length

  const icons = { info: Info, warning: AlertCircle, success: CheckCircle, quota: Zap, insight: TrendingUp }
  const dotColors: Record<string, string> = { info: 'var(--link)', warning: 'var(--warn)', success: 'var(--online)', quota: 'var(--warn)', insight: 'var(--link)' }

  if (!open) return null

  return (
    <>
      <div className="drawer-overlay on" onClick={onClose} />
      <div className="drawer on" role="dialog" aria-modal="true" aria-label={t('notif_title')}>
        <div className="dh">
          <Bell width={14} height={14} style={{ color: 'var(--link)' }} />
          <h4>{t('notif_title')}</h4>
          {unreadCount > 0 && <span className="tag blue">{unreadCount}</span>}
          <span className="spacer" />
          <button className="x" onClick={onClose} aria-label={t('aria_close')}><X width={16} height={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--line)' }}>
          <button className="btn btn-sm btn-ghost" onClick={markAllRead} disabled={unreadCount === 0}>{t('notif_mark_read')}</button>
          <button className="btn btn-sm btn-ghost" onClick={clearAll} disabled={notifications.length === 0}>{t('notif_clear_all')}</button>
        </div>
        <div className="dbody">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <span className="spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 0', color: 'var(--ink-400)' }}>
              <Bell width={32} height={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: 12 }}>{t('notif_empty')}</p>
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = icons[n.type]
              return (
                <div key={n.id} className={'notif' + (!n.read ? ' unread' : '')}>
                  <span className="dot" style={{ background: n.read ? 'var(--ink-300)' : dotColors[n.type] }} />
                  <div>
                    <div className="row1">
                      <b>{n.title}</b>
                      <time>{n.time}</time>
                    </div>
                    <p>{n.message}</p>
                    {n.action && (
                      <button onClick={n.action.onClick} style={{ fontSize: 11, color: 'var(--link)', marginTop: 4, fontWeight: 500 }}>
                        {n.action.label} →
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
})
