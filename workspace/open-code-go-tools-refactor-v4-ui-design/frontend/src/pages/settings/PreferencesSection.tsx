import { useI18n } from '@/i18n'
import { isWails, wails } from '@/lib/wails'
import type { FormState, SetField } from './types'

const ACCENT_PRESETS = [
  { hue: 174, name: 'Teal', color: 'hsl(174, 80%, 55%)' },
  { hue: 210, name: 'Blue', color: 'hsl(210, 80%, 55%)' },
  { hue: 260, name: 'Purple', color: 'hsl(260, 80%, 60%)' },
  { hue: 25, name: 'Orange', color: 'hsl(25, 90%, 55%)' },
  { hue: 330, name: 'Pink', color: 'hsl(330, 80%, 58%)' },
]

interface Props {
  form: FormState
  set: SetField
  theme: 'light' | 'dark' | 'system'
  setTheme: (v: 'light' | 'dark' | 'system') => void
  accentHue: number
  setAccentHue: (v: number) => void
  language: string
  setLanguage: (v: string) => void
}

export function PreferencesSection({ form, set, theme, setTheme, accentHue, setAccentHue, language, setLanguage }: Props) {
  const { t } = useI18n()

  return (
    <section className="set-section" >
      <div className="head">
        <div><h3>{t('sett_s05_title')}</h3><div className="sub">{t('sett_s05_sub')}</div></div>
      </div>
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
          <div className="label"><b>{t('sett_close_label')}</b><p>{t('sett_close_desc')}</p></div>
          <div className="control">
            <div className="row gap-3">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="closeBehavior" value="prompt" checked={form.closeBehavior === 'prompt'} onChange={(e) => set('closeBehavior', e.target.value)} /> {t('sett_close_ask')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="closeBehavior" value="tray" checked={form.closeBehavior === 'tray'} onChange={(e) => set('closeBehavior', e.target.value)} /> {t('sett_close_tray')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="closeBehavior" value="quit" checked={form.closeBehavior === 'quit'} onChange={(e) => set('closeBehavior', e.target.value)} /> {t('sett_close_quit')}
              </label>
            </div>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('pref_log_save')}</b><p>{t('pref_log_dir')}</p></div>
          <div className="control">
            <div className="row gap-2">
              <input className="input" value={form.logDir} onChange={(e) => set('logDir', e.target.value)} placeholder="~/.config/ocgt/logs" style={{ width: 200 }} />
              <button className="btn btn-sm btn-ghost" onClick={async () => { if (isWails()) await wails.OpenLogLocation().catch(() => {}) }}>{t('btn_open_log_dir')}</button>
            </div>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_language') || 'Language'}</b><p>{t('sett_language_desc') || 'Interface language'}</p></div>
          <div className="control">
            <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: 120 }}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_telemetry')}</b><p>{t('sett_telemetry_desc')}</p></div>
          <div className="control">
            <button role="switch" aria-checked={form.logEnabled} aria-label="Send anonymous usage stats" className={`toggle${form.logEnabled ? ' on' : ''}`} onClick={() => set('logEnabled', !form.logEnabled)} type="button"><span /></button>
          </div>
        </div>
      </div>
    </section>
  )
}
