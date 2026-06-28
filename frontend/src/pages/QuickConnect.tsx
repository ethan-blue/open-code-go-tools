import { useState, useEffect, useCallback } from 'react'
import { Terminal, Code2, Bot, Monitor, Plus, Copy, Check } from 'lucide-react'
import { wails, apiGet } from '@/lib/wails'
import { errMessage } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { AgentLine } from '@/lib/types'

interface IntegrationStatus { cli: boolean; vscode: boolean; claudeDesktopApp: boolean; codex: boolean }
interface ClientStats { [key: string]: number }

interface Client {
  id: string
  icon: typeof Terminal
  iconBg: 'dark' | 'light'
  iconText?: string
  name: string
  version: string
  desc: string
  installed: boolean
  line: AgentLine
  isNew?: boolean
  actions: string[]
}

export default function QuickConnect() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [lineFilter, setLineFilter] = useState<'all' | AgentLine>('all')
  const [intStatus, setIntStatus] = useState<IntegrationStatus>({ cli: false, vscode: false, claudeDesktopApp: false, codex: false })
  const [clientStats, setClientStats] = useState<ClientStats>({})
  const [localToken, setLocalToken] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)

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
      if (stats?.by_client) { const m: ClientStats = {}; stats.by_client.forEach((c: { name: string; requests: number }) => { m[c.name.toLowerCase()] = c.requests }); setClientStats(m) }
    } catch {}
  }, [])

  useEffect(() => {
    checkIntegrations(); loadStats()
    wails.GetLocalToken().then(token => setLocalToken(token || '')).catch(() => {})
    const timer = setInterval(() => { checkIntegrations(); loadStats() }, 12000)
    return () => clearInterval(timer)
  }, [checkIntegrations, loadStats])

  const handleInstall = async (type: string) => {
    try {
      let result: string
      switch (type) { case 'cli': result = await wails.InstallClaudeUserEnv(); break; case 'vscode': result = await wails.InstallVSCodeEnv(); break; case 'codex': result = await wails.SetupCodex(); break; case 'desktop': result = await wails.SetupClaudeDesktopApp(); break; default: return }
      if (result === 'success') { toast(t('qc_install_ok'), 'success'); setTimeout(checkIntegrations, 350) }
      else { toast(t('qc_install_fail') + ': ' + result, 'error') }
    } catch (err: unknown) { toast(t('qc_install_fail') + ': ' + errMessage(err), 'error') }
  }

  const handleRemove = async (type: string) => {
    if (!confirm(t('prov_confirm_delete'))) return
    try {
      let result: string
      switch (type) { case 'cli': result = await wails.ClearSystemEnv(); break; case 'vscode': result = await wails.RemoveVSCodeEnv(); break; case 'codex': result = await wails.ClearCodex(); break; case 'desktop': result = await wails.ClearClaudeDesktopApp(); break; default: return }
      if (result === 'success') { toast(t('qc_remove_ok'), 'success'); setTimeout(checkIntegrations, 350) }
      else { toast(t('qc_remove_fail') + ': ' + result, 'error') }
    } catch (err: unknown) { toast(t('qc_remove_fail') + ': ' + errMessage(err), 'error') }
  }

  const handleCopyToken = useCallback(async () => {
    if (!localToken) return
    try { await navigator.clipboard.writeText(localToken); setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000) } catch {}
  }, [localToken])

  const allClients: Client[] = [
    { id: 'cli', icon: Terminal, iconBg: 'dark', iconText: 'CC', name: 'Claude Code', version: 'cli · v0.9.4', desc: t('qc_claude_code_desc'), installed: intStatus.cli, line: 'claude', actions: ['open', 'remove'] },
    { id: 'vscode', icon: Code2, iconBg: 'light', name: 'VS Code', version: 'extension · workspace', desc: t('qc_vscode_desc'), installed: intStatus.vscode, line: 'claude', actions: ['open', 'remove'] },
    { id: 'desktop', icon: Monitor, iconBg: 'light', name: 'Claude Desktop', version: 'app · MCP server', desc: t('qc_desktop_desc'), installed: intStatus.claudeDesktopApp, line: 'claude', actions: ['docs', 'install'] },
    { id: 'cursor', icon: Code2, iconBg: 'light', name: 'Cursor', version: 'editor · beta', desc: t('qc_cursor_desc'), installed: false, line: 'claude', isNew: true, actions: ['docs', 'install'] },
    { id: 'codex', icon: Bot, iconBg: 'dark', iconText: 'CX', name: 'Codex CLI', version: 'cli · v1.2.0', desc: t('qc_codex_desc'), installed: intStatus.codex, line: 'codex', actions: ['edit', 'remove'] },
  ]

  const LINE_COLORS: Record<AgentLine, string> = { claude: '#d97706', codex: '#16a34a' }
  const LINE_LABELS: Record<AgentLine, string> = { claude: 'Claude 系', codex: 'Codex 系' }
  // Build groups: either a single filtered line, or both (in fixed order) when 'all'.
  const groups: AgentLine[] = lineFilter === 'all' ? ['claude', 'codex'] : [lineFilter]

  const renderClientCard = (client: Client) => {
    const Icon = client.icon
    const reqs = clientStats[client.id] || 0
    const lineColor = LINE_COLORS[client.line]
    return (
      <div className={`conn-card${client.isNew ? ' is-new-corner' : ''}`} key={client.id}>
        <div className="head">
          <div className={`ic-lg ${client.iconBg === 'light' ? 'alt' : ''}`}>
            {client.iconText ? <span style={{ fontSize: 13, fontWeight: 600 }}>{client.iconText}</span> : <Icon width={20} height={20} />}
            <span className="line-chip" style={{ background: lineColor }} title={LINE_LABELS[client.line]} />
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
          {client.actions[0] === 'open' && client.installed && <button className="btn btn-sm btn-ghost" onClick={() => wails.OpenConfigLocation()}>{t('qc_open_config')}</button>}
          {client.actions[0] === 'edit' && client.installed && <button className="btn btn-sm btn-ghost" onClick={() => wails.OpenConfigLocation()}>{t('qc_edit_config')}</button>}
          {client.actions[0] === 'docs' && <button className="btn btn-sm btn-ghost" onClick={() => { try { (window as any).runtime.BrowserOpenURL('https://github.com/ethan-blue/open-code-go-tools') } catch {} }}>{t('qc_docs')}</button>}
          {client.actions[1] === 'remove' && client.installed
            ? <button className="btn btn-sm" onClick={() => handleRemove(client.id)}>{t('qc_remove')}</button>
            : client.actions[1] === 'install' ? <button className="btn btn-sm btn-primary" onClick={() => handleInstall(client.id)}>{t('qc_install')}</button> : null}
        </div>
      </div>
    )
  }

  return (
    <div id="page-connect">
      <div className="page">
        <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <div className="segmented">
            <button className={lineFilter === 'all' ? 'on' : ''} onClick={() => setLineFilter('all')}>{t('qc_filter_all')}</button>
            <button className={lineFilter === 'claude' ? 'on' : ''} onClick={() => setLineFilter('claude')}>Claude</button>
            <button className={lineFilter === 'codex' ? 'on' : ''} onClick={() => setLineFilter('codex')}>Codex</button>
          </div>
        </div>

        {groups.map(line => {
          const cards = allClients.filter(c => c.line === line)
          if (cards.length === 0) return null
          return (
            <div className="conn-group" key={line}>
              <div className="conn-group-head">
                <span className="line-dot" style={{ background: LINE_COLORS[line] }} />
                {LINE_LABELS[line]}
                <span className="count">· {cards.length}</span>
              </div>
              <div className="conn-grid">
                {cards.map(renderClientCard)}
              </div>
            </div>
          )
        })}

        {/* Local access token — reuses card styling for visual consistency */}
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
                <input className="input" readOnly value={localToken || '••••••••'} type={localToken ? 'password' : 'text'} />
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
