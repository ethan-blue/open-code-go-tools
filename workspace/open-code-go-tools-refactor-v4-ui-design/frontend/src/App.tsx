import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import {
  LayoutDashboard, Settings, Terminal, BarChart3,
  MessagesSquare, X, Activity, Server,
  Sun, Moon, Monitor, Bot, Bell, Search,
  RefreshCw, UserCircle,
  Home, HelpCircle, Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { I18nProvider, useI18n } from '@/i18n'
import { ToastProvider, useToast } from '@/hooks/toast'
import { wails, apiGet, apiFetch, setApiBase, setAuthToken, isWails } from '@/lib/wails'
import { isMacOS } from '@/lib/platform'
import { ShortcutsModal } from '@/components/ShortcutsModal'
import { NotificationDrawer } from '@/components/NotificationDrawer'
import { CommandPalette } from '@/components/CommandPalette'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AccountPopover } from '@/components/AccountPopover'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const QuickConnect = lazy(() => import('@/pages/QuickConnect'))
const TrafficMonitor = lazy(() => import('@/pages/TrafficMonitor'))
const Sessions = lazy(() => import('@/pages/Sessions'))
const Copilot = lazy(() => import('@/pages/Copilot'))
const Hub = lazy(() => import('@/pages/Hub'))
const Providers = lazy(() => import('@/pages/Providers'))
const TrafficDetail = lazy(() => import('@/pages/TrafficDetail'))
import type { DetailRecord } from '@/pages/TrafficDetail'

type ViewId = 'dashboard' | 'providers' | 'settings' | 'terminal' | 'history' | 'detail' | 'sessions' | 'copilot' | 'hub'

const ACCENT_PRESETS = [
  { hue: 174, name: 'Teal' },
  { hue: 212, name: 'Blue' },
  { hue: 260, name: 'Purple' },
  { hue: 25, name: 'Orange' },
  { hue: 330, name: 'Pink' },
]

