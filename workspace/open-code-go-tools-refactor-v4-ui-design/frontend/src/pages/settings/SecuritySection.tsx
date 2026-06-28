import { useI18n } from '@/i18n'
import type { FormState, SetField } from './types'

interface ToggleRowProps {
  label: string
  desc: string
  checked: boolean
  onChange: () => void
  ariaLabel: string
}

function SettingToggle({ label, desc, checked, onChange, ariaLabel }: ToggleRowProps) {
  return (
    <div className="set-row">
      <div className="label"><b>{label}</b><p>{desc}</p></div>
      <div className="control">
        <button role="switch" aria-checked={checked} aria-label={ariaLabel} className={`toggle${checked ? ' on' : ''}`} onClick={onChange} type="button"><span /></button>
      </div>
    </div>
  )
}

interface InputRowProps {
  label: string
  desc: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}

function SettingInput({ label, desc, value, onChange, placeholder, type = 'text' }: InputRowProps) {
  return (
    <div className="set-row">
      <div className="label"><b>{label}</b><p>{desc}</p></div>
      <div className="control">
        <div className="input-wrap">
          <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
        </div>
      </div>
    </div>
  )
}

interface Props {
  form: FormState
  set: SetField
}

export function SecuritySection({ form, set }: Props) {
  const { t } = useI18n()

  return (
    <section className="set-section" >
      <div className="head">
        <div><h3>{t('sett_section_security')}</h3><div className="sub">{t('sett_section_security_desc')}</div></div>
        {(form.authEnabled || form.rateLimitingEnabled) && <span className="tag green">{form.authEnabled ? 'Auth' : ''}{form.authEnabled && form.rateLimitingEnabled ? '	' : ''}{form.rateLimitingEnabled ? 'Rate Limit' : ''}</span>}
      </div>
      <div className="set-card">
        <SettingToggle label={t('sett_auth_enabled')} desc={t('sett_auth_desc')} checked={form.authEnabled} onChange={() => set('authEnabled', !form.authEnabled)} ariaLabel={t('sett_auth_enabled')} />
        <SettingToggle label={t('sett_rate_limiting')} desc={t('sett_rate_limiting_desc')} checked={form.rateLimitingEnabled} onChange={() => set('rateLimitingEnabled', !form.rateLimitingEnabled)} ariaLabel={t('sett_rate_limiting')} />
        <div style={{ opacity: form.rateLimitingEnabled ? 1 : 0.45, pointerEvents: form.rateLimitingEnabled ? 'auto' : 'none', transition: 'opacity 0.15s' }}>
          <SettingInput label={t('sett_rate_sec')} desc={t('sett_rate_sec_desc')} value={form.rateLimitPerSecond} onChange={(v) => set('rateLimitPerSecond', v)} placeholder="10" type="number" />
          <SettingInput label={t('sett_rate_burst')} desc={t('sett_rate_burst_desc')} value={form.rateLimitBurst} onChange={(v) => set('rateLimitBurst', v)} placeholder="20" type="number" />
          <SettingInput label={t('sett_rate_minute')} desc={t('sett_rate_minute_desc')} value={form.rateLimitPerMinute} onChange={(v) => set('rateLimitPerMinute', v)} placeholder="600" type="number" />
        </div>
      </div>
    </section>
  )
}
