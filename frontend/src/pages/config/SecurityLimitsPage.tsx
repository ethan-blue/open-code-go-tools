import { useState, useEffect, useCallback } from 'react'
import { wails, apiGet } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

// Defined at module scope (not inside the component) so React doesn't remount it
// on every parent render — defining a component inside render loses DOM/focus state.
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={onChange} type="button"><span /></button>
  )
}

export default function SecurityLimitsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [rateLimitingEnabled, setRateLimitingEnabled] = useState(false)
  const [rateLimitPerSecond, setRateLimitPerSecond] = useState('0')
  const [rateLimitBurst, setRateLimitBurst] = useState('0')
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState('0')
  const [listenAddr, setListenAddr] = useState('127.0.0.1:8787')

  useEffect(() => {
    apiGet('/ocgt/api/status').then(d => {
      if (!d) return
      setAuthEnabled(!!d.auth_enabled)
      setRateLimitPerSecond(String(d.rateLimitPerSecond ?? d.rate_limit_per_second ?? '0'))
      setRateLimitBurst(String(d.rateLimitBurst ?? d.rate_limit_burst ?? '0'))
      setRateLimitPerMinute(String(d.rateLimitPerMinute ?? d.rate_limit_per_minute ?? '0'))
      setRateLimitingEnabled(parseInt(String(d.rate_limit_per_second ?? '0')) > 0 || parseInt(String(d.rate_limit_burst ?? '0')) > 0)
      setListenAddr(d.listenAddr ?? d.listen ?? '127.0.0.1:8787')
    }).catch(() => {})
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // rate limiting disabled → send empty strings so the backend keeps prior values
      const rps = rateLimitingEnabled ? rateLimitPerSecond : ''
      const burst = rateLimitingEnabled ? rateLimitBurst : ''
      const rpm = rateLimitingEnabled ? rateLimitPerMinute : ''
      // SaveGlobalConfig writes only gateway-level fields (listen, rate limits);
      // upstream/quota/timeout are left untouched by passing empty strings.
      const err = await wails.SaveGlobalConfig(listenAddr, '', '', '', rps, burst, rpm, '', '', '')
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      const authErr = await wails.SetAuthEnabled(authEnabled)
      if (authErr && typeof authErr === 'string' && authErr !== 'success') throw new Error(authErr)
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [authEnabled, rateLimitingEnabled, rateLimitPerSecond, rateLimitBurst, rateLimitPerMinute, listenAddr, t, toast])

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_section_security')}</h1><p className="set-subtitle">{t('sett_section_security_desc')}</p></div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
      </div>
      <section className="set-section">
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('sett_listen_label')}</b><p>{t('sett_listen_desc')}</p></div>
            <div className="control">
              <div className="row gap-2">
                <input className="input" value={listenAddr.split(':')[0]} placeholder="127.0.0.1" style={{ width: 160 }}
                  onChange={e => { const port = listenAddr.split(':')[1] ?? '8787'; setListenAddr(`${e.target.value}:${port}`) }} />
                <input className="input" value={listenAddr.split(':')[1] ?? ''} placeholder="8787" style={{ width: 80 }}
                  onChange={e => { const host = listenAddr.split(':')[0] || '127.0.0.1'; setListenAddr(`${host}:${e.target.value}`) }} />
              </div>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_auth_enabled')}</b><p>{t('sett_auth_desc')}</p></div>
            <div className="control"><Toggle checked={authEnabled} onChange={() => setAuthEnabled(!authEnabled)} label={t('sett_auth_enabled')} /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_rate_limiting')}</b><p>{t('sett_rate_limiting_desc')}</p></div>
            <div className="control"><Toggle checked={rateLimitingEnabled} onChange={() => setRateLimitingEnabled(!rateLimitingEnabled)} label={t('sett_rate_limiting')} /></div>
          </div>
          <div style={{ opacity: rateLimitingEnabled ? 1 : 0.45, pointerEvents: rateLimitingEnabled ? 'auto' : 'none', transition: 'opacity 0.15s' }}>
            <div className="set-row">
              <div className="label"><b>{t('sett_rate_sec')}</b><p>{t('sett_rate_sec_desc')}</p></div>
              <div className="control"><input className="input" type="number" value={rateLimitPerSecond} onChange={e => setRateLimitPerSecond(e.target.value)} placeholder="10" aria-label={t('sett_rate_sec')} /></div>
            </div>
            <div className="set-row">
              <div className="label"><b>{t('sett_rate_burst')}</b><p>{t('sett_rate_burst_desc')}</p></div>
              <div className="control"><input className="input" type="number" value={rateLimitBurst} onChange={e => setRateLimitBurst(e.target.value)} placeholder="20" aria-label={t('sett_rate_burst')} /></div>
            </div>
            <div className="set-row">
              <div className="label"><b>{t('sett_rate_minute')}</b><p>{t('sett_rate_minute_desc')}</p></div>
              <div className="control"><input className="input" type="number" value={rateLimitPerMinute} onChange={e => setRateLimitPerMinute(e.target.value)} placeholder="600" aria-label={t('sett_rate_minute')} /></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
