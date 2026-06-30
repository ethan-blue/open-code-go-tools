import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { Search, Hash, ChevronRight } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { apiGet } from '@/lib/wails'
import { fmtTokens, fmtCost, fmtDate } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

interface SessionEvent {
  type: 'user' | 'assistant'
  timestamp: string
  message?: {
    text?: string
    usage?: { input_tokens: number; output_tokens: number }
    model?: string
    tools?: string[]
    client?: string
  }
}

interface Session {
  sessionId: string
  model: string
  startTime: string
  lastTime: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  messageCount: number
  events: SessionEvent[]
}

function sessionCost(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreate: number,
): number {
  const rates: Record<string, { in: number; out: number; cr: number; cc: number }> = {
    'deepseek-v4-flash': { in: 0.3e-6, out: 1.1e-6, cr: 0, cc: 0 },
    'deepseek-v4-pro': { in: 1.2e-6, out: 4e-6, cr: 0, cc: 0 },
    'claude-sonnet': { in: 3e-6, out: 15e-6, cr: 0.3e-6, cc: 3.75e-6 },
    'claude-opus': { in: 15e-6, out: 75e-6, cr: 1.5e-6, cc: 18.75e-6 },
    'claude-haiku': { in: 0.8e-6, out: 4e-6, cr: 0.08e-6, cc: 1.0e-6 },
    kimi: { in: 3e-6, out: 15e-6, cr: 0, cc: 0 },
    qwen: { in: 3e-6, out: 15e-6, cr: 0, cc: 0 },
    glm: { in: 0.5e-6, out: 1.5e-6, cr: 0, cc: 0 },
  }
  const key = Object.keys(rates).find((k) => (model || '').toLowerCase().includes(k)) || 'claude-sonnet'
  const r = rates[key]
  return input * r.in + output * r.out + cacheRead * r.cr + cacheCreate * r.cc
}

const SESSION_COLORS = ['var(--ink-500)', 'var(--ink-400)', 'var(--ink-300)', 'var(--ink-600)', 'var(--ink-200)', 'var(--ink-700)', 'var(--ink-100)']

