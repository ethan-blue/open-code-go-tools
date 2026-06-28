import { useState, useEffect, useCallback } from 'react'
import { wails, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

const ACCENT_PRESETS = [
  { hue: 174, name: 'Teal', color: 'hsl(174, 80%, 55%)' },
  { hue: 210, name: 'Blue', color: 'hsl(210, 80%, 55%)' },
  { hue: 260, name: 'Purple', color: 'hsl(260, 80%, 60%)' },
  { hue: 25, name: 'Orange', color: 'hsl(25, 90%, 55%)' },
  { hue: 330, name: 'Pink', color: 'hsl(330, 80%, 58%)' },
]

export default function PreferencesPage() {
  const { t, lang, setLang } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    const s = localStorage.getItem('theme')
    return (['light', 'dark', 'system'].includes(s || '') ? s : 'system') as any
  })
  const [accentHue, setAccentHue] = useState(() => {
    const s = localStorage.getItem('accent-hue')
    return s ? parseInt(s, 10) : 174
  })
  const [closeBehavior, setCloseBehavior] = useState('prompt')

  useEffect(() => {
    const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
    document.documentElement.setAttribute('data-theme', resolved)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-h', String(accentHue))
    localStorage.setItem('accent-hue', String(accentHue))
  }, [accentHue])

  useEffect(() => {
    if (isWails()) {
      wails.GetPreferences().then(prefs => {
        if (prefs?.theme && ['light', 'dark', 'system'].includes(prefs.theme)) setTheme(prefs.theme as any)
        if (prefs?.accent_hue) setAccentHue(parseInt(prefs.accent_hue))
        if (prefs?.close_behavior) setCloseBehavior(prefs.close_behavior)
      }).catch(() => {})
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (isWails()) {
        await wails.SaveUIPreferences(theme, lang, accentHue, localStorage.getItem('last-view') || 'dashboard', '', '')
        await wails.SavePreferences(closeBehavior)
      }
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [theme, lang, accentHue, closeBehavior, t, toast])

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
                <button type="button" className={`theme-prefs__btn${theme === 'system' ? ' active' : ''}`} onClick={() => setTheme('system')}>{t('sett_theme_system')}</button>
                <button type="button" className={`theme-prefs__btn${theme === 'dark' ? ' active' : ''}`} onClick={() => setTheme('dark')}>{t('sett_theme_dark')}</button>
              </div>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_accent_label')}</b><p>{t('sett_accent_desc')}</p></div>
            <div className="control">
              <div className="accent-row">
                {ACCENT_PRESETS.map(p => (
                  <span key={p.hue} className={`accent-dot${accentHue === p.hue ? ' active' : ''}`} style={{ background: p.color }} onClick={() => setAccentHue(p.hue)} title={p.name} />
                ))}
                <input type="range" className="accent-slider" min={0} max={360} value={accentHue} onChange={e => setAccentHue(+e.target.value)} />
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
        </div>
      </section>
    </div>
  )
}
