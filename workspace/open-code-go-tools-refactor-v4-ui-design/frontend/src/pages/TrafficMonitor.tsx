import { useState, useEffect, useMemo } from 'react'
import { Activity, CheckCircle, Clock, Coins, ArrowDownToLine, ArrowUpFromLine, Database, Target, ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { apiGet } from '@/lib/wails'
import { fmtTokens, fmtCost, fmtNum } from '@/lib/utils'

const COLORS = ['var(--ink-500)', 'var(--ink-400)', 'var(--ink-300)', 'var(--ink-600)', 'var(--ink-200)', 'var(--ink-700)', 'var(--ink-100)']

const RANGES = [
  { v: '1d', days: 1 },
  { v: '7d', days: 7 },
  { v: '30d', days: 30 },
  { v: '90d', days: 90 },
] as const

interface SummaryData {
  summary: {
    total_requests: number
    success_count: number
    success_rate: number
    avg_latency_ms: number
    total_tokens: number
    total_input_tokens: number
    total_output_tokens: number
    total_cache_read_tokens: number
    total_cache_create_tokens: number
    estimated_cost: number
    cache_hit_rate: number
  }
  by_client: { name: string; requests: number; pct: number }[]
}

interface TrendData {
  daily: { date: string; total_tokens: number; input_tokens: number; output_tokens: number; requests: number }[]
  granularity: string
}

interface ModelsData {
  models: {
    name: string
    requests: number
    total_tokens: number
    input_tokens: number
    output_tokens: number
    cache_tokens: number
    cache_hit_rate: number
    cost_usd: number
    pct: number
  }[]
}

interface HistoryEntry {
  id: string
  time: string
  method: string
  path: string
  status: number
  duration: string
  model: string
  route: string
  client?: string
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  error?: string
}

// ── Area Chart ──────────────────────────────────────────────────────────

function AreaChart({ data }: { data: TrendData['daily'] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const W = 720, H = 220, PL = 52, PR = 16, PT = 16, PB = 32
  const cw = W - PL - PR, ch = H - PT - PB

  const maxVal = useMemo(() => {
    let m = 0
    for (const d of data) { m = Math.max(m, d.input_tokens, d.output_tokens) }
    return m || 1
  }, [data])

  const yScale = (v: number) => PT + ch - (v / maxVal) * ch
  const xStep = data.length > 1 ? cw / (data.length - 1) : cw

  const buildPath = (key: 'input_tokens' | 'output_tokens') => {
    if (data.length === 0) return ''
    const pts = data.map((d, i) => `${PL + i * xStep},${yScale(d[key])}`)
    const line = `M${pts.join(' L')}`
    const area = `${line} L${PL + (data.length - 1) * xStep},${PT + ch} L${PL},${PT + ch} Z`
    return { line, area }
  }

  const inputPath = buildPath('input_tokens')
  const outputPath = buildPath('output_tokens')

  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => PT + ch * (1 - f))

  const hoverX = hoverIdx !== null ? PL + hoverIdx * xStep : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tm-svg">
      <defs>
        <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--online)', stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: 'var(--online)', stopOpacity: 0.03 }} />
        </linearGradient>
        <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--danger)', stopOpacity: 0.30 }} />
          <stop offset="100%" style={{ stopColor: 'var(--danger)', stopOpacity: 0.03 }} />
        </linearGradient>
      </defs>

      {/* grid lines */}
      {gridY.map((y, i) => (
        <g key={i}>
          <line x1={PL} y1={y} x2={PL + cw} y2={y} stroke="var(--line)" strokeWidth="1" strokeDasharray={i === 0 ? '' : '3,3'} />
          <text x={PL - 6} y={y + 3.5} textAnchor="end" fill="var(--ink-400)" fontSize="10" fontFamily="var(--mono)">
            {fmtTokens(Math.round(maxVal * (i / 4)))}
          </text>
        </g>
      ))}

      {/* x labels */}
      {data.map((d, i) => {
        const show = data.length <= 14 || i % Math.ceil(data.length / 10) === 0 || i === data.length - 1
        if (!show) return null
        const lbl = d.date.length > 5 ? d.date.slice(5) : d.date
        return <text key={i} x={PL + i * xStep} y={H - 6} textAnchor="middle" fill="var(--ink-400)" fontSize="10" fontFamily="var(--mono)">{lbl}</text>
      })}

      {/* area fills */}
      {typeof inputPath === 'object' && <path d={inputPath.area} fill="url(#gIn)" />}
      {typeof outputPath === 'object' && <path d={outputPath.area} fill="url(#gOut)" />}

      {/* lines */}
      {typeof inputPath === 'object' && <path d={inputPath.line} fill="none" stroke="var(--ink-500)" strokeWidth="2" strokeLinejoin="round" />}
      {typeof outputPath === 'object' && <path d={outputPath.line} fill="none" stroke="var(--ink-400)" strokeWidth="2" strokeLinejoin="round" />}

      {/* data points */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={PL + i * xStep} cy={yScale(d.input_tokens)} r="3" fill="var(--ink-500)" stroke="var(--paper, #fff)" strokeWidth="1.5" />
          <circle cx={PL + i * xStep} cy={yScale(d.output_tokens)} r="3" fill="var(--ink-400)" stroke="var(--paper, #fff)" strokeWidth="1.5" />
        </g>
      ))}

      {/* hover zone */}
      {data.map((_, i) => (
        <rect key={i} x={PL + i * xStep - xStep / 2} y={PT} width={xStep} height={ch} fill="transparent"
          onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
      ))}

      {/* hover marker */}
      {hoverIdx !== null && hoverX !== null && (
        <g>
          <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + ch} stroke="var(--ink-700)" strokeWidth="1" strokeDasharray="4,3" />
          <circle cx={hoverX} cy={yScale(data[hoverIdx].input_tokens)} r="5" fill="var(--online)" stroke="var(--paper, #fff)" strokeWidth="2" />
          <circle cx={hoverX} cy={yScale(data[hoverIdx].output_tokens)} r="5" fill="var(--danger)" stroke="var(--paper, #fff)" strokeWidth="2" />
          <rect x={hoverX - 50} y={PT - 2} width="100" height="28" rx="4" fill="var(--ink-800)" opacity="0.9" />
          <text x={hoverX} y={PT + 14} textAnchor="middle" fill="#fff" fontSize="10" fontFamily="var(--mono)">
            {data[hoverIdx].date} · {fmtTokens(data[hoverIdx].input_tokens + data[hoverIdx].output_tokens)}
          </text>
        </g>
      )}
    </svg>
  )
}

