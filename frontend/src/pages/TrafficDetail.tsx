/**
 * TrafficDetail — Single-request detail page (design #page-detail).
 *
 * 2-column layout (1.6fr | 1fr):
 *   Left:  Waterfall timeline + Response body
 *   Right: Metadata KV list + Cost breakdown
 *
 * Navigated to from TrafficMonitor row click via CustomEvent('nav-to-detail', { detail: record }).
 */
import { memo, useEffect, useState } from 'react'
import { ArrowLeft, Share2 } from 'lucide-react'
import { useI18n } from '@/i18n'

/** Mirror the HistoryRecord shape from TrafficMonitor */
export interface DetailRecord {
  time: string
  model: string
  status: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
  duration: number
  client: string
  route: string
  error: string
}

interface Props {
  record: DetailRecord | null
  onBack: () => void
}

/** Estimate cost breakdown from token counts (approximate Claude pricing) */
// Approximate per-token rates; model-specific pricing not available from API
function estimateCost(r: DetailRecord) {
  const inputCost  = (r.input_tokens  || 0) * 0.000003
  const outputCost = (r.output_tokens || 0) * 0.000015
  const cacheCost  = (r.cache_read_tokens || 0) * 0.0000003
  return { inputCost, outputCost, cacheCost, total: inputCost + outputCost + cacheCost }
}

