import { useState, useEffect, useCallback } from 'react'
import { Terminal, Bot, Monitor, Copy, Check } from 'lucide-react'
import { wails, apiGet } from '@/lib/wails'
import { errMessage } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

interface IntegrationStatus { cli: boolean; vscode: boolean; claudeDesktopApp: boolean; codex: boolean }
interface ClientStats { [key: string]: number }
type ClientLine = 'claude' | 'codex'

function clientBucket(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('codex')) return 'codex'
  if (lower.includes('vscode') || lower.includes('vs code')) return 'vscode'
  if (lower.includes('desktop') || lower.includes('claude app')) return 'desktop'
  if (lower.includes('cli') || lower.includes('claude code')) return 'cli'
  return lower
}

interface Client {
  id: string
  icon: typeof Terminal
  iconBg: 'dark' | 'light'
  iconText?: string
  name: string
  version: string
  desc: string
  installed: boolean
  line: ClientLine
  reqs?: number
  isNew?: boolean
  action: 'open' | 'edit' | 'docs'
}

export default function QuickConnect() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [intStatus, setIntStatus] = useState<IntegrationStatus>({ cli: false, vscode: false, claudeDesktopApp: false, codex: false })
  const [clientStats, setClientStats] = useState<ClientStats>({})
  const [localToken, setLocalToken] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [configReady, setConfigReady] = useState(true)
  const [lineFilter, setLineFilter] = useState<ClientLine>('claude')

  const checkIntegrations = useCallback(async () => {
    try {
      const [cli, vscode, claudeDesktopApp, codex] = await Promise.all([
        wails.IsSystemEnvConfigured().catch(() => false),
        wails.IsVSCodeConfigured().catch(() => false),
        wails.IsClaudeDesktopAppConfigured().catch(() => false),
        wails.IsCodexConfigured().catch(() => false),
      ])
      setIntStatus({ cli, vscode, claudeDesktopApp, codex })
    } catch {}
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const stats = await apiGet('/ocgt/api/stats/summary?days=1')
      if (stats?.by_client) {
        const m: ClientStats = {}
        stats.by_client.forEach((c: { name: string; requests: number }) => { m[clientBucket(c.name)] = c.requests })
        setClientStats(m)
      }
    } catch {}
  }, [])

  const loadConfigStatus = useCallback(async () => {
    try {
      const status = await apiGet('/ocgt/api/status')
      const line = status?.providers?.[lineFilter]
      // ponytail: entry gate only; backend install actions still own real validation.
      setConfigReady(!!line?.api_key_configured && !!line?.default_model)
    } catch {
      setConfigReady(false)
    }
  }, [lineFilter])

  useEffect(() => {
    checkIntegrations(); loadStats(); loadConfigStatus()
    wails.GetLocalToken().then(token => setLocalToken(token || '')).catch(() => {})
    const timer = setInterval(() => { checkIntegrations(); loadStats(); loadConfigStatus() }, 12000)
    return () => clearInterval(timer)
  }, [checkIntegrations, loadStats, loadConfigStatus])

  const handleInstall = async (type: string) => {
    try {
      let result: string
      switch (type) { case 'claude': case 'cli': result = await wails.InstallClaudeUserEnv(); break; case 'codex': result = await wails.SetupCodex(); break; case 'desktop': result = await wails.SetupClaudeDesktopApp(); break; default: return }
      if (result === 'success') { toast(t('qc_install_ok'), 'success'); setTimeout(checkIntegrations, 350) }
      else { toast(t('qc_install_fail') + ': ' + result, 'error') }
    } catch (err: unknown) { toast(t('qc_install_fail') + ': ' + errMessage(err), 'error') }
  }

  const handleRemove = async (type: string) => {
    if (!confirm(t('prov_confirm_delete'))) return
    try {
      let result: string
      switch (type) {
        case 'claude':
        case 'cli':
          result = await wails.ClearSystemEnv()
          if (result === 'success') await wails.RemoveVSCodeEnv().catch(() => 'success')
          break
        case 'codex': result = await wails.ClearCodex(); break
        case 'desktop': result = await wails.ClearClaudeDesktopApp(); break
        default: return
      }
      if (result === 'success') { toast(t('qc_remove_ok'), 'success'); setTimeout(checkIntegrations, 350) }
      else { toast(t('qc_remove_fail') + ': ' + result, 'error') }
    } catch (err: unknown) { toast(t('qc_remove_fail') + ': ' + errMessage(err), 'error') }
  }

  const handleCopyToken = useCallback(async () => {
    if (!localToken) return
    try { await navigator.clipboard.writeText(localToken); setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000) } catch {}
  }, [localToken])

  const allClients: Client[] = [
    {
      id: 'claude',
      icon: Terminal,
      iconBg: 'dark',
      iconText: 'CC',
      name: 'Claude Code / VS Code',
      version: 'shared Claude config',
      desc: t('qc_claude_code_desc'),
      installed: intStatus.cli || intStatus.vscode,
      line: 'claude',
      reqs: (clientStats.cli || 0) + (clientStats.vscode || 0),
      action: 'open',
    },
    { id: 'desktop', icon: Monitor, iconBg: 'light', name: 'Claude Desktop', version: '3P profile', desc: t('qc_desktop_desc'), installed: intStatus.claudeDesktopApp, line: 'claude', action: 'docs' },
    { id: 'codex', icon: Bot, iconBg: 'dark', iconText: 'CX', name: 'Codex CLI', version: 'cli', desc: t('qc_codex_desc'), installed: intStatus.codex, line: 'codex', action: 'edit' },
  ]
  const visibleClients = allClients.filter(client => client.line === lineFilter)

  const renderClientCard = (client: Client) => {
    const Icon = client.icon
    const reqs = client.reqs ?? clientStats[client.id] ?? 0
    return (
      <div className={`conn-card${client.isNew ? ' is-new-corner' : ''}`} key={client.id}>
        <div className="head">
          <div className={`ic-lg ${client.iconBg === 'light' ? 'alt' : ''}`}>
            {client.iconText ? <span style={{ fontSize: 13, fontWeight: 600 }}>{client.iconText}</span> : <Icon width={20} height={20} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3>{client.name}</h3>
            <div className="sub">{client.version}</div>
          </div>
        </div>
        <p>{client.desc}</p>
        <div className={`status ${client.installed ? 'installed' : 'missing'}`}>
          <span className="dot" />
          {client.installed ? `${reqs.toLocaleString()} ${t('qc_reqs_24h')}` : t('qc_not_installed')}
        </div>
        <div className="meta">
          <span className="spacer" />
          {client.installed
            ? <button className="btn btn-sm" onClick={() => handleRemove(client.id)}>{t('qc_remove')}</button>
            : <button className="btn btn-sm btn-primary" onClick={() => handleInstall(client.id)}>{t('qc_install')}</button>}
        </div>
      </div>
    )
  }

  return (
    <div id="page-connect">
      <div className="page">
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <div className="segmented" aria-label="Client line">
            <button className={lineFilter === 'claude' ? 'on' : ''} onClick={() => setLineFilter('claude')}>Claude</button>
            <button className={lineFilter === 'codex' ? 'on' : ''} onClick={() => setLineFilter('codex')}>Codex</button>
          </div>
        </div>

        {!configReady && (
          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <div className="row between" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <b style={{ fontSize: 13 }}>{t('status_api_key_not_configured')}</b>
                <p className="muted tiny" style={{ marginTop: 4 }}>Configure provider credentials and model mapping before installing client integrations.</p>
              </div>
              <div className="row gap-2">
                <button className="btn btn-sm btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('nav-to', { detail: 'providers' }))}>{t('nav_providers')}</button>
              </div>
            </div>
          </div>
        )}

        <div className="conn-grid">
          {visibleClients.map(renderClientCard)}
        </div>

        {/* Local access token reuses card styling for visual consistency. */}
        <section className="conn-group">
          <div className="conn-group-head">
            <Copy width={12} height={12} />
            {t('sett_local_token')}
          </div>
          <div className="conn-card" style={{ flex: '1 1 100%', maxWidth: 'none', flexDirection: 'column' }}>
            <div className="row between" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ minWidth: 200, flex: 1 }}>
                <b style={{ fontSize: 13 }}>{t('sett_local_token')}</b>
                <p style={{ margin: '4px 0 0' }}>{t('sett_token_hint')}</p>
              </div>
              <div className="input-wrap" style={{ flex: '1 1 320px', maxWidth: 420 }}>
                <input className="input" readOnly value={localToken || '********'} type={localToken ? 'password' : 'text'} />
                <button className="suffix-btn" onClick={handleCopyToken} title={t('btn_copy')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px' }}>
                  {copyFeedback ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