export default memo(function Sessions() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadError, setLoadError] = useState(false)
  const [period, setPeriod] = useState(() => localStorage.getItem('sessions_period') || 'today')

 // Persist period selection
 useEffect(() => { localStorage.setItem('sessions_period', period) }, [period])
  const [search, setSearch] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('sessions_sort') || 'time-desc')

 // Persist sort selection
 useEffect(() => { localStorage.setItem('sessions_sort', sortBy) }, [sortBy])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, SessionEvent[]>>({})
  const [chartOpen, setChartOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiGet(`/ocgt/api/sessions?period=${period}`)
      setSessions(result.sessions || [])
      setLoadError(false)
    } catch {
      setSessions([])
      setLoadError(true)
      toast(t('toast_sessions_load_failed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    load()
  }, [load])

  const loadDetail = useCallback(async (sessionId: string) => {
    if (detailCache[sessionId]) return
    setDetailLoading(sessionId)
    try {
      const result = await apiGet(`/ocgt/api/sessions?id=${encodeURIComponent(sessionId)}`)
      const events: SessionEvent[] = result?.sessions?.[0]?.events || result?.events || []
      setDetailCache((prev) => ({ ...prev, [sessionId]: events }))
    } catch {
      setDetailCache((prev) => ({ ...prev, [sessionId]: [] }))
      toast(t('toast_detail_load_failed'), 'error')
    } finally {
      setDetailLoading(null)
    }
  }, [detailCache])

  const models = useMemo(() => {
    const set = new Set<string>()
    sessions.forEach((s) => { if (s.model) set.add(s.model) })
    return Array.from(set).sort()
  }, [sessions])

  const costMap = useMemo(() => {
    const map: Record<string, number> = {}
    sessions.forEach((s) => {
      map[s.sessionId] = sessionCost(s.model, s.inputTokens, s.outputTokens, s.cacheReadTokens, s.cacheCreateTokens)
    })
    return map
  }, [sessions])

  const summary = useMemo(() => {
    let totalTokens = 0
    let totalCost = 0
    sessions.forEach((s) => {
      totalTokens += s.totalTokens
      totalCost += costMap[s.sessionId] || 0
    })
    return { count: sessions.length, totalTokens, totalCost }
  }, [sessions, costMap])

  const filtered = useMemo(() => {
    let list = [...sessions]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((s) =>
        s.sessionId.toLowerCase().includes(q) || s.model.toLowerCase().includes(q),
      )
    }
    if (modelFilter) {
      list = list.filter((s) => s.model === modelFilter)
    }
    switch (sortBy) {
      case 'time-asc':
        list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        break
      case 'tokens-desc':
        list.sort((a, b) => b.totalTokens - a.totalTokens)
        break
      case 'tokens-asc':
        list.sort((a, b) => a.totalTokens - b.totalTokens)
        break
      case 'cost-desc':
        list.sort((a, b) => (costMap[b.sessionId] || 0) - (costMap[a.sessionId] || 0))
        break
      default:
        list.sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime())
    }
    return list
  }, [sessions, search, modelFilter, sortBy, costMap])

  const handleSelect = (sessionId: string) => {
    setSelectedId(sessionId)
    loadDetail(sessionId)
  }

  const selectedSession = useMemo(() => {
    if (!selectedId) return null
    return sessions.find((s) => s.sessionId === selectedId) || null
  }, [sessions, selectedId])

  const selectedEvents = selectedId ? detailCache[selectedId] : undefined
  const shortSessionId = (sessionId: string): string =>
    sessionId.length > 12 ? sessionId.slice(0, 8) : sessionId

  const periods = [
    { v: 'today', l: t('sessions_period_today') },
    { v: 'month', l: t('sessions_period_month') },
    { v: 'all', l: t('sessions_period_all') },
  ]
  
  // Aggregated model data for the chart based on current filter
  const chartModels = useMemo(() => {
    const mmap: Record<string, { requests: number, total_tokens: number, pct: number }> = {}
    let totalTokens = 0
    filtered.forEach(s => {
      if (!s.model) return
      if (!mmap[s.model]) mmap[s.model] = { requests: 0, total_tokens: 0, pct: 0 }
      mmap[s.model].requests += s.messageCount
      mmap[s.model].total_tokens += s.totalTokens
      totalTokens += s.totalTokens
    })
    
    return Object.entries(mmap)
      .map(([name, data]) => ({
        name,
        requests: data.requests,
        total_tokens: data.total_tokens,
        pct: totalTokens > 0 ? (data.total_tokens / totalTokens) * 100 : 0
      }))
      .sort((a, b) => b.total_tokens - a.total_tokens)
  }, [filtered])

  return (
    <div id="page-sessions">
      <div className="hero-row row-reverse">
        <div className="row gap-2">
          <div className="segmented">
            {periods.map((p) => (<button key={p.v} className={period === p.v ? 'on' : ''} onClick={() => setPeriod(p.v)}>{p.l}</button>))}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => {
            const jsonl = filtered.map(s => JSON.stringify({ sessionId: s.sessionId, model: s.model, totalTokens: s.totalTokens, messageCount: s.messageCount, lastTime: s.lastTime })).join("\n")
            const blob = new Blob([jsonl], { type: "application/jsonl" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a"); a.href = url; a.download = `ocgt-sessions-${new Date().toISOString().slice(0,10)}.jsonl`; a.click(); URL.revokeObjectURL(url)
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="tm-mr-4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t('sessions_export_jsonl')}
          </button>
        </div>
      </div>

      <div className="row between sessions-filters">
        <div className="grid-stats sessions-stats-grid">
          <div className="stat sess-stat-card">
            <div className="lbl">{t('sessions_total')}</div>
            <div className="v sess-v">{summary.count}</div>
          </div>
          <div className="stat sess-stat-card">
            <div className="lbl">Token</div>
            <div className="v sess-v">{fmtTokens(summary.totalTokens)}</div>
          </div>
          <div className="stat sess-stat-card">
            <div className="lbl">{t('tm_cost') || 'Cost'}</div>
            <div className="v sess-v">{fmtCost(summary.totalCost)}</div>
          </div>
        </div>
        <div className="row gap-2 items-center flex-wrap">
          <input className="sess-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('sessions_search_placeholder')} aria-label={t('sessions_search_placeholder')} />
          <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="sess-search sess-search-fixed">
            <option value="">{t('sessions_filter_all')}</option>
            {models.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sess-search sess-search-fixed">
            <option value="time-desc">{t('sessions_sort_time_desc')}</option>
            <option value="time-asc">{t('sessions_sort_time_asc')}</option>
            <option value="tokens-desc">{t('sessions_sort_tokens_desc')}</option>
            <option value="cost-desc">{t('sessions_sort_cost_desc')}</option>
          </select>
        </div>
      </div>
      
      {chartModels.length > 0 && (
        <div className="s-chart-collapse">
          <div className={`s-chart-header${chartOpen ? ' open' : ''}`} role="button" tabIndex={0} onClick={() => setChartOpen(!chartOpen)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChartOpen(!chartOpen) } }} aria-expanded={chartOpen}>
            <ChevronRight size={16} className={`s-chart-chevron${chartOpen ? ' open' : ''}`} />
            <span className="s-chart-title">{t('sessions_model_chart') || 'Model Distribution'}</span>
            <span className="s-chart-count tag muted">{chartModels.length} {t('sessions_models')}</span>
          </div>
          {chartOpen && (
            <div className="s-chart-body">
              <div className="ring">
                <svg viewBox="0 0 128 128" width="140" height="140">
                  {(() => {
                    const r = 54, sw = 16, cx = 64, cy = 64
                    const circ = 2 * Math.PI * r
                    let offset = 0
                    return chartModels.map((m, i) => {
                      const pct = m.total_tokens / Math.max(1, chartModels.reduce((s, x) => s + x.total_tokens, 0))
                      const dash = pct * circ
                      const el = (
                        <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                          stroke={SESSION_COLORS[i % SESSION_COLORS.length]} strokeWidth={sw}
                          strokeDasharray={`${dash} ${circ - dash}`}
                          strokeDashoffset={-offset} />
                      )
                      offset += dash
                      return el
                    })
                  })()}
                  <circle cx="64" cy="64" r="46" fill="var(--paper, #fff)" />
                </svg>
                <div className="sess-chart-center-wrapper">
                  <span className="sess-chart-center-val">{chartModels.length}</span>
                  <span className="sess-chart-center-lbl">{t('sessions_models')}</span>
                </div>
              </div>
              <div className="legend2 sess-legend-wrapper">
                {chartModels.map((m, i) => (
                  <div className="row sess-legend-item" key={i}>
                    <span className="sw sess-legend-sw" style={{ background: SESSION_COLORS[i % SESSION_COLORS.length] }} />
                    <span className="nm sess-legend-nm">{m.name}</span>
                    <span className="vv muted">{m.requests} {t('tm_requests')}</span>
                    <span className="vv muted sess-legend-vv">{m.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="session-list" style={{ padding: '16px 0' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="item sess-skel-item">
              <Skeleton style={{ width: '60%', height: 12 }} />
              <Skeleton style={{ width: '40%', height: 10 }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Hash width={28} height={28} />}
            title={loadError ? t('td_load_failed') : (t('sessions_empty_title') || 'No active sessions')}
            description={loadError ? t('td_proxy_offline') : (t('sessions_empty_desc') || 'Sessions will appear here when you start using connected clients.')}
            action={
              loadError
                ? <button className="btn btn-sm" onClick={load}>{t('retry')}</button>
                : <button className="btn btn-sm btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('nav-to', { detail: 'terminal' }))}>{t('nav_terminal')}</button>
            }
          />
        </div>
      ) : (
        <div className="sessions-layout">
          <div className="session-list">
            {filtered.map((s) => {
              const cost = costMap[s.sessionId] || 0
              const isSelected = selectedId === s.sessionId
                            return (
                <div
                  key={s.sessionId}
                  className={`item ${isSelected ? 'on' : ''}`}
                  onClick={() => handleSelect(s.sessionId)}
                >
                  <div className="top">
                    <b>{shortSessionId(s.sessionId)}</b>
                    <time>{fmtDate(s.lastTime)}</time>
                  </div>
                  <div className="prev">{s.model || t('sessions_unknown')} | {s.messageCount} {t('sessions_messages')}</div>
                  <div className="tags">
                    <span className="tag">{s.model || t('sessions_unknown')}</span>
                    {s.events?.[0]?.message?.client && <span className="tag blue">{s.events[0].message.client}</span>}
                    <span className="tag green">{fmtCost(cost)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="session-detail">
            {!selectedSession ? (
              <EmptyState icon={<Hash width={28} height={28} />} title={t('sessions_no_data')} description="" />
            ) : (
              <>
                <div className="crumb">
                  <Hash size={11} className="tm-mr-4 inline-middle" />
                  {selectedSession.sessionId} | {selectedSession.messageCount} {t('sessions_messages')} | {fmtTokens(selectedSession.totalTokens)} {t('sessions_tokens_label')}
                </div>
                <h2>{selectedSession.model || t('sessions_title')}</h2>
                <div className="meta">
                  <span>{fmtDate(selectedSession.startTime)}</span>
                  <span>{fmtDate(selectedSession.lastTime)}</span>
                  <span>IN {fmtTokens(selectedSession.inputTokens)}</span>
                  <span>OUT {fmtTokens(selectedSession.outputTokens)}</span>
                  <span>{fmtCost(costMap[selectedSession.sessionId] || 0)}</span>
                </div>

                {detailLoading === selectedSession.sessionId ? (
                  <div className="sess-detail-skel-wrapper">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="sess-detail-skel-item">
                        <Skeleton className="sess-detail-skel-av" />
                        <div className="sess-detail-skel-body">
                          <Skeleton style={{ width: '90%', height: 10, marginBottom: 4 }} />
                          <Skeleton style={{ width: '60%', height: 10 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !selectedEvents || selectedEvents.length === 0 ? (
                  <p className="sess-empty-hint muted tiny">{t('sessions_no_data')}</p>
                ) : (
                  selectedEvents.map((ev, idx) => {
                    const role = ev.type === 'user' ? 'user' : 'assistant'
                    const text = ev.message?.text
                    return (
                      <div key={idx} className="msg">
                        <div className="role">
                          <span className={'pill ' + role}>{role}</span>
                        </div>
                        <div className="content">
                          {text || <span className="muted tiny">--</span>}
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

