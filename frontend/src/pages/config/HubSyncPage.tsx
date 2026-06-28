import { useState, useEffect, useCallback } from 'react'
import { wails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

export default function HubSyncPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [hubEnabled, setHubEnabled] = useState(false)
  const [hubUrl, setHubUrl] = useState('')
  const [hubSecret, setHubSecret] = useState('')
  const [hubDeviceName, setHubDeviceName] = useState('')
  const [hubInterval, setHubInterval] = useState('120')

  useEffect(() => {
    wails.GetHubConfig().then(raw => {
      if (!raw) return
      const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (cfg && typeof cfg === 'object') {
        setHubEnabled(!!cfg.enabled)
        setHubUrl(cfg.hubUrl || '')
        setHubDeviceName(cfg.deviceName || '')
        setHubInterval(String(cfg.interval || 120))
      }
    }).catch(() => {})
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const interval = Math.max(30, Math.min(1800, parseInt(hubInterval) || 120))
      const err = await wails.SaveHubConfig(hubEnabled, hubUrl, hubSecret, hubDeviceName, interval)
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [hubEnabled, hubUrl, hubSecret, hubDeviceName, hubInterval, t, toast])

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={onChange} type="button"><span /></button>
  )

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_s06_title')}</h1><p className="set-subtitle">{t('sett_s06_sub')}</p></div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
      </div>
      <section className="set-section">
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('pref_hub_enable')}</b><p>{t('pref_hub_desc')}</p></div>
            <div className="control"><Toggle checked={hubEnabled} onChange={() => setHubEnabled(!hubEnabled)} label={t('pref_hub_enable')} /></div>
          </div>
          {hubEnabled && <>
            <div className="set-row">
              <div className="label"><b>{t('pref_hub_url')}</b><p>{t('sett_hub_addr_desc')}</p></div>
              <div className="control"><input className="input" value={hubUrl} onChange={e => setHubUrl(e.target.value)} placeholder="http://192.168.1.100:17321" style={{ width: 260 }} /></div>
            </div>
            <div className="set-row">
              <div className="label"><b>{t('pref_hub_secret')}</b><p>{t('sett_hub_secret_desc')}</p></div>
              <div className="control"><input className="input" type="password" value={hubSecret} onChange={e => setHubSecret(e.target.value)} placeholder={t('sett_hub_secret_placeholder')} style={{ width: 200 }} /></div>
            </div>
            <div className="set-row">
              <div className="label"><b>{t('pref_hub_device_name')}</b><p>{t('sett_hub_device_desc')}</p></div>
              <div className="control"><input className="input" value={hubDeviceName} onChange={e => setHubDeviceName(e.target.value)} placeholder="my-laptop" style={{ width: 200 }} /></div>
            </div>
            <div className="set-row">
              <div className="label"><b>{t('pref_hub_interval')}</b><p>{t('sett_hub_interval_desc')}</p></div>
              <div className="control"><input className="input" type="number" value={hubInterval} onChange={e => setHubInterval(e.target.value)} min={30} max={1800} style={{ width: 100 }} /></div>
            </div>
          </>}
        </div>
      </section>
    </div>
  )
}
