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
import { useToast } from '@/hooks/toast'

/** Mirror the HistoryRecord shape from TrafficMonitor */
export interface DetailRecord {
  id?: string
  time: string
  model: string
  status: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  total_tokens: number
  duration?: number
  client: string
  route: string
  error: string
}

interface Props {
  record: DetailRecord | null
  onBack: () => void
}

export default memo(function TrafficDetail({ record, onBack }: Props) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [bodyView, setBodyView] = useState<'rendered' | 'raw' | 'sse'>('rendered')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c' && window.getSelection()?.toString() === '') {
        const target = e.target as HTMLElement
        if (target && target.innerText) {
          navigator.clipboard.writeText(target.innerText).then(() => {
            toast(t('td_copied_clipboard'), 'success')
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
        <div className="card td-no-data-card">
          <div className="card-body muted td-no-data-body">
            {t('td_no_data')}
          </div>
        </div>
      </div>
    )
  }

  const reqId = record.id || '-'
  const totalDur = typeof record.duration === 'number' ? Math.round(record.duration) : null
  const cacheTokens = (record.cache_read_tokens || 0) + (record.cache_creation_tokens || 0)
  const statusOk = record.status >= 200 && record.status < 300

  return (
    <div id="page-detail">

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
          {record.id && (
            <button className="btn btn-sm" onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/traffic/${reqId}`)
              toast(t('td_link_copied'), 'success')
            }}><Share2 width={14} height={14} /> {t('td_share')}</button>
          )}
        </div>
      </div>

      {/* 2-column layout: 1.6fr | 1fr */}
      <div className="td-grid-2col">
        {/* ── LEFT COLUMN ── */}
        <div className="td-col">
          {/* Timing */}
          <div className="card">
            <div className="card-h">{t('td_duration')}</div>
            <div className="card-body td-waterfall-body">
              <div className="kv-list">
                <div className="row"><span className="k">{t('td_duration')}</span><span className="v">{totalDur === null ? '-' : `${totalDur}ms`}</span></div>
              </div>
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
                <p className="td-info-p">Response body is not recorded for this request.</p>
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
                  <span className="v">{cacheTokens > 0 ? `${cacheTokens} tok` : '-'}</span>
                </div>
                <div className="row"><span className="k">{t('td_duration')}</span><span className="v">{totalDur === null ? '-' : `${totalDur}ms`}</span></div>
                <div className="row"><span className="k">{t('td_time')}</span><span className="v">{record.time ? new Date(record.time).toLocaleString() : '-'}</span></div>
              </div>
            </div>
          </div>

          {/* Tokens */}
          <div className="card">
            <div className="card-h">{t('td_tokens')}</div>
            <div className="card-body">
              <div className="row between td-cost-row">
                <span className="muted tiny">{t('td_input')} · {(record.input_tokens || 0).toLocaleString()} tok</span>
                <span className="mono">{(record.input_tokens || 0).toLocaleString()}</span>
              </div>
              <div className="row between td-cost-row">
                <span className="muted tiny">{t('td_output')} · {(record.output_tokens || 0).toLocaleString()} tok</span>
                <span className="mono">{(record.output_tokens || 0).toLocaleString()}</span>
              </div>
              <div className="row between td-cost-row">
                <span className="muted tiny">{t('td_cache_read')} · {record.cache_read_tokens || 0}</span>
                <span className="mono">{record.cache_read_tokens || 0}</span>
              </div>
              <div className="hbar td-hbar" />
              <div className="row between">
                <b className="mono td-total-label">{t('td_total')}</b>
                <b className="mono td-total-label">{(record.total_tokens || 0).toLocaleString()}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
