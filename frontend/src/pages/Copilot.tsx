import React, { useState, useEffect, useRef } from 'react'
import {
  Shield, Calendar,
} from 'lucide-react'
import { EmptyState, Skeleton } from '@/components/ui'
import { errMessage } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { apiGet, apiFetch, apiFetchRaw, wails } from '@/lib/wails'

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

type FilterType = 'all' | 'savings' | 'anomaly' | 'suggest'

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
  suggest: (
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
  const { toast } = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState<Insight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [insightsError, setInsightsError] = useState(false)
  const [confirmAction, setConfirmAction] = useState<Insight['action'] | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadInsights()
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
    } catch {
      // silent: proxy may not be running
      setInsights([])
      setInsightsError(true)
    } finally {
      setInsightsLoading(false)
    }
  }

  const handleAsk = async (retryQuery?: string) => {
    const queryToUse = retryQuery || input;
    if (!queryToUse.trim() || loading) return

    if (!retryQuery) {
      const userMsg: Message = { id: Date.now().toString(), role: 'user', content: queryToUse }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
    }
    setLoading(true)

    const assistantId = (Date.now() + 1).toString()
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', loading: true }])

    try {
      const resp = await apiFetchRaw('/ocgt/api/copilot/ask', {
        method: 'POST',
        body: JSON.stringify({ query: queryToUse }),
      })

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))
          for (const line of lines) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                fullContent += parsed.content
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent, data: parsed.data } : m))
                )
              }
            } catch {}
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, loading: false } : m))
      )
    } catch (err: unknown) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: t('copilot_error'), loading: false }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  const handleClearContext = () => {
    setMessages([])
  }

  const handleAction = async (action: Insight['action']) => {
    if (!action) return
    setConfirmAction(action)
  }

  const executeAction = async () => {
    if (!confirmAction) return
    try {
      const resp = await apiFetch(`/ocgt/api/copilot/action/${confirmAction.id}`, {
        method: 'POST',
        body: JSON.stringify(confirmAction.payload),
      })
      if (resp?.success) {
        toast(t('copilot_action_done'), 'success')
        loadInsights()
      } else {
        throw new Error(resp?.error || t('copilot_action_failed'))
      }
    } catch (err: unknown) {
      toast(errMessage(err) || t('copilot_action_failed'), 'error')
    } finally {
      setConfirmAction(null)
    }
  }

  const filteredInsights = filter === 'all'
    ? insights
    : insights.filter((ins) => ins.type === filter)

  const filterCounts = {
    all: insights.length,
    savings: insights.filter((i) => i.type === 'savings').length,
    anomaly: insights.filter((i) => i.type === 'anomaly').length,
    suggest: insights.filter((i) => i.type === 'suggestion').length,
  }

  const suggestions = [
    t('copilot_suggest1'),
    t('copilot_suggest2'),
    t('copilot_suggest3'),
    t('copilot_suggest4'),
  ]

  return (
    <div id="page-copilot">
      <div className="hero-wrap">
        <div className="askbox">
          <div className="av">AI</div>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }} placeholder={t('copilot_placeholder')} aria-label={t('copilot_placeholder')} disabled={loading} />
          <button className="send" onClick={() => handleAsk()} disabled={!input.trim() || loading}>{loading ? '...' : t('copilot_ask')}</button>
        </div>
        <div className="copilot-actions-bar">
          <button className="btn btn-sm btn-ghost" onClick={handleClearContext} disabled={messages.length === 0}>{t('copilot_clear_context') || 'Clear context'}</button>
        </div>

        <div className="suggestions">
          {suggestions.map((s, i) => (<button className="sugg" key={i} onClick={() => setInput(s)}><span className="ic">›</span>{s}</button>))}
        </div>
      </div>

      {/* Active Insights Section */}
      <div className="sec-h">
        <h3>{t('copilot_insights')}</h3>
        <span className="ct">{filteredInsights.length}</span>
        <span className="spacer"></span>
        <div className="segmented">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('copilot_filter_all')}</button>
          <button className={filter === 'savings' ? 'on' : ''} onClick={() => setFilter('savings')}>{t('copilot_filter_savings')}</button>
          <button className={filter === 'anomaly' ? 'on' : ''} onClick={() => setFilter('anomaly')}>{t('copilot_filter_anomaly')}</button>
          <button className={filter === 'suggest' ? 'on' : ''} onClick={() => setFilter('suggest')}>{t('copilot_filter_suggest')}</button>
        </div>
      </div>

      <div className="insights">
        {insightsLoading ? (
          <div className="copilot-insights-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card copilot-insight-card">
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
              ↻ {t('retry')}
            </button>
          </div>
        ) : filteredInsights.length === 0 ? (
          <div className="copilot-insights-grid-full">
            <EmptyState icon="💡" title={t('copilot_no_insights') || 'No insights yet'} description={t('copilot_no_insights_desc') || 'Insights will appear as your usage patterns emerge.'} />
          </div>
        ) : filteredInsights.map((insight) => (
          <div className={`ins-card ${insight.type}`} key={insight.id}>
            <div className="top">
              <span className="badge">{insight.type.toUpperCase()}</span>
              {insight.when && <span className="when">{insight.when}</span>}
            </div>
            <h4>{insight.title}</h4>
            <p>{insight.description}</p>
            {insight.impact && (
              <div className="impact">{insight.impact}</div>
            )}
            {insight.action && (
              <div className="actions">
                <button className="btn btn-sm btn-primary" onClick={() => handleAction(insight.action!)}>
                  {insight.action.label}
                </button>
              </div>
            )}
            {GLYPH_SVG[insight.type]}
          </div>
        ))}
      </div>

      {/* Last Digest Section */}
      <div className="sec-h copilot-digest-sec">
        <h3>{t('copilot_digest_title')}</h3>
      </div>

      <div className="digest">
        <EmptyState icon={<Calendar size={20} />} title={t('copilot_no_digest') || 'No digest available'} description={t('copilot_no_digest_desc') || 'Weekly digests will appear here once enough usage data has been collected.'} />
      </div>

      {/* Privacy Disclaimer */}
      <div className="privacy">
        <span className="ic"><Shield size={14} /></span>
        <span>{t('copilot_privacy')}</span>
      </div>

      {/* Chat Modal / Inline Chat Area */}
      {messages.length > 0 && (
        <div className="card copilot-chat-card">
          <div className="card-h">
            {t('title_copilot')}
            <div className="actions"><span className="tag">{messages.length} msgs</span></div>
          </div>
          <div className="card-body copilot-chat-body">
            {messages.map((msg) => (
              <div key={msg.id} className={`copilot-msg-row ${msg.role === 'user' ? 'user' : ''}`}>
                <div className={`copilot-bubble ${msg.role === 'user' ? 'user' : ''}`}>
                  {msg.loading ? (<span className="typing-dots"><span></span><span></span><span></span></span>) : (<span className="tiny copilot-msg-content">{msg.content}</span>)}
                  {msg.role === 'assistant' && msg.content === t('copilot_error') && (
                    <div className="copilot-msg-retry">
                       <button className="btn btn-sm" onClick={() => handleAsk(messages[messages.findIndex(m => m.id === msg.id) - 1]?.content)}>{t('copilot_retry') || 'Retry'}</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmAction && (
        <div className="modal-overlay copilot-modal" onClick={() => setConfirmAction(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <h3>{t('copilot_confirm_action')}</h3>
              <span className="spacer"></span>
              <button aria-label={t('aria_close')} className="x" onClick={() => setConfirmAction(null)}>×</button>
            </div>
            <div className="mb">
              <p className="tiny muted">{t('copilot_confirm_msg')}</p>
            </div>
            <div className="mf">
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmAction(null)}>{t('about_close')}</button>
              <button className="btn btn-sm btn-primary" onClick={executeAction}>{t('copilot_execute')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
