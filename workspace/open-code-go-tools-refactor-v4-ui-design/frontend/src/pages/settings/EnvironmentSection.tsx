import { useI18n } from '@/i18n'
import { isWails, wails } from '@/lib/wails'
import { useToast } from '@/hooks/toast'
import type { FormState, SetField } from './types'

interface Props {
  form: FormState
  set: SetField
  errors: Record<string, string>
}

export function EnvironmentSection({ form, set, errors }: Props) {
  const { t } = useI18n()
  const { toast } = useToast()

  return (
    <section className="set-section" >
      <div className="head">
        <div><h3>{t('sett_s04_title')}</h3><div className="sub">{t('sett_s04_sub')}</div></div>
      </div>
      <div className="set-card">
        <div className="set-row">
          <div className="label"><b>{t('sett_claude_env_json')}</b><p>{t('sett_claude_env_json_desc')}</p></div>
          <div className="control">
            <textarea value={form.claudeEnvJSON} onChange={(e) => set('claudeEnvJSON', e.target.value)} rows={6} className="settings-env-key" />
            {errors.claudeEnvJSON && <span className="hint" style={{ color: 'var(--danger)' }}>{errors.claudeEnvJSON}</span>}
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_disable_nonessential')}</b><p>{t('sett_disable_nonessential_desc')}</p></div>
          <div className="control">
            <button role="switch" aria-checked={form.disableNonessential} aria-label={t('sett_disable_nonessential')} className={`toggle${form.disableNonessential ? ' on' : ''}`} onClick={() => set('disableNonessential', !form.disableNonessential)} type="button"><span /></button>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_enable_tool_search')}</b><p>{t('sett_enable_tool_search_desc')}</p></div>
          <div className="control">
            <button role="switch" aria-checked={form.enableToolSearch} aria-label={t('sett_enable_tool_search')} className={`toggle${form.enableToolSearch ? ' on' : ''}`} onClick={() => set('enableToolSearch', !form.enableToolSearch)} type="button"><span /></button>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_disable_atmos')}</b><p>{t('sett_disable_atmos_desc')}</p></div>
          <div className="control">
            <button role="switch" aria-checked={form.disableAttribution} aria-label={t('sett_disable_atmos')} className={`toggle${form.disableAttribution ? ' on' : ''}`} onClick={() => set('disableAttribution', !form.disableAttribution)} type="button"><span /></button>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_disable_thinking')}</b><p>{t('sett_disable_thinking_desc')}</p></div>
          <div className="control">
            <button role="switch" aria-checked={form.disableThinking} aria-label={t('sett_disable_thinking')} className={`toggle${form.disableThinking ? ' on' : ''}`} onClick={() => set('disableThinking', !form.disableThinking)} type="button"><span /></button>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_max_tokens')}</b><p>{t('sett_max_tokens_desc')}</p></div>
          <div className="control settings-row">
            <input className="input" value={form.maxOutputTokens} onChange={(e) => set('maxOutputTokens', e.target.value)} placeholder="output" style={{ width: 120 }} />
            <input className="input" value={form.maxMCPTokens} onChange={(e) => set('maxMCPTokens', e.target.value)} placeholder="mcp" style={{ width: 120 }} />
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_api_mcp_timeout')}</b><p>{t('sett_api_mcp_timeout_desc')}</p></div>
          <div className="control settings-row">
            <input className="input" value={form.apiTimeout} onChange={(e) => set('apiTimeout', e.target.value)} placeholder="api" style={{ width: 120 }} />
            <input className="input" value={form.mcpTimeout} onChange={(e) => set('mcpTimeout', e.target.value)} placeholder="mcp" style={{ width: 120 }} />
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('repair_title')}</b><p>{t('repair_desc')}</p></div>
          <div className="control">
            <button className="btn btn-sm btn-primary" onClick={async () => {
              if (!isWails()) return
              try {
                const res = await wails.RepairAllConfigurations()
                toast(res || t('toast_repair_all_success'), 'success')
              } catch { toast(t('toast_repair_all_failed'), 'error') }
            }}>{t('btn_repair_all')}</button>
          </div>
        </div>
      </div>
    </section>
  )
}
