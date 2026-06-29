import React, { useEffect, useRef, useState } from 'react'
import { Calendar, SendHorizontal, Shield } from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n'
import { apiFetchRaw, apiGet } from '@/lib/wails'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: Record<string, unknown>
  loading?: boolean
}

interface Insight {
  id: string
  type: 'anomaly' | 'savings' | 'suggestion' | 'digest'
  title: string
  description: string
  impact?: string
  action?: { id: string; label: string; payload: Record<string, unknown> }
  when?: string
}

type InsightFilter = 'all' | 'savings' | 'anomaly' | 'suggestion'

interface SummaryData {
  summary?: {
    total_requests: number
    total_tokens: number
    estimated_cost: number
    success_rate: number
    cache_hit_rate: number
  }
}

const GLYPH_SVG: Record<string, React.ReactElement> = {
  savings: (
    <svg className="glyph" viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="2" />
      <path d="M35 50 L45 60 L65 40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  anomaly: (
    <svg className="glyph" viewBox="0 0 100 100" fill="none">
      <polygon points="50,15 85,80 15,80" stroke="currentColor" strokeWidth="2" fill="none" />
      <line x1="50" y1="35" x2="50" y2="55" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="65" r="2" fill="currentColor" />
    </svg>
  ),
  suggestion: (
    <svg className="glyph" viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="40" r="20" stroke="currentColor" strokeWidth="2" />
      <line x1="50" y1="60" x2="50" y2="80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="40" y1="70" x2="60" y2="70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  digest: (
    <svg className="glyph" viewBox="0 0 100 100" fill="none">
      <rect x="20" y="20" width="60" height="60" rx="8" stroke="currentColor" strokeWidth="2" />
      <line x1="30" y1="40" x2="70" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="55" x2="60" y2="55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="70" x2="50" y2="70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
}

export default function Copilot() {
  const { t } = useI18n()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState<Insight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [insightsError, setInsightsError] = useState(false)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [filter, setFilter] = useState<InsightFilter>('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadInsights()
    loadSummary()
    const interval = setInterval(loadInsights, 300000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadInsights = async () => {
    setInsightsLoading(true)
    try {
      const data = await apiGet('/ocgt/api/copilot/insights')
      setInsights(data?.insights || [])
      setInsightsError(false)
    } catch {
      setInsights([])
      setInsightsError(true)
    } finally {
      setInsightsLoading(false)
    }
  }

  const loadSummary = async () => {
    try {
      setSummary(await apiGet<SummaryData>('/ocgt/api/stats/summary?days=7'))
    } catch {
      setSummary(null)
    }
  }

  const handleAsk = async (retryQuery?: string) => {
    const query = retryQuery || input
    if (!query.trim() || loading) return

    if (!retryQuery) {
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: query }])
      setInput('')
    }

    setLoading(true)
    const assistantId = (Date.now() + 1).toString()
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', loading: true }])

    try {
      const resp = await apiFetchRaw('/ocgt/api/copilot/ask', {
        method: 'POST',
        body: JSON.stringify({ query }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() || ''
          for (const event of events) {
            const line = event.split('\n').find((entry) => entry.startsWith('data: '))
            if (!line) continue
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                fullContent += parsed.content
                setMessages((prev) => prev.map((msg) => (
                  msg.id === assistantId ? { ...msg, content: fullContent, data: parsed.data } : msg
                )))
              }
            } catch {}
          }
        }
      }

      setMessages((prev) => prev.map((msg) => (
        msg.id === assistantId ? { ...msg, loading: false } : msg
      )))
    } catch {
      setMessages((prev) => prev.map((msg) => (
        msg.id === assistantId ? { ...msg, content: t('copilot_error'), loading: false } : msg
      )))
    } finally {
      setLoading(false)
    }
  }

  const filteredInsights = filter === 'all'
    ? insights
    : insights.filter((insight) => insight.type === filter)

  const suggestions = [
    t('copilot_suggest1'),
    t('copilot_suggest2'),
    t('copilot_suggest3'),
    t('copilot_suggest4'),
  ]

  const digestSummary = summary?.summary

  return (
    <div id="page-copilot">
      <div className="hero-wrap">
        <div className="askbox">
          <div className="av">AI</div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleAsk()
              }
            }}
            placeholder={t('copilot_placeholder')}
            aria-label={t('copilot_placeholder')}
            disabled={loading}
          />
          <button className="send" onClick={() => handleAsk()} disabled={!input.trim() || loading}>
            <SendHorizontal size={14} />
            {loading ? '...' : t('copilot_ask')}
          </button>
        </div>
        <div className="copilot-actions-bar">
          <button className="btn btn-sm btn-ghost" onClick={() => setMessages([])} disabled={messages.length === 0}>
            {t('copilot_clear_context') || 'Clear context'}
          </button>
        </div>
        <div className="suggestions">
          {suggestions.map((suggestion, index) => (
            <button className="sugg" key={index} onClick={() => setInput(suggestion)}>
              <span className="ic">+</span>
              {suggestion}
            </button>
          ))}
        </div>
        {messages.length > 0 && (
          <div className="copilot-chat-inline">
            {messages.map((msg) => (
              <div key={msg.id} className={`copilot-msg-row ${msg.role === 'user' ? 'user' : ''}`}>
                <div className={`copilot-bubble ${msg.role === 'user' ? 'user' : ''}`}>
                  {msg.loading ? (
                    <span className="typing-dots"><span></span><span></span><span></span></span>
                  ) : (
                    <span className="tiny copilot-msg-content">{msg.content}</span>
                  )}
                  {msg.role === 'assistant' && msg.content === t('copilot_error') && (
                    <div className="copilot-msg-retry">
                      <button className="btn btn-sm" onClick={() => handleAsk(messages[messages.findIndex((m) => m.id === msg.id) - 1]?.content)}>
                        {t('copilot_retry') || 'Retry'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="sec-h">
        <h3>{t('copilot_insights')}</h3>
        <span className="ct">{filteredInsights.length}</span>
        <span className="spacer"></span>
        <div className="segmented">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('copilot_filter_all')}</button>
          <button className={filter === 'savings' ? 'on' : ''} onClick={() => setFilter('savings')}>{t('copilot_filter_savings')}</button>
          <button className={filter === 'anomaly' ? 'on' : ''} onClick={() => setFilter('anomaly')}>{t('copilot_filter_anomaly')}</button>
          <button className={filter === 'suggestion' ? 'on' : ''} onClick={() => setFilter('suggestion')}>{t('copilot_filter_suggest')}</button>
        </div>
      </div>

      <div className="insights">
        {insightsLoading ? (
          <div className="copilot-insights-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="card copilot-insight-card">
                <Skeleton className="copilot-skel-item" style={{ width: '30%', height: 10, marginBottom: 12 }} />
                <Skeleton className="copilot-skel-item" style={{ width: '80%', height: 14, marginBottom: 8 }} />
                <Skeleton className="copilot-skel-item" style={{ width: '100%', height: 10, marginBottom: 6 }} />
                <Skeleton className="copilot-skel-item" style={{ width: '60%', height: 10, marginBottom: 12 }} />
                <Skeleton className="copilot-skel-item" style={{ width: '40%', height: 10 }} />
              </div>
            ))}
          </div>
        ) : insightsError ? (
          <div className="copilot-insights-grid-center">
            <button className="btn btn-sm" onClick={() => { setInsightsError(false); loadInsights() }}>
              {t('retry')}
            </button>
          </div>
        ) : filteredInsights.length === 0 ? (
          <div className="copilot-insights-grid-full">
            <EmptyState
              icon={<Calendar size={20} />}
              title={t('copilot_no_insights') || 'No insights yet'}
              description={t('copilot_no_insights_desc') || 'Insights will appear as your usage patterns emerge.'}
            />
          </div>
        ) : filteredInsights.map((insight) => (
          <div className={`ins-card ${insight.type}`} key={insight.id}>
            <div className="top">
              <span className="badge">{insight.type.toUpperCase()}</span>
              {insight.when && <span className="when">{insight.when}</span>}
            </div>
            <h4>{insight.title}</h4>
            <p>{insight.description}</p>
            {insight.impact && <div className="impact">{insight.impact}</div>}
            {GLYPH_SVG[insight.type]}
          </div>
        ))}
      </div>

      <div className="sec-h copilot-digest-sec">
        <h3>{t('copilot_digest_title')}</h3>
      </div>

      <div className="digest">
        {digestSummary ? (
          <>
            <div className="head">
              <div className="ico">7d</div>
              <div>
                <div className="digest-title">{t('copilot_digest_weekly')}</div>
                <div className="digest-period">最近 7 天</div>
              </div>
            </div>
            <div className="body">
              <div>
                <p>
                  <b>摘要。</b> 最近 7 天网关共处理 {digestSummary.total_requests} 个请求，
                  消耗 {digestSummary.total_tokens.toLocaleString()} tokens，成功率 {digestSummary.success_rate.toFixed(1)}%。
                </p>
                <p>
                  预估费用 ${digestSummary.estimated_cost.toFixed(2)}，缓存命中率 {digestSummary.cache_hit_rate.toFixed(1)}%。
                </p>
              </div>
              <div className="stats">
                <div className="r"><span className="k">{t('copilot_digest_total')}</span><span className="v">{digestSummary.total_requests}</span></div>
                <div className="r"><span className="k">Token</span><span className="v">{digestSummary.total_tokens.toLocaleString()}</span></div>
                <div className="r"><span className="k">{t('copilot_digest_cost')}</span><span className="v">${digestSummary.estimated_cost.toFixed(2)}</span></div>
                <div className="r"><span className="k">缓存命中</span><span className="v">{digestSummary.cache_hit_rate.toFixed(1)}%</span></div>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Calendar size={20} />}
            title={t('copilot_no_digest') || 'No digest available'}
            description={t('copilot_no_digest_desc') || 'Weekly digests will appear here once enough usage data has been collected.'}
          />
        )}
      </div>

      <div className="privacy">
        <span className="ic"><Shield size={14} /></span>
        <span>{t('copilot_privacy')}</span>
      </div>
    </div>
  )
}
