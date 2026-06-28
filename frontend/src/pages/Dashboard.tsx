import { useEffect, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Bot, Code2, Monitor, Terminal, Database } from 'lucide-react'
import { apiGet, isWails, wails } from '@/lib/wails'
import { fmtNum, fmtTokens, fmtCost } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

interface StatusData {
  listen: string
  upstream: string
  active_profile: string
  default_model: string
  request_timeout_seconds: number
  api_key_configured: boolean
  rate_limit_per_second: number
  rate_limit_burst: number
  rate_limit_per_minute: number
}

interface QuotaData {
  success: boolean
  data?: {
    rolling: { usage_percent: number; reset_display: string }
    weekly: { usage_percent: number; reset_display: string }
    monthly?: { usage_percent: number; reset_display: string }
  }
}

interface SummaryTotals {
  total_requests: number
  success_count: number
  success_rate: number
  avg_latency_ms: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_create_tokens: number
  total_tokens: number
  estimated_cost: number
  cache_hit_rate: number
}

interface ClientStat { name: string; requests: number; pct: number }
interface ModelStat { name: string; requests: number; total_tokens: number; cost_usd: number; pct: number }

interface StatsSummary {
  period: { from: string; to: string; days: number }
  summary: SummaryTotals
  by_client: ClientStat[]
  by_model: ModelStat[]
}

interface IntegrationStatus {
  cli: boolean
  vscode: boolean
  claudeDesktop: boolean
  claudeDesktopApp: boolean
  codex: boolean
}