function AppShell() {
  const { t, lang, setLang } = useI18n()
  const [activeView, _setActiveView] = useState<ViewId>(() => {
    const saved = localStorage.getItem('last-view');
    const validViews = ['dashboard','settings','terminal','history','sessions','copilot','hub','providers'];
    return (saved && validViews.includes(saved)) ? saved as ViewId : 'dashboard';
  })
  
  const setActiveView = useCallback((view: ViewId) => {
    localStorage.setItem('last-view', view);
    _setActiveView(view);
  }, [])
  const [proxyStatus, setProxyStatus] = useState<'online' | 'connecting' | 'offline'>('connecting')
  const [loading, setLoading] = useState(true)
  const [loadingRetry, setLoadingRetry] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [showAccountPopover, setShowAccountPopover] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<DetailRecord | null>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system')
  const [accentHue, setAccentHue] = useState(() => Number(localStorage.getItem('accent-hue')) || 174)
  const [showSidebar, setShowSidebar] = useState(false)
  const [appVersion, setAppVersion] = useState('v2.2.1')
  const [listenAddr, setListenAddr] = useState('127.0.0.1:8787')
  const [profiles, setProfiles] = useState<string[]>([])
  const [activeProfile, setActiveProfile] = useState('')
  const [trafficCount, setTrafficCount] = useState(0)

  const applyTheme = useCallback((t: string) => {
    const resolved = t === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t
    document.documentElement.setAttribute('data-theme', resolved)
    localStorage.setItem('theme', t)
    setTheme(t)
  }, [])

  const applyAccent = useCallback((hue: number) => {
    document.documentElement.style.setProperty('--accent-h', String(hue))
    localStorage.setItem('accent-hue', String(hue))
    setAccentHue(hue)
  }, [])

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
    setLoading(false)
    let ready = false
    const healthAddr = await wails.GetListenAddress().catch(() => '127.0.0.1:8787')
    const healthAttempts = isWails() ? 30 : 1
    for (let i = 0; i < healthAttempts; i++) {
      try {
        const resp = await fetch(`http://${healthAddr}/healthz`, { cache: 'no-store' })
        if (resp.ok) { ready = true; break }
      } catch {}
      await new Promise((r) => setTimeout(r, 500))
    }
    
    // It's possible the component unmounted or another init Proxy was called
    // A simple check but might be better using AbortController in a real app

    if (ready) {
      setProxyStatus('online')
      try { const ver = await apiGet('/ocgt/api/version'); if (ver?.version) setAppVersion(`v${ver.version}`) } catch {}
      try { const prof = await apiGet('/ocgt/api/profiles'); if (prof?.profiles) { setProfiles(Object.keys(prof.profiles)); setActiveProfile(prof.active_profile || '') } } catch {}
      try { const stats = await apiGet('/ocgt/api/stats/summary?days=1'); if (stats?.summary?.total_requests) setTrafficCount(stats.summary.total_requests) } catch {}
    } else {
      setProxyStatus('offline')
      setLoadingMsg(t('loading_unavailable_desc'))
    }
  }, [t])

  useEffect(() => {
    initProxy()
    if (isWails() && (window as any).runtime?.EventsOn) {
      const rt = (window as any).runtime
      rt.EventsOn('show-close-dialog', () => setShowCloseDialog(true))
      rt.EventsOn('show-about-dialog', () => setShowAbout(true))
      rt.EventsOn('proxy-error', (msg: string) => { setProxyStatus('offline'); setLoadingMsg(msg) })
      rt.EventsOn('nav-to-settings', () => setActiveView('settings'))
      return () => {
        rt.EventsOff('show-close-dialog')
        rt.EventsOff('show-about-dialog')
        rt.EventsOff('proxy-error')
        rt.EventsOff('nav-to-settings')
      }
    }
  }, [initProxy])

  // Listen for nav-to events from child components
  useEffect(() => {
    const navHandler = (e: Event) => {
      const view = (e as CustomEvent).detail as ViewId
      if (view) setActiveView(view)
    }
    window.addEventListener('nav-to', navHandler)
    return () => window.removeEventListener('nav-to', navHandler)
  }, [])

  // Listen for nav-to-detail events (request detail page)
  useEffect(() => {
    const detailHandler = (e: Event) => {
      const record = (e as CustomEvent).detail as DetailRecord
      if (record) {
        setSelectedRequest(record)
        setActiveView('detail')
      }
    }
    window.addEventListener('nav-to-detail', detailHandler)
    return () => window.removeEventListener('nav-to-detail', detailHandler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCloseDialog(false); setShowAbout(false); setShowPrefs(false); setShowShortcuts(false); setShowNotifications(false) }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) { const target = e.target as HTMLElement; if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') { e.preventDefault(); setShowShortcuts(true) } }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setShowPrefs(true) }
      if (e.ctrlKey || e.metaKey) {
        const idx = parseInt(e.key) - 1
        const views: ViewId[] = ['dashboard', 'terminal', 'history', 'sessions', 'copilot', 'hub', 'settings']
        if (idx >= 0 && idx < views.length) { e.preventDefault(); setActiveView(views[idx]) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowPalette(p => !p)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const NAV_ITEMS = [
    { id: 'dashboard' as ViewId, label: t('nav_dashboard'), icon: LayoutDashboard, shortcut: '1' },
    { id: 'terminal' as ViewId, label: t('nav_terminal'), icon: Terminal, shortcut: '2' },
    { id: 'history' as ViewId, label: t('nav_history'), icon: BarChart3, shortcut: '3' },
    { id: 'sessions' as ViewId, label: t('nav_sessions'), icon: MessagesSquare, shortcut: '4' },
    { id: 'copilot' as ViewId, label: t('nav_copilot'), icon: Bot, shortcut: '5' },
    { id: 'hub' as ViewId, label: t('nav_hub'), icon: Activity, shortcut: '6' },
    { id: 'providers' as ViewId, label: t('nav_providers'), icon: Server, shortcut: '7' },
    { id: 'settings' as ViewId, label: t('nav_settings'), icon: Settings, shortcut: '8' },
  ]

  const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
    dashboard: { title: t('title_dashboard'), subtitle: t('subtitle_dashboard') },
    settings: { title: t('title_settings'), subtitle: t('subtitle_settings') },
    terminal: { title: t('title_terminal'), subtitle: t('subtitle_terminal') },
    history: { title: t('title_history'), subtitle: t('subtitle_history') },
    sessions: { title: t('title_sessions'), subtitle: t('subtitle_sessions') },
    copilot: { title: t('title_copilot'), subtitle: t('subtitle_copilot') },
    hub: { title: t('title_hub'), subtitle: t('subtitle_hub') },
    providers: { title: t('title_providers'), subtitle: t('subtitle_providers') },
    detail: { title: 'Request Detail', subtitle: 'A single request, unfolded' },
  }
  const currentMeta = VIEW_META[activeView]

  const handleTitlebarMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.winbtn, .traffic-lights, .pill, button, a, input, select, textarea')) return
    if (isWails()) { wails.StartWindowDrag() }
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
              <p className="loading-text">{t('loading_init')}</p>
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
            /* macOS: traffic lights on the left */
            <div className="traffic-lights">
              <button className="tl-close" onClick={() => setShowCloseDialog(true)}
                title={t('close_dialog_title')} aria-label={t('close_dialog_title')}>
                <svg viewBox="0 0 8 8"><path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
              <button className="tl-minimize" onClick={() => { try { (window as any).runtime?.WindowMinimise() } catch {} }}
                title={t('close_dialog_minimize')} aria-label={t('close_dialog_minimize')}>
                <svg viewBox="0 0 8 8"><path d="M1 4H7" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
              <button className="tl-maximize" onClick={() => { try { (window as any).runtime?.WindowToggleMaximise() } catch {} }}
                title="Maximize" aria-label="Maximize">
                <svg viewBox="0 0 8 8"><path d="M1 1H7V7H1Z" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
              </button>
            </div>
          ) : (
            <div className="spacer" />
          )}
          <div className="title">
            <span className="dot" />
            OCGT <span className="muted">·</span> <span className="muted">{activeProfile || 'local'} · {proxyStatus === 'online' ? 'running' : proxyStatus}</span>
          </div>
          <div className="right">
            <span className="pill"><span className={cn('dot', proxyStatus === 'offline' ? 'off' : proxyStatus === 'connecting' ? 'warn' : 'online')} /><span className="mono">{listenAddr}</span></span>
            <span className="pill mono">{appVersion}</span>
            {!isMac && (
              <>
                <button className="winbtn" type="button" title={t('close_dialog_minimize')} aria-label={t('close_dialog_minimize')} onClick={() => { try { (window as any).runtime?.WindowMinimise() } catch {} }}>
                  <svg width="11" height="11" viewBox="0 0 12 12"><rect y="5" width="12" height="1.4" fill="currentColor"/></svg>
                </button>
                <button className="winbtn" type="button" title="Maximize" aria-label="Maximize" onClick={() => { try { (window as any).runtime?.WindowToggleMaximise() } catch {} }}>
                  <svg width="11" height="11" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>
                </button>
                <button className="winbtn close" type="button" title={t('close_dialog_title')} aria-label={t('close_dialog_title')} onClick={() => setShowCloseDialog(true)}>
                  <svg width="11" height="11" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.4"/></svg>
                </button>
              </>
            )}
          </div>
        </header>
        <a href="#page-content" className="skip-link">{t('skip_to_content')}</a>
        <div id="layout">
          <aside id="sidebar" className={showSidebar ? 'mobile-open' : ''}>
            <div className="brand">
              <div className="logo">O</div>
              <div className="name">OCGT</div>
              <span className="v">v4.0</span>
            </div>
            <button className="ws" type="button" onClick={() => setActiveView('settings')}>
              <div className="avatar">{(activeProfile || 'L')[0].toUpperCase()}</div>
              <div className="meta"><b>{activeProfile || 'local'}</b><span>{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</span></div>
              <UserCircle className="chev" width={14} height={14} />
            </button>
            <div className="section-label">{t('sidebar_workspace')}</div>
            <nav role="navigation" aria-label={t('sidebar_workspace')}>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const active = activeView === item.id
                return (
                  <a key={item.id} href="#" data-view={item.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setActiveView(item.id); setShowSidebar(false) }}>
                    <Icon className="icn" />
                    {item.label}
                    {item.id === 'history' && trafficCount > 0 && <span className="badge">{trafficCount >= 1000 ? `${(trafficCount / 1000).toFixed(1)}k` : trafficCount}</span>}
                    {item.id === 'copilot' && <span className="badge" style={{ background: 'linear-gradient(135deg,var(--link),var(--violet))', color: '#fff' }}>AI</span>}
                  </a>
                )
              })}
            </nav>
            {profiles.length > 0 && (
              <>
                <div className="section-label">{t('sidebar_profiles')}</div>
                <nav role="navigation" aria-label={t('sidebar_profiles')}>
                  {profiles.map((p) => (
                    <a key={p} href="#" className={p === activeProfile ? 'active' : ''} onClick={(e) => {
                      e.preventDefault()
                      apiFetch('/ocgt/api/profiles/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: p }) })
                        .then(() => { setActiveProfile(p); initProxy() })
                        .catch(() => {})
                    }}>
                      <svg className="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></svg>
                      {p}
                      {p === activeProfile && <span className="badge">live</span>}
                    </a>
                  ))}
                </nav>
              </>
            )}
          </aside>

          <main id="main">
            <div id="topbar">
              <div className="crumbs">
                <Home width={14} height={14} />
                <span>{activeProfile || 'local'}</span><span className="sep">/</span>
                <b>{currentMeta.title}</b>
              </div>
              <button type="button" className="search" onClick={() => setShowPalette(true)}>
                <Search width={14} height={14} />
                <span className="ph">{t('cmd_placeholder')}</span>
                <span className="kbd">⌘K</span>
              </button>
              <div className="tools">
                <button className="iconbtn" type="button" title={t('btn_help')} aria-label={t('btn_help')} onClick={() => setShowShortcuts(true)}><HelpCircle width={15} height={15} /></button>
                <button className="iconbtn" type="button" title={t('btn_notifications')} aria-label={t('btn_notifications')} onClick={() => setShowNotifications(true)}><Bell width={15} height={15} /></button>
                <button className="iconbtn" type="button" title={t('btn_theme')} aria-label={t('btn_theme')} onClick={() => {
                  const next = theme === 'dark' ? 'light' : 'dark'; applyTheme(next)
                }}>{theme === 'dark' ? <Sun width={15} height={15} /> : <Moon width={15} height={15} />}</button>
                <button className="me" type="button" onClick={() => setShowAccountPopover(!showAccountPopover)}>
                  <span className="av">{(activeProfile || 'U')[0].toUpperCase()}</span>
                  <span>{activeProfile || 'User'}</span>
                </button>
              </div>
            </div>
            <div id="page-content">
              <Suspense fallback={<div className="loading-page"><div className="spin" /></div>}>
              <div key={activeView} className="fade-enter page">
                {activeView === 'dashboard' && <ErrorBoundary><Dashboard /></ErrorBoundary>}
                {activeView === 'settings' && <ErrorBoundary><SettingsPage /></ErrorBoundary>}
                {activeView === 'terminal' && <ErrorBoundary><QuickConnect /></ErrorBoundary>}
                {activeView === 'history' && <ErrorBoundary><TrafficMonitor /></ErrorBoundary>}
                {activeView === 'detail' && <ErrorBoundary><TrafficDetail record={selectedRequest} onBack={() => setActiveView('history')} /></ErrorBoundary>}
                {activeView === 'sessions' && <ErrorBoundary><Sessions /></ErrorBoundary>}
                {activeView === 'copilot' && <ErrorBoundary><Copilot /></ErrorBoundary>}
                {activeView === 'hub' && <ErrorBoundary><Hub /></ErrorBoundary>}
                {activeView === 'providers' && <ErrorBoundary><Providers /></ErrorBoundary>}
              </div>
              </Suspense>
            </div>
          </main>
        </div>

        {/* Mobile menu toggle — visible at ≤720px via CSS */}
        <button
          className="mobile-menu"
          type="button"
          aria-label={t('sidebar_workspace')}
          onClick={() => setShowSidebar((v) => !v)}
        >
          <Menu width={20} height={20} />
        </button>

        {/* Mobile sidebar overlay */}
        {showSidebar && (
          <div className="mobile-sidebar-overlay" onClick={() => setShowSidebar(false)} />
        )}
      </div>

      {/* Account Popover */}
      <AccountPopover
        open={showAccountPopover}
        onClose={() => setShowAccountPopover(false)}
        onNavigate={(view) => setActiveView(view as ViewId)}
        profile={activeProfile}
        onThemeToggle={() => {
          const next = theme === 'dark' ? 'light' : 'dark'
          applyTheme(next)
        }}
      />

      {/* Close Dialog */}
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

      {/* About Dialog */}
      {showAbout && (
        <div className="modal-overlay on" onClick={() => setShowAbout(false)} role="dialog" aria-modal="true">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="document">
            <div className="mh">
              <Activity width={16} height={16} />
              <h3 style={{ marginLeft: 8 }}>ocgt</h3>
              <span className="dim" style={{ marginLeft: 8, fontSize: 11 }}>{appVersion}</span>
              <span className="spacer" />
              <button className="x" aria-label="Close" onClick={() => setShowAbout(false)}><X width={16} height={16} /></button>
            </div>
            <div className="mb">
              <p style={{ color: 'var(--ink-600)', fontSize: 13, margin: '0 0 12px' }}>{t('about_desc')}</p>
              <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                <p>{t('about_author')}: ethan-blue</p>
                <p>{t('about_license')}: MIT</p>
              </div>
            </div>
            <div className="mf">
              <button className="btn btn-sm" onClick={() => setShowAbout(false)}>{t('about_close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Preferences Dialog */}
      {showPrefs && (
        <div className="modal-overlay on" onClick={() => setShowPrefs(false)} role="dialog" aria-modal="true">
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()} role="document">
            <div className="mh">
              <h3>{t('pref_title')}</h3>
              <span className="spacer" />
              <button className="x" aria-label="Close" onClick={() => setShowPrefs(false)}><X width={16} height={16} /></button>
            </div>
            <div className="mb">
              <div className="prefs-section">
                <p className="prefs-section-title">{t('pref_appearance')}</p>
                <p className="prefs-section-desc">{t('pref_appearance_desc')}</p>
                <div className="prefs-fields">
                  <div>
                    <label className="prefs-label">{t('pref_theme')}</label>
                    <div className="prefs-theme-group">
                      {[
                        { v: 'light', icon: Sun, l: t('pref_theme_light') },
                        { v: 'dark', icon: Moon, l: t('pref_theme_dark') },
                        { v: 'system', icon: Monitor, l: t('pref_theme_system') },
                      ].map(({ v, icon: Icon, l }) => (
                        <button key={v} onClick={() => applyTheme(v)} className={cn('prefs-theme-btn', theme === v && 'active')}>
                          <Icon width={14} height={14} /> {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="prefs-label">{t('pref_accent_color')}</label>
                    <div className="prefs-accent-group">
                      {ACCENT_PRESETS.map(({ hue, name }) => (
                        <button key={hue} onClick={() => applyAccent(hue)} title={name}
                          className={cn('prefs-accent-dot', accentHue === hue && 'active')} aria-label={name}
                          style={{ background: `hsl(${hue}, 85%, 55%)` }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="prefs-label">{t('pref_language')}</label>
                    <select className="select" value={lang} onChange={(e) => setLang(e.target.value as 'zh' | 'en')} style={{ width: 160 }}>
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="prefs-section">
                <p className="prefs-section-title">{t('pref_behavior')}</p>
                <p className="prefs-section-desc">{t('pref_behavior_desc')}</p>
                <button className="btn btn-sm" onClick={async () => { try { await wails.OpenConfigLocation() } catch {} }}>{t('btn_open_folder')}</button>
              </div>
              <div className="prefs-section">
                <p className="prefs-section-title">{t('pref_danger')}</p>
                <p className="prefs-section-desc">{t('pref_danger_desc')}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => { setShowPrefs(false); setShowAbout(true) }}>{t('btn_about_app')}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <NotificationDrawer open={showNotifications} onClose={() => setShowNotifications(false)} />
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
