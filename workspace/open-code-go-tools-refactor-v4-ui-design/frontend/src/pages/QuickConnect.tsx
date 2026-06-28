import { useState, useEffect, useCallback } from 'react'
import { Terminal, Code2, Bot, Monitor, Plus, Copy, Check } from 'lucide-react'
import { wails, apiGet } from '@/lib/wails'
import { errMessage } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { AgentLine } from './settings/types'

interface IntegrationStatus { cli: boolean; vscode: boolean; claudeDesktopApp: boolean; codex: boolean }
interface ClientStats { [key: string]: number }

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

  const clients = [
    { id: 'cli', icon: Terminal, iconBg: 'dark', iconText: 'CC', name: 'Claude Code', version: 'cli · v0.9.4', desc: t('qc_claude_code_desc'), installed: intStatus.cli, line: 'claude' as AgentLine, configPath: '~/.config/claude/settings.json', actions: ['open', 'remove'] },
    { id: 'vscode', icon: Code2, iconBg: 'light', name: 'VS Code', version: 'extension · workspace scope', desc: t('qc_vscode_desc'), installed: intStatus.vscode, line: 'claude' as AgentLine, configPath: 'settings.json · 2 workspaces', actions: ['open', 'remove'] },
    { id: 'desktop', icon: Monitor, iconBg: 'light', name: 'Claude Desktop', version: 'app · MCP server', desc: t('qc_desktop_desc'), installed: intStatus.claudeDesktopApp, line: 'claude' as AgentLine, configPath: '', actions: ['docs', 'install'] },
    { id: 'cursor', icon: Code2, iconBg: 'light', name: 'Cursor', version: 'editor · beta', desc: t('qc_cursor_desc'), installed: false, line: 'claude' as AgentLine, isNew: true, configPath: '', actions: ['docs', 'install'] },
    { id: 'codex', icon: Bot, iconBg: 'dark', iconText: 'CX', name: 'Codex CLI', version: 'cli · v1.2.0', desc: t('qc_codex_desc'), installed: intStatus.codex, line: 'codex' as AgentLine, configPath: '~/.codex/config.toml', actions: ['edit', 'remove'] },
  ]

  const filteredClients = lineFilter === 'all' ? clients : clients.filter(c => c.line === lineFilter)
  const LINE_COLORS: Record<AgentLine, string> = { claude: '#d97706', codex: '#16a34a' }

  return (
    <div id="page-connect">
      <div className="page-label"><span className="idx">2</span><span>{t('nav_terminal').toUpperCase()}</span><span className="path">/connect</span></div>
      <div className="row between" style={{ marginBottom: 18, alignItems: 'flex-end' }}>
        <div>
          <h1 className="hero">{t('qc_hero')} <em>{t('qc_hero_em')}</em> in one click.</h1>
          <p className="lede">{t('qc_lede')}</p>
        </div>
        <div className="segmented">
          <button className={lineFilter === 'all' ? 'on' : ''} onClick={() => setLineFilter('all')}>{t('qc_filter_all')}</button>
          <button className={lineFilter === 'claude' ? 'on' : ''} onClick={() => setLineFilter('claude')}>Claude</button>
          <button className={lineFilter === 'codex' ? 'on' : ''} onClick={() => setLineFilter('codex')}>Codex</button>
        </div>
      </div>
      <div className="conn-grid">
        {filteredClients.map(client => {
          if (!client) return null
          const Icon = client.icon
          const reqs = clientStats[client.id] || 0
          const lineColor = LINE_COLORS[client.line]
          return (
            <div className="conn-card" key={client.id} style={{ borderLeft: `3px solid ${lineColor}` }}>
              <div className="head">
                <div className={`ic-lg ${client.iconBg === 'light' ? 'alt' : ''}`}>
                  {client.iconText ? <span style={{ fontSize: 14, fontWeight: 600 }}>{client.iconText}</span> : <Icon width={22} height={22} />}
                </div>
                <div>
                  <h3>{client.name}</h3>
                  <div className="sub">{client.version}</div>
                </div>
                <span className="spacer"></span>
                <span className="tag" style={{ background: lineColor, color: '#fff', fontSize: 10 }}>{client.line}</span>
                {client.isNew ? <span className="tag blue">{t('qc_new')}</span> : client.installed ? <span className="tag green"><span className="dot online" /> {t('qc_installed')}</span> : <span className="tag">{t('qc_not_installed')}</span>}
              </div>
              <p>{client.desc}</p>
              <div className="meta">
                <span>{client.installed ? `${reqs.toLocaleString()} ${t('qc_reqs_24h')}` : '—'}</span>
                <span className="spacer"></span>
                {client.actions[0] === 'open' && client.installed && <button className="btn btn-sm btn-ghost" onClick={() => wails.OpenConfigLocation()}>{t('qc_open_config')}</button>}
                {client.actions[0] === 'edit' && client.installed && <button className="btn btn-sm btn-ghost" onClick={() => wails.OpenConfigLocation()}>{t('qc_edit_config')}</button>}
                {client.actions[0] === 'docs' && <button className="btn btn-sm btn-ghost" onClick={() => { try { (window as any).runtime.BrowserOpenURL('https://github.com/ethan-blue/open-code-go-tools') } catch {} }}>{t('qc_docs')}</button>}
                {client.actions[1] === 'remove' && client.installed ? <button className="btn btn-sm" onClick={() => handleRemove(client.id)}>{t('qc_remove')}</button> : client.actions[1] === 'install' ? <button className="btn btn-sm btn-primary" onClick={() => handleInstall(client.id)}>{t('qc_install')}</button> : null}
              </div>
            </div>
          )
        })}
        <div className="conn-card" style={{ background: 'repeating-linear-gradient(135deg, var(--ink-50) 0 8px, var(--ink-100) 8px 16px)', borderStyle: 'dashed' }}>
          <div className="head">
            <div className="ic-lg alt" style={{ background: 'transparent', border: '1.5px dashed var(--line-strong)' }}><Plus width={20} height={20} /></div>
            <div><h3>{t('qc_add_custom')}</h3><div className="sub">{t('qc_add_custom_sub')}</div></div>
          </div>
          <p>{t('qc_add_custom_desc')}</p>
          <div className="meta"><span className="spacer"></span><button className="btn btn-sm" onClick={() => toast('Coming soon', 'info')}>{t('qc_create')}</button></div>
        </div>
      </div>
      {/* Local access token */}
      <section className="set-section" style={{ marginTop: 24 }}>
        <div className="head"><div><h3>{t('sett_local_token')}</h3><div className="sub">{t('sett_local_token_desc')}</div></div></div>
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>Bearer Token</b><p>{t('sett_token_hint')}</p></div>
            <div className="control">
              <div className="input-wrap">
                <input className="input" readOnly value={localToken || '••••••••'} type={localToken ? 'password' : 'text'} />
                <button className="suffix-btn" onClick={handleCopyToken} title={t('btn_copy')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px' }}>
                  {copyFeedback ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