// ── Donut Chart ─────────────────────────────────────────────────────────

function DonutChart({ models }: { models: ModelsData['models'] }) {
  const { t } = useI18n()
  const total = models.reduce((s, m) => s + m.total_tokens, 0)
  const r = 54, sw = 16, cx = 64, cy = 64
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="pie">
      <div className="ring tm-relative">
        <svg viewBox="0 0 128 128" width="140" height="140">
          {models.map((m, i) => {
            const pct = total > 0 ? m.total_tokens / total : 0
            const dash = pct * circ
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={COLORS[i % COLORS.length]} strokeWidth={sw}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset} />
            )
            offset += dash
            return el
          })}
          <circle cx={cx} cy={cy} r={r - sw / 2} fill="var(--paper, #fff)" />
        </svg>
        <div className="tm-donut-center">
          <span className="tm-donut-count">{models.length}</span>
          <span className="tm-donut-label">{t('sessions_models')}</span>
        </div>
      </div>
      <div className="legend2">
        {models.map((m, i) => (
          <div className="row" key={i}>
            <span className="sw" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="nm">{m.name}</span>
            <span className="vv">{m.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────

const PAGE_SIZE = 10

export default function TrafficMonitor() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('7d')
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [models, setModels] = useState<ModelsData | null>(null)
  const [reqPage, setReqPage] = useState(0)
  const [recentRequests, setRecentRequests] = useState<HistoryEntry[]>([])

  useEffect(() => { load() }, [range])

  async function load() {
    setLoading(true)
    const days = RANGES.find((r) => r.v === range)?.days ?? 7
    try {
      const [s, tr, m] = await Promise.all([
        apiGet<SummaryData>(`/ocgt/api/stats/summary?days=${days}`),
        apiGet<TrendData>(`/ocgt/api/stats/trend?days=${days}`),
        apiGet<ModelsData>(`/ocgt/api/stats/models?days=${days}`),
      ])
      setSummary(s); setTrend(tr); setModels(m)
      // Fetch recent request history
      try {
        const hist = await apiGet<HistoryEntry[]>(`/ocgt/api/history?days=${days}`)
        setRecentRequests(Array.isArray(hist) ? hist.slice(0, 50) : [])
      } catch { setRecentRequests([]) }
    } catch {
      toast(t('toast_traffic_load_failed'), 'error')
      setSummary(null); setTrend(null); setModels(null)
    } finally { setLoading(false) }
  }

  const s = summary?.summary

  // Calculate trend delta from daily data
  const today = trend?.daily?.[trend.daily.length - 1]
  const prev = trend?.daily?.[trend.daily.length - 2]
  const pctDelta = (cur: number, old: number) => old > 0 ? ((cur - old) / old * 100) : 0
  const tokDelta = today && prev ? pctDelta(today.total_tokens, prev.total_tokens) : null

  const statCards = [
    { label: t('tm_total_requests'), value: s ? fmtNum(s.total_requests) : '-', icon: Activity, color: 'var(--danger)' },
    { label: t('tm_success_rate'), value: s ? `${s.success_rate.toFixed(1)}%` : '-', icon: CheckCircle, color: 'var(--online)' },
    { label: t('tm_avg_latency'), value: s ? `${fmtNum(Math.round(s.avg_latency_ms))}ms` : '-', icon: Clock, color: 'var(--warn)' },
    { label: t('tm_token_usage'), value: s ? fmtTokens(s.total_tokens) : '-', icon: Target, color: 'var(--online)' },
    { label: t('tm_input'), value: s ? fmtTokens(s.total_input_tokens) : '-', icon: ArrowDownToLine, color: 'var(--link)' },
    { label: t('tm_output'), value: s ? fmtTokens(s.total_output_tokens) : '-', icon: ArrowUpFromLine, color: 'var(--danger)' },
    { label: t('tm_cache'), value: s ? fmtTokens(s.total_cache_read_tokens + s.total_cache_create_tokens) : '-', icon: Database, color: 'var(--warn)' },
    { label: t('tm_cache_hit_rate'), value: s ? `${(s.cache_hit_rate * 100).toFixed(1)}%` : '-', icon: Coins, color: 'var(--danger)' },
  ]

  const rangeLabel = (v: string) => {
    if (v === '1d') return t('td_today')
    if (v === '7d') return t('td_7d')
    if (v === '30d') return t('td_30d')
    return t('tm_all')
  }

  const mappedRequests = recentRequests.map(r => ({
    time: typeof r.time === 'string' ? new Date(r.time).toLocaleTimeString() : '-',
    id: r.id,
    client: r.client || r.route || '-',
    model: r.model || '-',
    inp: r.input_tokens || 0,
    out: r.output_tokens || 0,
    latency: r.duration ? parseFloat(r.duration) || 0 : 0,
    ok: r.status >= 200 && r.status < 300,
  }))

  const reqTotal = mappedRequests.length
  const reqPages = Math.ceil(reqTotal / PAGE_SIZE)
  const pageRows = mappedRequests.slice(reqPage * PAGE_SIZE, (reqPage + 1) * PAGE_SIZE)

  return (
    <div id="page-traffic">
      <div className="page-label"><span className="idx">3</span><span>{t('page_traffic_monitor')}</span><span className="path">/traffic</span></div>

      <div className="hero-row">
        <div>
          <h1 className="hero">{t('tm_hero_title')} <em>{t('tm_hero_title_em') || ''}</em></h1>
          <p className="lede">{t('tm_hero_desc')}</p>
        </div>
        <div className="row gap-2">
          <div className="segmented">
            {RANGES.map((r) => (<button key={r.v} className={range === r.v ? 'on' : ''} onClick={() => setRange(r.v)}>{rangeLabel(r.v)}</button>))}
          </div>
          <button className="btn btn-sm" onClick={() => {
            if (!summary) return
            const csv = `Metric,Value\nTotal Requests,${summary.summary.total_requests}\nSuccess Rate,${summary.summary.success_rate.toFixed(1)}%\nAvg Latency,${Math.round(summary.summary.avg_latency_ms)}ms\nTotal Tokens,${summary.summary.total_tokens}\nEstimated Cost,$${summary.summary.estimated_cost.toFixed(2)}`
            const blob = new Blob([csv], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = `ocgt-stats-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url)
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export
          </button>
        </div>
      </div>

      {loading ? (
        <div className="tm-loading-wrap">
          <div className="tm-loading-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card tm-loading-card">
                <Skeleton className="tm-skel-1" />
                <Skeleton className="tm-skel-2" />
              </div>
            ))}
          </div>
          <Skeleton className="tm-loading-chart" />
        </div>
      ) : !summary && !trend && !models ? (
        <div className="card">
          <EmptyState icon={<Activity width={28} height={28} />} title={t('td_no_data') || 'No data yet'} description={t('tm_no_data_desc') || 'No traffic recorded for this period.'} />
        </div>
      ) : (
        <>
          {/* ── Stat cards ── */}
          <div className="grid-stats">
            {statCards.map((c) => (
              <div className="stat" key={c.label}><div className="lbl">{c.label}</div><div className="v">{c.value}</div></div>
            ))}
          </div>

          {/* ── Token Trend Area Chart ── */}
          <div className="card chart-card">
            <div className="card-body tm-p-0">
              <div className="chart-head tm-chart-head">
                <div className="titles">
                  <h4>{t('tm_token_trend')} · {trend?.granularity || 'daily'}</h4>
                  <span>{rangeLabel(range)}</span>
                </div>
                <div className="tm-text-right">
                  <div className="big">{summary ? fmtTokens(s?.total_tokens ?? 0) : '-'}</div>
                  <div className="sub-big">{summary && tokDelta !== null ? `${tokDelta >= 0 ? '+' : ''}${tokDelta.toFixed(1)}% vs prev. ${range}` : t('tm_token_trend')}</div>
                </div>
                <div className="legend">
                  <span><i className="tm-legend-in" /> {t('tm_input')} · {summary ? fmtTokens(s?.total_input_tokens ?? 0) : '-'}</span>
                  <span><i className="tm-legend-out" /> {t('tm_output')} · {summary ? fmtTokens(s?.total_output_tokens ?? 0) : '-'}</span>
                </div>
              </div>
              {trend?.daily?.length ? (
                <div className="tm-chart-body">
                  <AreaChart data={trend.daily} />
                </div>
              ) : (
                <div className="tm-chart-empty">
                  <span className="muted tiny">{t('tm_chart_loading')}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Model Donut + Client Table ── */}
          <div className="grid2">
            <div className="card">
              <div className="card-h">{t('tm_model_distribution')}</div>
              <div className="card-body">
                {models?.models?.length ? (
                  <DonutChart models={models.models} />
                ) : (
                  <div className="tm-donut-empty">
                    <span className="muted tiny">{t('td_no_data')}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-h">{t('tm_client_source')}</div>
              <div className="table-wrap">
              <table className="table table-fixed">
                <thead>
                  <tr>
                    <th>{t('tm_client_name')}</th>
                    <th className="num">Req</th>
                    <th className="num">{t('tm_p50')}</th>
                    <th className="num">{t('tm_p95')}</th>
                    <th className="num">{t('tm_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.by_client?.map((c, i) => {
                    const cost = s ? (s.estimated_cost * (c.pct / 100)) : 0
                    return (
                      <tr key={c.name}>
                        <td title={c.name}>
                          <span className="row gap-2">
                            <span className="dot online" />
                            <span>{c.name}</span>
                          </span>
                        </td>
                        <td className="num mono tiny">{fmtNum(c.requests)}</td>
                        <td className="num mono tiny">—</td>
                        <td className="num mono tiny">—</td>
                        <td className="num mono tiny">{fmtCost(cost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          {/* ── Model Breakdown ── */}
          <div className="card">
            <div className="card-h">{t('tm_model_breakdown')}</div>
            <div className="card-body tm-table-wrap">
              <table className="table">
                <thead><tr><th>{t('tm_model')}</th><th className="num">{t('tm_requests')}</th><th className="num">{t('tm_input')}</th><th className="num">{t('tm_output')}</th><th className="num">{t('tm_total')}</th><th className="num">{t('tm_pct')}</th><th className="num">{t('tm_cost')}</th></tr></thead>
                <tbody>
                  {models?.models?.map((m, i) => (
                    <tr key={m.name}>
                      <td><span className="tm-row"><span className="tm-model-dot" style={{ backgroundColor: COLORS[i % COLORS.length] }} /><span className="mono tiny">{m.name}</span></span></td>
                      <td className="num mono tiny">{fmtNum(m.requests)}</td>
                      <td className="num mono tiny">{fmtTokens(m.input_tokens)}</td>
                      <td className="num mono tiny">{fmtTokens(m.output_tokens)}</td>
                      <td className="num mono tiny"><b>{fmtTokens(m.total_tokens)}</b></td>
                      <td className="num mono tiny">{m.pct.toFixed(1)}%</td>
                      <td className="num mono tiny">{fmtCost(m.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Recent Requests ── */}
          <div className="card tm-mt-18">
            <div className="card-h">
              {t('tm_recent_requests')}
              <div className="actions">
                <span className="tag">{reqTotal} {t('td_records')}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  const jsonl = pageRows.map(r => JSON.stringify(r)).join("\n")
                  const blob = new Blob([jsonl], { type: "application/jsonl" })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a"); a.href = url; a.download = `ocgt-recent-reqs-${new Date().toISOString().slice(0,10)}.jsonl`; a.click(); URL.revokeObjectURL(url)
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="tm-mr-4">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {t('td_export')}
                </button>
              </div>
            </div>
            <div className="card-body tm-table-wrap">
              {pageRows.length > 0 ? (
                <>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('td_time')}</th>
                        <th>ID</th>
                        <th>{t('tm_client_name')}</th>
                        <th>{t('tm_model')}</th>
                        <th className="num">{t('tm_input')}</th>
                        <th className="num">{t('tm_output')}</th>
                        <th className="num">{t('tm_latency')}</th>
                        <th>{t('tm_status_col')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r, i) => (
                        <tr key={i}>
                          <td className="mono tiny">{r.time}</td>
                          <td className="mono tiny">{r.id}</td>
                          <td className="mono tiny">{r.client}</td>
                          <td className="mono tiny">{r.model}</td>
                          <td className="num mono tiny">{fmtTokens(r.inp)}</td>
                          <td className="num mono tiny">{fmtTokens(r.out)}</td>
                          <td className="num mono tiny">{r.latency}ms</td>
                          <td>
                            <span className={`tm-status-badge ${r.ok ? '' : 'err'}`}>
                              {r.ok ? '200' : '500'}
                            </span>
                          </td>
                          <td>
                            <button className="btn btn-sm btn-ghost tm-btn-nav" onClick={() => {
                              window.dispatchEvent(new CustomEvent('nav-to-detail', { detail: {
                                time: r.time, model: r.model, status: r.ok ? 200 : 500,
                                input_tokens: r.inp, output_tokens: r.out,
                                cache_read_tokens: 0, cache_creation_tokens: 0,
                                total_tokens: r.inp + r.out, duration: r.latency,
                                client: r.client, route: '', error: r.ok ? '' : 'Internal error',
                              }}))
                            }}>→</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* pagination */}
                  <div className="row between tm-pagination">
                    <span>{reqPage * PAGE_SIZE + 1}–{Math.min((reqPage + 1) * PAGE_SIZE, reqTotal)} / {reqTotal}</span>
                    <div className="row gap-2">
                       <button aria-label={t('aria_prev_page')} className="btn btn-sm btn-ghost" disabled={reqPage === 0} onClick={() => setReqPage(p => p - 1)}>
                        <ChevronLeft size={14} /> {t('td_prev')}
                      </button>
                       <button aria-label={t('aria_next_page')} className="btn btn-sm btn-ghost" disabled={reqPage >= reqPages - 1} onClick={() => setReqPage(p => p + 1)}>
                        {t('td_next')} <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="muted tm-no-data">{t('td_no_data')}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
