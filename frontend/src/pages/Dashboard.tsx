import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Settings } from 'lucide-react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { apiGet, isWails, wails } from '@/lib/wails'
import { fmtNum, fmtTokens, fmtCost, fmtMs, fmtUptime, pctDelta, deltaStr } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { StatusData, QuotaData, StatsSummary } from '@/lib/types'
import * as rt from '@/wailsjs/runtime/runtime'

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { toast } = useToast()
  const [status, setStatus] = useState<StatusData | null>(null)
  const [quota, setQuota] = useState<QuotaData | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [trend, setTrend] = useState<{ daily: { date: string; total_tokens: number; requests: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [quotaConfigured, setQuotaConfigured] = useState<boolean | null>(null)
  const [quotaError, setQuotaError] = useState('')
  const [error, setError] = useState(false)
  const mounted = useMountedRef()

  async function loadStatus() {
    setLoading(true)
    try {
      const data = await apiGet<StatusData>('/ocgt/api/status')
      if (mounted.current) setStatus(data)
    } catch {
      if (mounted.current) {
        toast(t('loading_unavailable_desc'), 'error')
        setError(true)
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  async function loadStats() {
    try {
      const [s, tr] = await Promise.all([
        apiGet<StatsSummary>('/ocgt/api/stats/summary?days=1'),
        apiGet('/ocgt/api/stats/trend?days=2'),
      ])
      if (mounted.current) {
        setStats(s)
        setTrend(tr)
      }
    } catch {
      if (mounted.current) {
        toast(t('toast_stats_load_failed'), 'error')
        setStats(null)
        setTrend(null)
      }
    }
  }

  async function refreshQuota() {
    if (!isWails()) {
      setQuota(null)
      setQuotaConfigured(false)
      setQuotaError('')
      return
    }
    setQuotaLoading(true)
    try {
      const status = await apiGet<{ configured?: boolean }>('/ocgt/api/quota/status')
      if (!status?.configured) {
        setQuota(null)
        setQuotaConfigured(false)
        setQuotaError('')
        return
      }
      setQuotaConfigured(true)
      const result = await wails.FetchQuota() as QuotaData & { error?: string }
      if (!result?.success) {
        setQuota(null)
        setQuotaError(result?.error || t('dash_no_quota'))
        return
      }
      setQuota(result)
      setQuotaError('')
    } catch (err) {
      setQuota(null)
      setQuotaError(err instanceof Error ? err.message : t('dash_no_quota'))
    } finally {
      setQuotaLoading(false)
    }
  }

  function openQuotaLogin() {
    if (isWails()) rt.BrowserOpenURL('https://opencode.ai/go')
    else window.open('https://opencode.ai/go', '_blank', 'noopener,noreferrer')
  }

  function openQuotaConfig() {
    window.dispatchEvent(new CustomEvent('nav-to', { detail: 'providers' }))
  }

  // Keep latest loader functions in refs so the polling intervals below always
  // invoke the current closure (avoids stale-capture bugs and avoids re-arming
  // the intervals on every render).
  const loadStatusRef = useRef(loadStatus)
  const loadStatsRef = useRef(loadStats)
  loadStatusRef.current = loadStatus
  loadStatsRef.current = loadStats

  useEffect(() => {
    loadStatusRef.current()
    loadStatsRef.current()
    refreshQuota()
  }, [])

  useEffect(() => {
    let id: ReturnType<typeof setInterval>
    const start = () => {
      id = setInterval(() => { loadStatusRef.current() }, 30000)
    }
    const stop = () => { clearInterval(id) }
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        loadStatusRef.current()
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  useEffect(() => {
    const id = setInterval(() => { loadStatsRef.current() }, 60000)
    return () => clearInterval(id)
  }, [])

  const quotaBars = [
    { label: t('quota_rolling'), q: quota?.data?.rolling },
    { label: t('quota_weekly'), q: quota?.data?.weekly },
    { label: t('quota_monthly'), q: quota?.data?.monthly },
  ].filter(bar => bar.q)

  const summary = stats?.summary
  const totalRequests = summary?.total_requests ?? 0
  const totalTokens = summary?.total_tokens ?? 0
  const inputPct = totalTokens > 0 && summary ? (summary.total_input_tokens / totalTokens * 100).toFixed(0) : '0'
  const outputPct = totalTokens > 0 && summary ? (summary.total_output_tokens / totalTokens * 100).toFixed(0) : '0'
  const errorRate = totalRequests > 0 && summary ? ((totalRequests - summary.success_count) / totalRequests * 100) : 0

  const today = trend?.daily?.[trend.daily.length - 1]
  const prev = trend?.daily?.[trend.daily.length - 2]
  const reqDelta = today && prev ? pctDelta(today.requests, prev.requests) : null
  const tokDelta = today && prev ? pctDelta(today.total_tokens, prev.total_tokens) : null

  const claudeProvider = status?.providers?.claude
  const codexProvider = status?.providers?.codex
  const apiKeyConfigured = !!(claudeProvider?.api_key_configured || codexProvider?.api_key_configured || status?.api_key_configured)

  return (
    <div id="page-dashboard">
      <div className="hero-row">
        <div className="hero-meta">
          <div><b>{status ? fmtUptime(status.uptime_seconds) : '-'}</b><span>{t('dash_uptime')}</span></div>
          <div><b>{summary ? fmtMs(summary.p50_latency_ms || summary.avg_latency_ms) : '-'}</b><span>{t('dash_p50')}</span></div>
          <div><b>{summary ? fmtCost(summary.estimated_cost) : '-'}</b><span>{t('dash_spend_mtd')}</span></div>
          {error && (
            <button className="btn btn-sm" onClick={() => { setError(false); loadStatus(); loadStats() }}>
              {t('retry')}
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
            {summary ? (tokDelta !== null ? deltaStr(tokDelta) : <span className="dim">{t('dash_in')} {inputPct}% / {t('dash_out')} {outputPct}%</span>) : '...'}
          </div>
          <div className="foot"><span>{summary ? fmtTokens(summary.total_input_tokens) + ` ${t('dash_in')}` : '-'}</span><span>{summary ? fmtTokens(summary.total_output_tokens) + ` ${t('dash_out')}` : '-'}</span></div>
        </div>
        <div className="stat">
          <div className="lbl">{t('dash_cache_hit')}</div>
          <div className="v">{summary ? summary.cache_hit_rate.toFixed(1) + '%' : '...'}</div>
          <div className={summary && summary.cache_hit_rate > 50 ? 'delta up' : 'delta dn'}>
            {summary ? `${fmtNum(summary.total_cache_read_tokens)} ${t('dash_read')} / ${fmtNum(summary.total_cache_create_tokens)} ${t('dash_created')}` : t('dash_last_24h')}
          </div>
          <div className="foot"><span>{summary ? fmtNum(summary.total_cache_read_tokens + summary.total_cache_create_tokens) + ` ${t('dash_cached_tokens')}` : '-'}</span><span>{summary ? fmtCost(summary.estimated_cost) + ` ${t('dash_total')}` : ''}</span></div>
        </div>
        <div className="stat">
          <div className="lbl">{t('dash_errors')}</div>
          <div className="v">{summary ? errorRate.toFixed(2) + '%' : '...'}</div>
          <div className={errorRate > 1 ? 'delta dn' : 'delta up'}>
            {summary ? `${fmtNum(summary.total_requests - summary.success_count)} ${t('dash_failures')} / ${summary.success_count} ${t('dash_ok')}` : t('dash_last_24h')}
          </div>
          <div className="foot"><span>{summary ? fmtNum(summary.total_requests - summary.success_count) + ` ${t('dash_failures')}` : '-'}</span><span>{summary ? fmtNum(summary.success_count) + ` ${t('dash_ok')}` : '-'}</span></div>
        </div>
      </div>

      <div className="panels">
        <div className="card">
          <div className="card-h">{t('dash_proxy_status')}<div className="actions"><button className="btn btn-sm btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('nav-to', { detail: 'history' }))}>{t('dash_view_logs')}</button><button className="btn btn-sm btn-ghost" onClick={loadStatus}>{t('dash_refresh')}</button></div></div>
          <div className="statusgrid">
            <div className="cell"><div className="k">{t('dash_listen_addr')}</div><div className="vv"><span className="dot online dash-dot-margin" />{status?.listen || '-'}</div></div>
            <div className="cell"><div className="k">Claude Provider</div><div className="vv">{claudeProvider?.name || '-'} {claudeProvider?.enabled ? <span className="tag green">{t('dash_live')}</span> : null}</div></div>
            <div className="cell"><div className="k">Claude Upstream</div><div className="vv">{claudeProvider?.base_url || status?.upstream || '-'}</div></div>
            <div className="cell"><div className="k">Claude Model</div><div className="vv dash-hero-label">{claudeProvider?.default_model || status?.default_model || '-'}</div></div>
            <div className="cell"><div className="k">Codex Provider</div><div className="vv">{codexProvider?.name || '-'}</div></div>
            <div className="cell"><div className="k">Codex Model</div><div className="vv dash-hero-label">{codexProvider?.default_model || status?.default_model || '-'}</div></div>
            <div className="cell"><div className="k">{t('dash_rate_limit')}</div><div className="vv">{status ? `${status.rate_limit_per_minute || status.rate_limit_per_second * 60 || '-'} ${t('dash_r_min')}` : '-'}</div></div>
            <div className="cell"><div className="k">{t('dash_api_key')}</div><div className="vv">{apiKeyConfigured ? 'Configured' : t('dash_no_key')}</div></div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">{t('dash_quota')} - {new Date().toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', year: 'numeric' })}<div className="actions"><button className="btn btn-sm btn-ghost" onClick={refreshQuota} disabled={quotaLoading || quotaConfigured === false}>{quotaLoading ? '...' : t('dash_refresh')}</button></div></div>
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
                  <div className="row between dash-plan-resets"><span className="muted tiny">{t('dash_resets_in')} {quotaBars[0].q.reset_display}</span><span className="mono tiny">--</span></div>
                )}
              </>
            ) : (
              <div className="dash-quota-empty">
                <p className="muted tiny dash-quota-msg">{quotaLoading ? t('dash_loading') + '...' : quotaConfigured === false ? t('dash_quota_not_configured') : quotaError || t('dash_no_quota')}</p>
                {quotaConfigured === false ? (
                  <div className="dash-quota-actions">
                    <button className="btn btn-sm btn-primary" onClick={openQuotaLogin}>
                      <ExternalLink width={13} height={13} />{t('dash_quota_login')}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={openQuotaConfig}>
                      <Settings width={13} height={13} />{t('dash_quota_configure')}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