function fmtMs(n: number): string { return Math.round(n) + 'ms' }

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { toast } = useToast()
  const [status, setStatus] = useState<StatusData | null>(null)
  const [quota, setQuota] = useState<QuotaData | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [trend, setTrend] = useState<{ daily: { date: string; total_tokens: number; requests: number; input_tokens: number; output_tokens: number }[] } | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationStatus>({ cli: false, vscode: false, claudeDesktop: false, claudeDesktopApp: false, codex: false })
  const [loading, setLoading] = useState(true)
  const [quotaLoading, setQuotaLoading] = useState(!isWails())
  const [error, setError] = useState(false)
  const mounted = useMountedRef()

  async function loadStatus() {
    setLoading(true)
    try {
      const data = await apiGet<StatusData>('/ocgt/api/status')
      if (mounted.current) setStatus(data)
    }
    catch { if (mounted.current) { toast(t('loading_unavailable_desc'), 'error'); setError(true) } }
    finally { if (mounted.current) setLoading(false) }
  }

  async function loadStats() {
    try {
      const [s, tr] = await Promise.all([
        apiGet<StatsSummary>('/ocgt/api/stats/summary?days=1'),
        apiGet('/ocgt/api/stats/trend?days=2'),
      ])
      if (mounted.current) { setStats(s); setTrend(tr) }
    } catch { if (mounted.current) { toast(t('toast_stats_load_failed'), 'error'); setStats(null); setTrend(null) } }
  }

  async function loadIntegrations() {
    const [cli, vscode, claudeDesktop, claudeDesktopApp, codex] = await Promise.all([
      wails.IsSystemEnvConfigured().catch(() => false),
      wails.IsVSCodeConfigured().catch(() => false),
      wails.IsClaudeDesktopConfigured().catch(() => false),
      wails.IsClaudeDesktopAppConfigured().catch(() => false),
      wails.IsCodexConfigured().catch(() => false),
    ])
    setIntegrations({ cli, vscode, claudeDesktop, claudeDesktopApp, codex })
  }

  async function refreshQuota() {
    if (!isWails()) { setQuota(null); return }
    setQuotaLoading(true)
    try { setQuota(await wails.FetchQuota() as QuotaData) }
    catch { setQuota(null) }
    finally { setQuotaLoading(false) }
  }

  useEffect(() => { loadStatus(); loadStats(); loadIntegrations(); refreshQuota() }, [])

 // Auto-refresh status & integrations every 30s (reference: 12s for integrations)
 useEffect(() => {
  const id = setInterval(() => { loadStatus(); loadIntegrations() }, 30000)
  return () => clearInterval(id)
 }, [])

  const quotaBars = [
    { label: t('quota_rolling'), q: quota?.data?.rolling },
    { label: t('quota_weekly'), q: quota?.data?.weekly },
    { label: t('quota_monthly'), q: quota?.data?.monthly },
  ].filter((bar) => bar.q)

  const summary = stats?.summary
  const errorRate = summary && summary.total_requests > 0
    ? ((summary.total_requests - summary.success_count) / summary.total_requests * 100)
    : 0

  // Calculate deltas from trend data (today vs yesterday)
  const today = trend?.daily?.[trend.daily.length - 1]
  const prev = trend?.daily?.[trend.daily.length - 2]
  const pctDelta = (cur: number, old: number) => old > 0 ? ((cur - old) / old * 100) : 0
  const reqDelta = today && prev ? pctDelta(today.requests, prev.requests) : null
  const tokDelta = today && prev ? pctDelta(today.total_tokens, prev.total_tokens) : null
  const deltaStr = (d: number | null, suffix = '%') => d === null ? '' : `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(1)}${suffix}`

  const clientReqs: Record<string, number> = {}
  stats?.by_client?.forEach((c) => { clientReqs[c.name] = c.requests })

  const rows = [
    { key: 'cli', name: 'Claude Code CLI', file: '~/.config/claude/settings.json', Icon: Terminal, active: integrations.cli, client: 'cli' },
    { key: 'vscode', name: 'VS Code (Copilot ↔ Claude)', file: 'settings.json · 2 workspaces', Icon: Code2, active: integrations.vscode, client: 'vscode' },
    { key: 'codex', name: 'Codex CLI', file: '~/.codex/config.toml', Icon: Bot, active: integrations.codex, client: 'codex' },
    { key: 'desktop', name: 'Claude Desktop', file: integrations.claudeDesktop || integrations.claudeDesktopApp ? t('dash_installed') : t('dash_not_installed'), Icon: Monitor, active: integrations.claudeDesktop || integrations.claudeDesktopApp, client: 'desktop' },
  ]

  const numClients = (stats?.by_client?.length ?? 0) || (status ? 1 : 0)

  return (
    <div id="page-dashboard">
      <div className="hero-row">
        <div className="hero-meta">
          <div><b>—</b><span>{t('dash_uptime')}</span></div>
          <div><b>{summary ? fmtMs(summary.avg_latency_ms) : '-'}</b><span>{t('dash_p50')}</span></div>
          <div><b>{summary ? fmtCost(summary.estimated_cost) : '-'}</b><span>{t('dash_spend_mtd')}</span></div>
          {error && (
            <button className="btn btn-sm" onClick={() => { setError(false); loadStatus(); loadStats(); }}>
              ↻ {t('retry')}
            </button>
          )}
        </div>
      </div>

      <div className="grid-stats">
        <div className="stat">
          <div className="lbl">{t('dash_reqs_24h')}</div>
          <div className="v">{summary ? fmtNum(summary.total_requests) : '...'}</div>
          <div className={reqDelta !== null && reqDelta >= 0 ? 'delta up' : 'delta dn'}>
            {summary ? (reqDelta !== null ? deltaStr(reqDelta) : <span className="dim">{t('dash_success_rate')} {summary.success_rate.toFixed(1)}%</span>) : '...'}
          </div>
          <div className="foot"><span>{summary ? fmtNum(summary.total_cache_read_tokens) + ` ${t('dash_cached')}` : '-'}</span><span>{summary ? (summary.total_requests / 24).toFixed(1) + `${t('dash_hr_avg')}` : ''}</span></div>
        </div>
        <div className="stat">
          <div className="lbl">{t('dash_tokens')}</div>
          <div className="v">{summary ? fmtTokens(summary.total_tokens) : '...'}</div>
          <div className={tokDelta !== null && tokDelta >= 0 ? 'delta up' : 'delta dn'}>
            {summary ? (tokDelta !== null ? deltaStr(tokDelta) : <span className="dim">{t('dash_in')} {(summary.total_input_tokens / summary.total_tokens * 100).toFixed(0)}% · {t('dash_out')} {(summary.total_output_tokens / summary.total_tokens * 100).toFixed(0)}%</span>) : '...'}
          </div>
          <div className="foot"><span>{summary ? fmtTokens(summary.total_input_tokens) + ` ${t('dash_in')}` : '-'}</span><span>{summary ? fmtTokens(summary.total_output_tokens) + ` ${t('dash_out')}` : '-'}</span></div>
        </div>
        <div className="stat">
          <div className="lbl">{t('dash_cache_hit')}</div>
          <div className="v">{summary ? summary.cache_hit_rate.toFixed(1) + '%' : '...'}</div>
          <div className={summary && summary.cache_hit_rate > 50 ? 'delta up' : 'delta dn'}>
            {summary ? `${fmtNum(summary.total_cache_read_tokens)} ${t('dash_read')} · ${fmtNum(summary.total_cache_create_tokens)} ${t('dash_created')}` : t('dash_last_24h')}
          </div>
          <div className="foot"><span>{summary ? fmtNum(summary.total_cache_read_tokens + summary.total_cache_create_tokens) + ` ${t('dash_cached_tokens')}` : '-'}</span><span>{summary ? fmtCost(summary.estimated_cost) + ` ${t('dash_total')}` : ''}</span></div>
        </div>
        <div className="stat">
          <div className="lbl">{t('dash_errors')}</div>
          <div className="v">{summary ? errorRate.toFixed(2) + '%' : '...'}</div>
          <div className={errorRate > 1 ? 'delta dn' : 'delta up'}>
            {summary ? `${fmtNum(summary.total_requests - summary.success_count)} ${t('dash_failures')} · ${summary.success_count} ${t('dash_ok')}` : t('dash_last_24h')}
          </div>
          <div className="foot"><span>{summary ? fmtNum(summary.total_requests - summary.success_count) + ` ${t('dash_failures')}` : '-'}</span><span>{summary ? fmtNum(summary.success_count) + ` ${t('dash_ok')}` : '-'}</span></div>
        </div>
      </div>

      <div className="panels">
        <div className="card">
          <div className="card-h">{t('dash_proxy_status')}<div className="actions"><button className="btn btn-sm btn-ghost" onClick={() => window.location.hash = '#/history'}>{t('dash_view_logs')}</button><button className="btn btn-sm btn-ghost" onClick={loadStatus}>{t('dash_refresh')}</button></div></div>
          <div className="statusgrid">
            <div className="cell"><div className="k">{t('dash_listen_addr')}</div><div className="vv"><span className="dot online dash-dot-margin" />{status?.listen || '-'}</div></div>
            <div className="cell"><div className="k">{t('dash_active_profile')}</div><div className="vv">{status?.active_profile || '-'} <span className="tag green">{t('dash_live')}</span></div></div>
            <div className="cell"><div className="k">{t('dash_default_upstream')}</div><div className="vv">{status?.upstream || '-'}</div></div>
            <div className="cell"><div className="k">{t('dash_default_model')}</div><div className="vv dash-hero-label">{status?.default_model || '-'}</div></div>
            <div className="cell"><div className="k">{t('dash_rate_limit')}</div><div className="vv">{status ? `${status.rate_limit_per_minute || status.rate_limit_per_second * 60 || '-'} ${t('dash_r_min')}` : '-'}</div></div>
            <div className="cell"><div className="k">{t('dash_api_key')}</div><div className="vv">{status?.api_key_configured ? 'sk-•••••••••' : t('dash_no_key')}</div></div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">{t('dash_quota')} · {new Date().toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', year: 'numeric' })}<div className="actions"><button className="btn btn-sm btn-ghost" onClick={refreshQuota} disabled={quotaLoading}>{quotaLoading ? '...' : t('dash_upgrade')}</button></div></div>
          <div className="card-body dash-hero-item dash-card-gap">
            {quotaBars.length > 0 ? (
              <>
                {quotaBars.map((bar, i) => (
                  <div key={i}>
                    <div className="row between dash-row-mb"><span className="muted tiny">{bar.label}</span><span className="mono tiny">{bar.q!.usage_percent.toFixed(1)}%</span></div>
                    <div className="quotabar"><i className="dash-bar" style={{ width: `${Math.min(100, bar.q!.usage_percent)}%` }} /></div>
                  </div>
                ))}
                {quotaBars[0]?.q?.reset_display && (
                  <div className="row between dash-plan-resets"><span className="muted tiny">{t('dash_resets_in')} {quotaBars[0].q.reset_display}</span><span className="mono tiny">—</span></div>
                )}
              </>
            ) : (
              <p className="muted tiny dash-quota-msg">{quotaLoading ? t('dash_loading') + '...' : t('dash_no_quota')}</p>
            )}
          </div>
        </div>
      </div>

        <div className="panels dash-chart-row">
        <div className="card">
          <div className="card-h">{t('dash_integrations')}<div className="actions"><button className="btn btn-sm btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('nav-to', { detail: 'terminal' }))}>{t('dash_manage')}</button></div></div>
          <div className="integ-list">
            {rows.map((row) => {
              const Icon = row.Icon
              const reqs = clientReqs[row.client] || 0
              return (
                <div className="integ-row" key={row.key}>
                  <div className="ic"><Icon width={16} height={16} /></div>
                  <div className="nm"><b>{row.name}</b><span>{row.file}</span></div>
                  {row.active ? (
                    <>
                      <span className="tag green"><span className="dot online" /> {t('dash_active')}{reqs > 0 ? ` · ${fmtNum(reqs)} ${t('qc_reqs_24h')}` : ''}</span>
                      <span className="mono muted tiny dash-integ-reqs">{reqs > 0 ? `${fmtNum(reqs)} ${t('qc_reqs_24h')}` : '—'}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('nav-to', { detail: 'terminal' }))}>{t('dash_configure')}</button>
                    </>
                  ) : (
                    <>
                      <span className="tag">{t('dash_inactive')}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('nav-to', { detail: 'terminal' }))}>{t('dash_install')}</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

    </div>
  )
}
