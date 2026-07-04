import { useState, useEffect, useCallback } from 'react'
import { wails, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

export default function LogsTelemetryPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [logEnabled, setLogEnabled] = useState(false)
  const [logDir, setLogDir] = useState('')
  const [logRetention, setLogRetention] = useState('7')

  useEffect(() => {
    if (isWails()) {
      wails.GetPreferences().then(prefs => {
        if (prefs) {
          if (prefs.log_enabled !== undefined) setLogEnabled(prefs.log_enabled === 'true')
          if (prefs.log_dir) setLogDir(prefs.log_dir)
          if (prefs.log_retention) setLogRetention(prefs.log_retention)
        }
      }).catch(() => {})
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (isWails()) {
        const err = await wails.SaveLogPreferences(logEnabled, logDir, parseInt(logRetention) || 7)
        if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      }
      toast(t('toast_log_prefs_saved'), 'success')
    } catch { toast(t('toast_log_prefs_failed'), 'error') }
    finally { setSaving(false) }
  }, [logEnabled, logDir, logRetention, t, toast])

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_log_title')}</h1><p className="set-subtitle">{t('sett_log_desc')}</p></div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_log_prefs')}</button>
      </div>
      <section className="set-section">
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('pref_log_save')}</b><p>{t('pref_log_dir')}</p></div>
            <div className="control">
              <div className="row gap-2">
                <input className="input" value={logDir} onChange={e => setLogDir(e.target.value)} placeholder="~/.config/ocgt/logs" style={{ width: 200 }} />
                <button className="btn btn-sm btn-ghost" onClick={async () => { if (isWails()) await wails.OpenLogLocation().catch(() => {}) }}>{t('btn_open_log_dir')}</button>
              </div>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('pref_log_retention')}</b><p>{t('pref_log_retention_desc')}</p></div>
            <div className="control">
              <input className="input" type="number" value={logRetention} onChange={e => setLogRetention(e.target.value)} min={1} max={365} style={{ width: 100 }} />
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_telemetry')}</b><p>{t('sett_telemetry_desc')}</p></div>
            <div className="control">
              <button role="switch" aria-checked={logEnabled} aria-label={t('sett_telemetry')} className={`toggle${logEnabled ? ' on' : ''}`} onClick={() => setLogEnabled(!logEnabled)} type="button"><span /></button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
