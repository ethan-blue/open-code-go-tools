import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import {
  LayoutDashboard, Settings, Terminal, BarChart3,
  MessagesSquare, Activity, Server,
  Shield, Cloud, Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { I18nProvider, useI18n } from '@/i18n'
import { ToastProvider } from '@/hooks/toast'
import { wails, apiGet, setApiBase, setAuthToken, isWails } from '@/lib/wails'
import { isMacOS } from '@/lib/platform'
import { CommandPalette } from '@/components/CommandPalette'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const TrafficMonitor = lazy(() => import('@/pages/TrafficMonitor'))
const Sessions = lazy(() => import('@/pages/Sessions'))
const TrafficDetail = lazy(() => import('@/pages/TrafficDetail'))
import type { DetailRecord } from '@/pages/TrafficDetail'
const QuickConnect = lazy(() => import('@/pages/QuickConnect'))
const Providers = lazy(() => import('@/pages/Providers'))
const SecurityLimitsPage = lazy(() => import('@/pages/config/SecurityLimitsPage'))
const HubSyncPage = lazy(() => import('@/pages/config/HubSyncPage'))
const PreferencesPage = lazy(() => import('@/pages/app/PreferencesPage'))

type ViewId =
  | 'dashboard' | 'history' | 'sessions'
  | 'terminal' | 'providers'
  | 'security' | 'hub'
  | 'preferences'
  | 'detail'

const SAVED_VIEWS: ViewId[] = [
  'dashboard', 'history', 'sessions', 'terminal', 'providers',
  'security', 'hub',
  'preferences',
]

function AppShell() {
  const { t } = useI18n()
  const [activeView, _setActiveView] = useState<ViewId>(() => {
    const saved = localStorage.getItem('last-view')
    if (saved === 'logs' || saved === 'about') return 'preferences'
    return (saved && SAVED_VIEWS.includes(saved as ViewId)) ? saved as ViewId : 'dashboard'
  })
  const setActiveView = useCallback((view: ViewId) => {
    localStorage.setItem('last-view', view)
    _setActiveView(view)
  }, [])
  const [proxyStatus, setProxyStatus] = useState<'online' | 'connecting' | 'offline'>('connecting')
  const [loading, setLoading] = useState(true)
  const [loadingRetry, setLoadingRetry] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<DetailRecord | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [listenAddr, setListenAddr] = useState('127.0.0.1:8787')
  const [trafficCount, setTrafficCount] = useState(0)
  const [trafficErrorCount, setTrafficErrorCount] = useState(0)
  const [hideTrafficErrors, setHideTrafficErrors] = useState(() => localStorage.getItem('hide-traffic-errors') === '1')

  const initProxy = useCallback(async () => {
    setLoading(true)
    setLoadingRetry(false)
    setProxyStatus('connecting')
    try {
      const addr = await wails.GetListenAddress().catch(() => '127.0.0.1:8787')
      setApiBase(`http://${addr}`)
      setListenAddr(addr)
    } catch {}
    try {
      const token = await wails.GetLocalToken().catch(() => '')
      if (token) setAuthToken(token)
    } catch {}
    let ready = false
    const healthAddr = await wails.GetListenAddress().catch(() => '127.0.0.1:8787')
    const healthAttempts = isWails() ? 30 : 1
    for (let i = 0; i < healthAttempts; i++) {
      try {
        const ac = new AbortController()
        const tm = setTimeout(() => ac.abort(), 2000)
        const resp = await fetch(`http://${healthAddr}/healthz`, { cache: 'no-store', signal: ac.signal })
        clearTimeout(tm)
        if (resp.ok) {
          ready = true
          break
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500))
    }

    if (ready) {
      setProxyStatus('online')
      try {
        const stats = await apiGet('/ocgt/api/stats/summary?days=1')
        if (stats?.summary?.total_requests) setTrafficCount(stats.summary.total_requests)
        setTrafficErrorCount(Math.max(0, (stats?.summary?.total_requests || 0) - (stats?.summary?.success_count || 0)))
      } catch {}
      setLoading(false)
      return
    }

    setProxyStatus('offline')
    setLoadingMsg(t('loading_unavailable_desc'))
    setLoadingRetry(true)
  }, [t])

  useEffect(() => {
    initProxy()
    if (isWails() && (window as any).runtime?.EventsOn) {
      const rt = (window as any).runtime
      rt.EventsOn('show-close-dialog', () => setShowCloseDialog(true))
      rt.EventsOn('show-about-dialog', () => setActiveView('preferences'))
      rt.EventsOn('proxy-error', (msg: string) => { setProxyStatus('offline'); setLoadingMsg(msg) })
      rt.EventsOn('port-conflict', (msg: string) => { setLoadingMsg(msg) })
      rt.EventsOn('nav-to-settings', () => setActiveView('preferences'))
      return () => {
        rt.EventsOff('show-close-dialog')
        rt.EventsOff('show-about-dialog')
        rt.EventsOff('proxy-error')
        rt.EventsOff('port-conflict')
        rt.EventsOff('nav-to-settings')
      }
    }
  }, [initProxy, setActiveView])

  useEffect(() => {
    const navHandler = (e: Event) => {
      const view = (e as CustomEvent).detail as ViewId
      if (SAVED_VIEWS.includes(view)) setActiveView(view)
    }
    window.addEventListener('nav-to', navHandler)
    return () => window.removeEventListener('nav-to', navHandler)
  }, [setActiveView])

  useEffect(() => {
    const handler = () => setHideTrafficErrors(localStorage.getItem('hide-traffic-errors') === '1')
    window.addEventListener('ocgt-prefs-changed', handler)
    return () => window.removeEventListener('ocgt-prefs-changed', handler)
  }, [])

  useEffect(() => {
    const detailHandler = (e: Event) => {
      const record = (e as CustomEvent).detail as DetailRecord
      if (!record) return
      setSelectedRequest(record)
      setActiveView('detail')
    }
    window.addEventListener('nav-to-detail', detailHandler)
    return () => window.removeEventListener('nav-to-detail', detailHandler)
  }, [setActiveView])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape: close dialog
      if (e.key === 'Escape') {
        setShowCloseDialog(false)
        return
      }
      // Ctrl/Cmd + K: toggle command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowPalette(open => !open)
        return
      }
      // Ctrl/Cmd + ,: open preferences
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setActiveView('preferences')
        return
      }
      // Ctrl/Cmd + 1-5: quick nav
      if (e.ctrlKey || e.metaKey) {
        const idx = parseInt(e.key) - 1
        const views: ViewId[] = ['dashboard', 'providers', 'terminal', 'sessions', 'history']
        if (idx >= 0 && idx < views.length) {
          e.preventDefault()
          setActiveView(views[idx])
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setActiveView])

  const navGroups = [
    {
      label: t('nav_group_runtime'),
      items: [
        { id: 'dashboard' as ViewId, label: t('nav_dashboard'), icon: LayoutDashboard },
        { id: 'providers' as ViewId, label: t('nav_providers'), icon: Server },
        { id: 'terminal' as ViewId, label: t('nav_terminal'), icon: Terminal },
      ],
    },
    {
      label: t('nav_group_local'),
      items: [
        { id: 'sessions' as ViewId, label: t('nav_sessions'), icon: MessagesSquare },
        { id: 'history' as ViewId, label: t('nav_history'), icon: BarChart3 },
      ],
    },
    {
      label: t('nav_group_advanced'),
      items: [
        { id: 'security' as ViewId, label: t('sett_section_security'), icon: Shield },
        { id: 'hub' as ViewId, label: t('nav_hub'), icon: Cloud },
      ],
    },
  ]
  const appNavItems = [
    { id: 'preferences' as ViewId, label: t('sett_s05_title'), icon: Settings },
  ]

  const handleTitlebarMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.winbtn, .traffic-lights, .pill, button, a, input, select, textarea')) return
    if (isWails()) wails.StartWindowDrag()
  }, [])

  const isMac = isMacOS()

  if (loading) {
    return (
      <div className="loading-overlay" role="status" aria-label={t('loading_title')}>
        <div className="loading-content">
          {!loadingRetry ? (
            <>
              <div className="loading-spinner" />
              <div className="loading-title">{t('loading_title')}</div>
              <p className="loading-text">{loadingMsg || t('loading_init')}</p>
            </>
          ) : (
            <>
              <div className="loading-icon-error"><Activity width={24} height={24} /></div>
              <div className="loading-title">{t('loading_unavailable_title')}</div>
              <p className="loading-text">{loadingMsg || t('loading_unavailable_desc')}</p>
              <button className="loading-retry-btn" onClick={initProxy}>{t('btn_retry_connection')}</button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div id="app">
        <header id="titlebar" onMouseDown={handleTitlebarMouseDown}>
          {isMac ? (
            <div className="traffic-lights">
              <button className="tl-close" onClick={() => setShowCloseDialog(true)}
                title={t('close_dialog_title')} aria-label={t('close_dialog_title')}>
                <svg viewBox="0 0 8 8"><path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.2" /></svg>
              </button>
              <button className="tl-minimize" onClick={() => { try { (window as any).runtime?.WindowMinimise() } catch {} }}
                title={t('close_dialog_minimize')} aria-label={t('close_dialog_minimize')}>
                <svg viewBox="0 0 8 8"><path d="M1 4H7" stroke="currentColor" strokeWidth="1.2" /></svg>
              </button>
              <button className="tl-maximize" onClick={() => { try { (window as any).runtime?.WindowToggleMaximise() } catch {} }}
                title={t('win_maximize')} aria-label={t('win_maximize')}>
                <svg viewBox="0 0 8 8"><path d="M1 1H7V7H1Z" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
              </button>
            </div>
          ) : (
            <div className="spacer" />
          )}
          <div className="title">
            <span className="spacer" />
          </div>
          <div className="right">
            <span className="pill"><span className={cn('dot', proxyStatus === 'offline' ? 'off' : proxyStatus === 'connecting' ? 'warn' : 'online')} /><span className="mono">{listenAddr}</span></span>
            {!hideTrafficErrors && trafficErrorCount > 0 && <span className="pill titlebar-error"><span className="dot off" /><span className="mono">{trafficErrorCount} {t('dash_errors')}</span></span>}
            {!isMac && (
              <>
                <button className="winbtn" type="button" title={t('close_dialog_minimize')} aria-label={t('close_dialog_minimize')} onClick={() => { try { (window as any).runtime?.WindowMinimise() } catch {} }}>
                  <svg width="11" height="11" viewBox="0 0 12 12"><rect y="5" width="12" height="1.4" fill="currentColor" /></svg>
                </button>
                <button className="winbtn" type="button" title={t('win_maximize')} aria-label={t('win_maximize')} onClick={() => { try { (window as any).runtime?.WindowToggleMaximise() } catch {} }}>
                  <svg width="11" height="11" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
                <button className="winbtn close" type="button" title={t('close_dialog_title')} aria-label={t('close_dialog_title')} onClick={() => setShowCloseDialog(true)}>
                  <svg width="11" height="11" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
              </>
            )}
          </div>
        </header>
        <a href="#page-content" className="skip-link">{t('skip_to_content')}</a>
        <div id="layout">
          <aside id="sidebar" className={showSidebar ? 'mobile-open' : ''}>
            <div className="brand">
              <div className="logo"><img src="/appicon.png" alt="" /></div>
              <div className="name">OCGT</div>
              <span className="v">v4.0</span>
            </div>
            {navGroups.map((group) => (
              <div key={group.label} className="nav-group">
                <div className="section-label">{group.label}</div>
                <nav role="navigation" aria-label={group.label}>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = activeView === item.id
                    return (
                      <a key={item.id} href="#" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setActiveView(item.id); setShowSidebar(false) }}>
                        <Icon className="icn" />
                        {item.label}
                        {item.id === 'history' && trafficCount > 0 && !hideTrafficErrors && <span className="badge">{trafficCount >= 1000 ? `${(trafficCount / 1000).toFixed(1)}k` : trafficCount}</span>}
                      </a>
                    )
                  })}
                </nav>
              </div>
            ))}
            <div className="footer">
              <div className="footer-links" role="navigation" aria-label={t('sett_s05_title')}>
                {appNavItems.map((item) => {
                  const Icon = item.icon
                  const active = activeView === item.id
                  return (
                    <a key={item.id} href="#" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setActiveView(item.id); setShowSidebar(false) }}>
                      <Icon className="icn" />
                      {item.label}
                    </a>
                  )
                })}
              </div>
            </div>
          </aside>

          <main id="main">
            <div id="page-content">
              <Suspense fallback={<div className="loading-page"><div className="spin" /></div>}>
                <div key={activeView} className="fade-enter page">
                  {activeView === 'dashboard' && <ErrorBoundary><Dashboard /></ErrorBoundary>}
                  {activeView === 'terminal' && <ErrorBoundary><QuickConnect /></ErrorBoundary>}
                  {activeView === 'history' && <ErrorBoundary><TrafficMonitor /></ErrorBoundary>}
                  {activeView === 'detail' && <ErrorBoundary><TrafficDetail record={selectedRequest} onBack={() => setActiveView('history')} /></ErrorBoundary>}
                  {activeView === 'sessions' && <ErrorBoundary><Sessions /></ErrorBoundary>}
                  {activeView === 'providers' && <ErrorBoundary><Providers /></ErrorBoundary>}
                  {activeView === 'security' && <ErrorBoundary><SecurityLimitsPage /></ErrorBoundary>}
                  {activeView === 'hub' && <ErrorBoundary><HubSyncPage /></ErrorBoundary>}
                  {activeView === 'preferences' && <ErrorBoundary><PreferencesPage /></ErrorBoundary>}
                </div>
              </Suspense>
            </div>
          </main>
        </div>

        <button
          className="mobile-menu"
          type="button"
          aria-label={t('sidebar_workspace')}
          onClick={() => setShowSidebar((open) => !open)}
        >
          <Menu width={20} height={20} />
        </button>

        {showSidebar && (
          <div className="mobile-sidebar-overlay" onClick={() => setShowSidebar(false)} />
        )}
      </div>

      {showCloseDialog && (
        <div className="modal-overlay on" onClick={() => setShowCloseDialog(false)} role="dialog" aria-modal="true">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="document">
            <div className="mh"><h3>{t('close_dialog_title')}</h3></div>
            <div className="mb">
              <p style={{ margin: 0, color: 'var(--ink-600)', fontSize: 13 }}>{t('close_dialog_msg')}</p>
            </div>
            <div className="mf">
              <button className="btn btn-sm" onClick={() => setShowCloseDialog(false)}>{t('close_dialog_cancel')}</button>
              <button className="btn btn-sm" onClick={async () => { setShowCloseDialog(false); await wails.HideToTray().catch(() => {}) }}>{t('close_dialog_minimize')}</button>
              <button className="btn btn-sm btn-primary" onClick={async () => { setShowCloseDialog(false); await wails.QuitApp().catch(() => {}) }}>{t('close_dialog_exit')}</button>
            </div>
          </div>
        </div>
      )}
      <CommandPalette isOpen={showPalette} onClose={() => setShowPalette(false)} />
    </>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </ToastProvider>
    </I18nProvider>
  )
}