export default memo(function TrafficDetail({ record, onBack }: Props) {
  const { t } = useI18n()
  const [bodyView, setBodyView] = useState<'rendered' | 'raw' | 'sse'>('rendered')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c' && window.getSelection()?.toString() === '') {
        const target = e.target as HTMLElement
        if (target && target.innerText) {
          navigator.clipboard.writeText(target.innerText).then(() => {
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: t('td_copied_clipboard') || 'Copied to clipboard' } }))
          })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [t])

  if (!record) {
    return (
      <div id="page-detail">
        <div className="page-label">
          <span className="idx">4</span>
          <span>REQUEST DETAIL</span>
          <span className="path">/traffic/…</span>
        </div>
        <div className="card td-no-data-card">
          <div className="card-body muted td-no-data-body">
            {t('td_no_data')}
          </div>
        </div>
      </div>
    )
  }

  const reqId = (record as any).id || '—'
  const cost = estimateCost(record)
  const totalDur = record.duration || 182
  const statusOk = record.status >= 200 && record.status < 300

  return (
    <div id="page-detail">
      <div className="page-label">
        <span className="idx">4</span>
        <span>REQUEST DETAIL</span>
        <span className="path">/traffic/{reqId}</span>
      </div>

      {/* Hero row */}
      <div className="row between td-hero-row">
        <div>
          <h1 className="hero">{t('td_summary')} <em>{t('td_request_id')}</em></h1>
          <p className="lede">{t('td_headers_hint')}</p>
        </div>
        <div className="row gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onBack}>
            <ArrowLeft width={14} height={14} /> {t('td_back')}
          </button>
          {(record as any).id && (
            <button className="btn btn-sm" onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/traffic/${reqId}`)
              window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: t('td_link_copied') } }))
            }}><Share2 width={14} height={14} /> {t('td_share')}</button>
          )}
        </div>
      </div>

      {/* 2-column layout: 1.6fr | 1fr */}
      <div className="td-grid-2col">
        {/* ── LEFT COLUMN ── */}
        <div className="td-col">
          {/* Waterfall Timeline */}
          <div className="card">
            <div className="card-h">{t('td_waterfall')}</div>
            <div className="card-body td-waterfall-body">
              {(() => {
                // Simulate waterfall steps based on duration
                const totalDur = record.duration || 182
                const steps = [
                  { label: t('td_wf_dns'), pct: 5, color: 'var(--link)' },
                  { label: t('td_wf_connect'), pct: 8, color: 'var(--link)' },
                  { label: t('td_wf_tls'), pct: 12, color: 'var(--link)' },
                  { label: t('td_wf_send'), pct: 5, color: 'var(--online)' },
                  { label: t('td_wf_wait'), pct: 55, color: 'var(--warn)' },
                  { label: t('td_wf_receive'), pct: 15, color: 'var(--online)' },
                ]
                let offset = 0
                return steps.map((step, i) => {
                  const width = step.pct
                  const left = offset
                  offset += width
                  return (
                    <div key={i} className="td-wf-row">
                      <span className="td-wf-label muted tiny">{step.label}</span>
                      <div className="td-wf-bar-track">
                        <div
                          className="td-wf-bar"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: step.color,
                          }}
                        />
                      </div>
                      <span className="td-wf-time mono tiny">{Math.round(totalDur * width / 100)}ms</span>
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* Response body */}
          <div className="card">
            <div className="card-h">
              {t('td_response_body')}
              <div className="actions">
                <div className="segmented">
                  <button className={bodyView === 'rendered' ? 'on' : ''} onClick={() => setBodyView('rendered')}>{t('td_rendered')}</button>
                  <button className={bodyView === 'raw' ? 'on' : ''} onClick={() => setBodyView('raw')}>{t('td_raw')}</button>
                  <button className={bodyView === 'sse' ? 'on' : ''} onClick={() => setBodyView('sse')}>{t('td_sse')}</button>
                </div>
              </div>
            </div>
            <div className="card-body td-body-text">
              {bodyView === 'sse' ? (
                <div className="muted">{t('td_sse_not_available')}</div>
              ) : bodyView === 'raw' ? (
                <pre className="mono tiny">{JSON.stringify(record, null, 2)}</pre>
              ) : record.error ? (
                <pre className="json-block td-error-block">
                  <span className="c td-error-span">/* Error */</span>{'\n'}
                  {record.error}
                </pre>
              ) : (
                <p className="td-info-p">
                  {t('td_response_body_note')}{' '}
                  <code className="inl">{record.model || 'unknown'}</code> returned{' '}
                  <code className="inl">{record.status}</code> with{' '}
                  <code className="inl">{record.output_tokens || 0}</code> output tokens.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="td-col">
          {/* Metadata */}
          <div className="card">
            <div className="card-h">{t('td_summary')}</div>
            <div className="card-body td-timeline-body">
              <div className="kv-list">
                <div className="row"><span className="k">{t('td_request_id')}</span><span className="v">{reqId}</span></div>
                <div className="row"><span className="k">{t('td_client_label')}</span><span className="v">{record.client || '-'}</span></div>
                <div className="row"><span className="k">{t('td_model')}</span><span className="v">{record.model || '-'}</span></div>
                <div className="row"><span className="k">{t('td_upstream_label')}</span><span className="v">{record.route || '-'}</span></div>
                <div className="row">
                  <span className="k">{t('td_status')}</span>
                  <span className="v">
                    {statusOk ? (
                      <span className="tag green">{record.status} OK</span>
                    ) : record.status >= 500 ? (
                      <span className="tag td-tag-error">{record.status}</span>
                    ) : (
                      <span className="tag amber">{record.status}</span>
                    )}
                  </span>
                </div>
                <div className="row">
                  <span className="k">{t('td_cache_label')}</span>
                  <span className="v">{record.cache_read_tokens > 0 ? `hit · ${record.cache_read_tokens} tok` : 'miss → write'}</span>
                </div>
                <div className="row"><span className="k">{t('td_duration')}</span><span className="v">{totalDur}ms</span></div>
                <div className="row"><span className="k">{t('td_time')}</span><span className="v">{record.time ? new Date(record.time).toLocaleString() : '-'}</span></div>
              </div>
            </div>
          </div>

          {/* Cost */}
          <div className="card">
            <div className="card-h">{t('td_cost')}</div>
            <div className="card-body">
              <div className="row between td-cost-row">
                <span className="muted tiny">{t('td_input')} · {(record.input_tokens || 0).toLocaleString()} tok</span>
                <span className="mono">${cost.inputCost.toFixed(4)}</span>
              </div>
              <div className="row between td-cost-row">
                <span className="muted tiny">{t('td_output')} · {(record.output_tokens || 0).toLocaleString()} tok</span>
                <span className="mono">${cost.outputCost.toFixed(4)}</span>
              </div>
              <div className="row between td-cost-row">
                <span className="muted tiny">{t('td_cache_read')} · {record.cache_read_tokens || 0}</span>
                <span className="mono">${cost.cacheCost.toFixed(4)}</span>
              </div>
              <div className="hbar td-hbar" />
              <div className="row between">
                <b className="mono td-total-label">{t('td_total')}</b>
                <b className="mono td-total-label">${cost.total.toFixed(4)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
