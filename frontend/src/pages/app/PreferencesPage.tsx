import { useState, useEffect, useCallback } from 'react'
import { wails, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import AboutPage from './AboutPage'

export default function PreferencesPage() {
  const { t, lang, setLang } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const s = localStorage.getItem('theme')
    // system was removed; map any legacy 'system' to the OS preference at load time
    if (s === 'system' || !s) {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return (['light', 'dark'].includes(s) ? s : 'light') as 'light' | 'dark'
  })
  const [closeBehavior, setCloseBehavior] = useState('prompt')
  const [hideTrafficErrors, setHideTrafficErrors] = useState(() => localStorage.getItem('hide-traffic-errors') === '1')
  // Log/telemetry settings (previously a separate page with its own save button).
  const [logEnabled, setLogEnabled] = useState(false)
  const [logDir, setLogDir] = useState('')
  const [logRetention, setLogRetention] = useState('7')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (isWails()) {
      wails.GetPreferences().then(prefs => {
        if (prefs?.theme && ['light', 'dark'].includes(prefs.theme)) setTheme(prefs.theme as 'light' | 'dark')
        if (prefs?.close_behavior) setCloseBehavior(prefs.close_behavior)
        if (prefs?.log_enabled !== undefined) setLogEnabled(prefs.log_enabled === 'true')
        if (prefs?.log_dir) setLogDir(prefs.log_dir)
        if (prefs?.log_retention) setLogRetention(prefs.log_retention)
      }).catch(() => {})
    }
  }, [])

  // Single save: persists UI prefs + close behavior + log prefs together.
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (isWails()) {
        await wails.SaveUIPreferences(theme, lang, 0, localStorage.getItem('last-view') || 'dashboard', '', '')
        await wails.SavePreferences(closeBehavior)
        const err = await wails.SaveLogPreferences(logEnabled, logDir, parseInt(logRetention) || 7)
        if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      }
      localStorage.setItem('hide-traffic-errors', hideTrafficErrors ? '1' : '0')
      window.dispatchEvent(new CustomEvent('ocgt-prefs-changed'))
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [theme, lang, closeBehavior, hideTrafficErrors, logEnabled, logDir, logRetention, t, toast])

  const updateHideTrafficErrors = useCallback((checked: boolean) => {
    setHideTrafficErrors(checked)
    localStorage.setItem('hide-traffic-errors', checked ? '1' : '0')
    window.dispatchEvent(new CustomEvent('ocgt-prefs-changed'))
  }, [])

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_s05_title')}</h1><p className="set-subtitle">{t('sett_s05_sub')}</p></div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
      </div>

      <section className="set-section">
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('sett_theme_label')}</b><p>{t('sett_theme_desc')}</p></div>
            <div className="control">
              <div className="theme-prefs__toggle">
                <button type="button" className={`theme-prefs__btn${theme === 'light' ? ' active' : ''}`} onClick={() => setTheme('light')}>{t('sett_theme_light')}</button>
                <button type="button" className={`theme-prefs__btn${theme === 'dark' ? ' active' : ''}`} onClick={() => setTheme('dark')}>{t('sett_theme_dark')}</button>
              </div>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_language')}</b><p>{t('sett_language_desc')}</p></div>
            <div className="control">
              <select className="select" value={lang} onChange={e => setLang(e.target.value as 'zh' | 'en')} style={{ width: 120 }}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_close_label')}</b><p>{t('sett_close_desc')}</p></div>
            <div className="control">
              <div className="row gap-3">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="closeBehavior" value="prompt" checked={closeBehavior === 'prompt'} onChange={e => setCloseBehavior(e.target.value)} /> {t('sett_close_ask')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="closeBehavior" value="tray" checked={closeBehavior === 'tray'} onChange={e => setCloseBehavior(e.target.value)} /> {t('sett_close_tray')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="closeBehavior" value="quit" checked={closeBehavior === 'quit'} onChange={e => setCloseBehavior(e.target.value)} /> {t('sett_close_quit')}
                </label>
              </div>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_hide_error_badge')}</b><p>{t('sett_hide_error_badge_desc')}</p></div>
            <div className="control">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={hideTrafficErrors} onChange={e => updateHideTrafficErrors(e.target.checked)} /> {t('sett_hide_error_badge')}
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="set-section">
        <div className="head">
          <div>
            <h3>{t('sett_log_title')}</h3>
            <div className="sub">{t('sett_log_desc')}</div>
          </div>
        </div>
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

      <div className="prefs-subsection">
        <AboutPage />
      </div>
    </div>
  )
}
