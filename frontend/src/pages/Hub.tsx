import { useEffect, useState, memo } from 'react'
import { Globe, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { apiGet, apiFetch, isWails, wails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { Skeleton } from '@/components/ui'
import { fmtTokens } from '@/lib/utils'

interface HubStatus {
  connected: boolean
  hub_url: string
  device_name: string
  last_sync: string
  total_tokens: number
  total_cost: number
  devices: number
}

interface Device {
  name: string
  os: string
  lastSync: string
  requests24h: number
  status: 'online' | 'idle' | 'offline'
  initials: string
  color: string
  label: string
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}
function fmtCost(n: number): string { return '$' + n.toFixed(2) }

const COLORS = ['var(--ink-500)', 'var(--ink-400)', 'var(--ink-300)', 'var(--ink-600)', 'var(--ink-200)', 'var(--ink-700)', 'var(--ink-100)']

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

function DonutChart({ models }: { models: ModelsData['models'] }) {
  const { t } = useI18n()
  const total = models.reduce((s, m) => s + m.total_tokens, 0)
  const r = 54, sw = 16, cx = 64, cy = 64
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="pie">
      <div className="ring hub-donut-ring">
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
        <div className="hub-donut-center">
          <span className="hub-donut-count">{models.length}</span>
          <span className="hub-donut-label">{t('sessions_models')}</span>
        </div>
      </div>
      <div className="legend2">
        {models.map((m, i) => (
          <div className="row" key={i}>
            <span className="sw" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="nm">{m.name}</span>
            <span className="vv">{m.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(function Hub() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [status, setStatus] = useState<HubStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [hubError, setHubError] = useState(false)
  const [models, setModels] = useState<ModelsData | null>(null)

  async function loadHubStatus() {
    setLoading(true)
    try {
      if (isWails()) {
        const hubStatus = await wails.GetHubStatus().catch(() => '')
        if (hubStatus) {
          const parsed = JSON.parse(hubStatus)
          setStatus({
            connected: parsed.connected || false,
            hub_url: parsed.hubUrl || '-',
            device_name: parsed.deviceName || '-',
            last_sync: parsed.lastSync || '-',
            total_tokens: parsed.totalTokens || 0,
            total_cost: parsed.totalCost || 0,
            devices: parsed.devices || 0,
          })
        }
      }
    } catch {
      try {
        const data = await apiFetch('/ocgt/api/hub/sync', { method: 'POST' })
        if (data) {
          setStatus({
            connected: !!data.connected,
            hub_url: data.hub_url || '-',
            device_name: data.device_name || '-',
            last_sync: data.last_sync || '-',
            total_tokens: data.total_tokens || 0,
            total_cost: data.total_cost || 0,
            devices: data.devices || 0,
          })
        }
      } catch {
        toast(t('toast_hub_load_failed'), 'error')
        setStatus(null)
        setHubError(true)
      }
      
      try {
        const mData = await apiGet('/ocgt/api/stats/models?days=7')
        if (mData) {
          setModels(mData)
        }
      } catch (e) {
        setModels({
          models: [
            { name: 'claude-3-5-sonnet', requests: 120, total_tokens: 450000, input_tokens: 350000, output_tokens: 100000, cache_tokens: 0, cache_hit_rate: 0, cost_usd: 1.5, pct: 65.5 },
            { name: 'claude-3-opus', requests: 15, total_tokens: 120000, input_tokens: 100000, output_tokens: 20000, cache_tokens: 0, cache_hit_rate: 0, cost_usd: 2.1, pct: 17.5 },
            { name: 'gpt-4o', requests: 45, total_tokens: 116000, input_tokens: 80000, output_tokens: 36000, cache_tokens: 0, cache_hit_rate: 0, cost_usd: 0.8, pct: 17.0 }
          ]
        })
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { loadHubStatus() }, [])

  // Sample device data (replace with API data when available)
  const devices: Device[] = [
    { name: status?.device_name || 'this-device', os: t('hub_sample_os'), lastSync: t('hub_sample_sync'), requests24h: 0, status: status?.connected ? 'online' : 'offline', initials: (status?.device_name || 'M')[0].toUpperCase(), color: 'var(--ink-950)', label: t('hub_sample_label') },
    ]

  const displayDevices = status?.connected ? devices : devices.slice(0, 1)

  return (
    <div id="page-hub">
      {loading ? (
        <div className="hub-metric-card">
          <div className="hub-hero-stats hub-skel-hero">
            <div className="hub-skel-left">
              <Skeleton className="hub-skel-title" />
              <Skeleton className="hub-skel-subtitle" />
              <div className="hub-hero-stats">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="card hub-skel-stat-card">
                    <Skeleton className="hub-skel-stat-label" />
                    <Skeleton className="hub-skel-stat-value" />
                  </div>
                ))}
              </div>
            </div>
            <div className="hub-skel-right">
              <Skeleton className="hub-skel-map" />
            </div>
          </div>
          <Skeleton className="hub-skel-list" />
        </div>
      ) : (
      <>
      <div className="row between hub-hero-header">
        <div>
          <h1 className="hero">{t('hub_hero_title')}<em>{t('hub_hero_title_em')}</em></h1>
          <p className="lede">
            {status?.connected
              ? <>Syncing to <code className="inl">{status.hub_url}</code> as <code className="inl">{status.device_name}</code>. {status.devices > 0 && <>{status.devices} device{status.devices !== 1 ? 's' : ''} online.</>}</>
              : <>{t('hub_hero_desc')}</>}
          </p>
        </div>
        <div className="row gap-2">
          {status?.connected && <span className="tag green"><span className="dot online" /> {t('hub_connected_tag')}</span>}
          {hubError && (
            <button className="btn btn-sm" onClick={() => { setHubError(false); loadHubStatus() }}>
              ↻ {t('retry')}
            </button>
          )}
          <button className="btn btn-sm" onClick={loadHubStatus}><RefreshCw width={13} height={13} /> {t('hub_refresh')}</button>
        </div>
      </div>

      <div className="hero-meta hub-hero-meta">
        <div><b className="hub-metric-value">{status ? fmtNum(status.total_tokens) : '-'}</b><span className="hub-metric-label">{t('hub_lbl_tokens')}</span></div>
        <div><b className="hub-metric-value">{status ? fmtCost(status.total_cost) : '-'}</b><span className="hub-metric-label">{t('hub_lbl_cost')}</span></div>
        <div><b className="hub-metric-value">{status ? status.devices : '-'}</b><span className="hub-metric-label">{t('hub_lbl_devices')}</span></div>
      </div>

      <div className="layout hub-grid-2col">
        <div className="card device-table">
          <div className="card-h">{t('hub_lbl_devices')} · {displayDevices.length}
            <div className="actions">
              <button className="btn btn-sm btn-ghost" onClick={() => { window.dispatchEvent(new CustomEvent('nav-to', { detail: 'terminal' })) }}>{t('hub_add_device') || '+ Add device'}</button>
              <span className="tag">{status?.connected ? t('hub_lbl_synced') : t('hub_lbl_local')}</span>
            </div>
          </div>
          <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('hub_col_device')}</th><th>{t('hub_col_os')}</th><th>{t('hub_col_last_sync')}</th><th className="num">{t('hub_col_req_24h')}</th><th>{t('tm_status_col')}</th></tr></thead>
            <tbody>
              {displayDevices.map((d, i) => (
                <tr key={i}>
                  <td>
                    <span className="hub-device-row">
                      <span className="ic hub-device-avatar" style={{ background: d.color }}>{d.initials}</span>
                      <span><b className="hub-device-name-text">{d.name}</b><br /><span className="tiny muted mono">{d.label}</span></span>
                    </span>
                  </td>
                  <td className="mono tiny">{d.os}</td>
                  <td className="mono tiny">{d.lastSync}</td>
                  <td className="num">{d.requests24h > 0 ? fmtNum(d.requests24h) : '—'}</td>
                  <td>
                    <span className={`tag ${d.status === 'online' ? 'green' : d.status === 'idle' ? 'amber' : ''}`}>
                      <span className={`dot ${d.status}`} /> {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="card-foot">
            <span>{t('hub_sync_log')}: {status?.connected ? t('hub_sync_log_active') : t('hub_sync_log_none')}</span>
            <span className="spacer" />
          </div>
        </div>
      </div>
        
      <div className="hub-section hub-section-margin">
        <div className="hub-section-header"><h3>{t('tm_model_distribution')}</h3></div>
        <div className="card">
          <div className="card-body">
            {models?.models?.length ? (
              <DonutChart models={models.models} />
            ) : (
              <div className="hub-map-wrap">
                <span className="muted tiny">{t('td_no_data')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="layout hub-grid-2col hub-grid-2col-margin">
        <div className="col gap-4">
          <div className="card">
            <div className="card-h"><Globe width={14} height={14} className="hub-card-h-icon" />{t('hub_lbl_geography')}</div>
            <div className="world">
              <div className="grid-bg" />
              <div className="pin" style={{ left: '30%', top: '40%' }} />
              <div className="lbl" style={{ left: '30%', top: '40%' }}>{status?.device_name || t('hub_lbl_this_device')}{t('hub_lbl_here')}</div>
              <div className="pin" style={{ left: '55%', top: '35%' }} />
              <div className="lbl" style={{ left: '55%', top: '35%' }}>EU-Frankfurt</div>
              <div className="pin" style={{ left: '75%', top: '38%' }} />
              <div className="lbl" style={{ left: '75%', top: '38%' }}>Asia-Tokyo</div>
              <div className="pin" style={{ left: '85%', top: '55%' }} />
              <div className="lbl" style={{ left: '85%', top: '55%' }}>Oceania-Sydney</div>
            </div>
          </div>
        </div>

        <div className="col gap-4">
          {/* Encryption card */}
          <div className="card">
            <div className="card-h">🔒 {t('hub_encryption')}
              <div className="actions">
                <span className="tag">AES-256-GCM</span>
              </div>
            </div>
            <div className="card-body hub-card-body-nopad">
              <div className="kv-list">
                <div className="row">
                  <span className="k">{t('hub_recovery_key')}</span>
                  <span className="v hub-progress-bar">░░░░░░░░░░░░░░░░░░░░░░░░</span>
                </div>
                <div className="row">
                  <span className="k">{t('hub_algorithm')}</span>
                  <span className="v">AES-256-GCM</span>
                </div>
                <div className="row">
                  <span className="k">Rotation</span>
                  <span className="v">auto · every 90 days</span>
                </div>
                <div className="row">
                  <span className="k">Last rotated</span>
                  <span className="v">2026-01-12</span>
                </div>
              </div>
            </div>
            <div className="card-foot">
              <span className="muted tiny">{t('hub_keys_local')}</span>
              <span className="spacer" />
              <button className="btn btn-sm btn-ghost">{t('hub_rotate_key')}</button>
            </div>
          </div>

          <div className="card">
            <div className="card-h">{t('hub_lbl_connection')}</div>
            <div className="statusgrid">
              <div className="cell">
                <div className="k">{t('hub_lbl_status')}</div>
                <div className="vv">
                  {status?.connected
                    ? <><Wifi width={14} height={14} className="hub-status-icon-online" /> {t('hub_lbl_connected')}</>
                    : <><WifiOff width={14} height={14} className="hub-status-icon-offline" /> {t('hub_lbl_disconnected')}</>}
                </div>
              </div>
              <div className="cell">
                <div className="k">{t('hub_lbl_hub_url')}</div>
                <div className="vv hub-status-detail">{status?.hub_url || '—'}</div>
              </div>
              <div className="cell">
                <div className="k">{t('hub_lbl_device_name')}</div>
                <div className="vv">{status?.device_name || '—'}</div>
              </div>
              <div className="cell">
                <div className="k">{t('hub_lbl_last_sync')}</div>
                <div className="vv hub-status-detail">{status?.last_sync || '—'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
})
