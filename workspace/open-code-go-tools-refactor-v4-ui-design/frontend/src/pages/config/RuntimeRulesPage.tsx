import { useState, useEffect, useCallback } from 'react'
import { wails, apiGet, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

export default function RuntimeRulesPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [envJSON, setEnvJSON] = useState('{}')
  const [timeoutSeconds, setTimeoutSeconds] = useState('300')
  const [thinkingBudget, setThinkingBudget] = useState('0')
  const [disableNonessential, setDisableNonessential] = useState(false)
  const [enableToolSearch, setEnableToolSearch] = useState(false)
  const [disableAttribution, setDisableAttribution] = useState(false)
  const [disableThinking, setDisableThinking] = useState(false)
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [maxMCPTokens, setMaxMCPTokens] = useState('')
  const [apiTimeout, setApiTimeout] = useState('')
  const [mcpTimeout, setMcpTimeout] = useState('')

  useEffect(() => {
    apiGet('/ocgt/api/status').then(d => {
      if (!d) return
      const env = parseEnv(d.claudeEnvJSON ?? d.envJSON ?? '{}')
      setEnvJSON(d.claudeEnvJSON ?? d.envJSON ?? '{}')
      setTimeoutSeconds(String(d.timeout ?? 300))
      setThinkingBudget(String(d.thinkingBudgetTokens ?? 0))
      setDisableNonessential(env.DISABLE_NONESSENTIAL === 'true')
      setEnableToolSearch(env.ENABLE_TOOL_SEARCH === 'true')
      setDisableAttribution(env.DISABLE_ATTRIBUTION === 'true')
      setDisableThinking(env.DISABLE_THINKING === 'true')
      setMaxOutputTokens(env.MAX_OUTPUT_TOKENS ?? '')
      setMaxMCPTokens(env.MAX_MCP_TOKENS ?? '')
      setApiTimeout(env.API_TIMEOUT ?? '')
      setMcpTimeout(env.MCP_TIMEOUT ?? '')
    }).catch(() => {})
  }, [])

  function parseEnv(raw: string): Record<string, string> {
    try { const o = JSON.parse(raw); return typeof o === 'object' && o ? o : {} } catch { return {} }
  }

  function buildEnv(): string {
    const env = parseEnv(envJSON)
    const set = (k: string, v: string, c: boolean) => { if (c) env[k] = v; else delete env[k] }
    set('DISABLE_NONESSENTIAL', 'true', disableNonessential)
    set('ENABLE_TOOL_SEARCH', 'true', enableToolSearch)
    set('DISABLE_ATTRIBUTION', 'true', disableAttribution)
    set('DISABLE_THINKING', 'true', disableThinking)
    if (maxOutputTokens) env.MAX_OUTPUT_TOKENS = maxOutputTokens; else delete env.MAX_OUTPUT_TOKENS
    if (maxMCPTokens) env.MAX_MCP_TOKENS = maxMCPTokens; else delete env.MAX_MCP_TOKENS
    if (apiTimeout) env.API_TIMEOUT = apiTimeout; else delete env.API_TIMEOUT
    if (mcpTimeout) env.MCP_TIMEOUT = mcpTimeout; else delete env.MCP_TIMEOUT
    return JSON.stringify(env, null, 2)
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const built = buildEnv()
      const err = await wails.SaveProfileConfig('', '', '', '', '', '', timeoutSeconds, thinkingBudget, '', '', '', '', '', built, '', '')
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [envJSON, disableNonessential, enableToolSearch, disableAttribution, disableThinking, maxOutputTokens, maxMCPTokens, apiTimeout, mcpTimeout, timeoutSeconds, thinkingBudget, t, toast])

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={onChange} type="button"><span /></button>
  )

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_s04_title')}</h1><p className="set-subtitle">{t('sett_s04_sub')}</p></div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
      </div>
      <section className="set-section">
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('sett_timeout_label')}</b><p>{t('sett_timeout_desc')}</p></div>
            <div className="control"><input className="input" value={timeoutSeconds} onChange={e => setTimeoutSeconds(e.target.value)} style={{ width: 120 }} /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_thinking')}</b><p>{t('sett_thinking')}</p></div>
            <div className="control">
              <select className="select" value={thinkingBudget} onChange={e => setThinkingBudget(e.target.value)}>
                <option value="0">{t('opt_thinking_off')}</option>
                <option value="256">{t('opt_thinking_256')}</option>
                <option value="512">{t('opt_thinking_512')}</option>
                <option value="1024">{t('opt_thinking_1024')}</option>
                <option value="2048">{t('opt_thinking_2048')}</option>
              </select>
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_claude_env_json')}</b><p>{t('sett_claude_env_json_desc')}</p></div>
            <div className="control"><textarea value={envJSON} onChange={e => setEnvJSON(e.target.value)} rows={5} className="settings-env-key" /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_disable_nonessential')}</b><p>{t('sett_disable_nonessential_desc')}</p></div>
            <div className="control"><Toggle checked={disableNonessential} onChange={() => setDisableNonessential(!disableNonessential)} label={t('sett_disable_nonessential')} /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_enable_tool_search')}</b><p>{t('sett_enable_tool_search_desc')}</p></div>
            <div className="control"><Toggle checked={enableToolSearch} onChange={() => setEnableToolSearch(!enableToolSearch)} label={t('sett_enable_tool_search')} /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_disable_atmos')}</b><p>{t('sett_disable_atmos_desc')}</p></div>
            <div className="control"><Toggle checked={disableAttribution} onChange={() => setDisableAttribution(!disableAttribution)} label={t('sett_disable_atmos')} /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_disable_thinking')}</b><p>{t('sett_disable_thinking_desc')}</p></div>
            <div className="control"><Toggle checked={disableThinking} onChange={() => setDisableThinking(!disableThinking)} label={t('sett_disable_thinking')} /></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_max_tokens')}</b><p>{t('sett_max_tokens_desc')}</p></div>
            <div className="control settings-row">
              <input className="input" value={maxOutputTokens} onChange={e => setMaxOutputTokens(e.target.value)} placeholder="output" style={{ width: 120 }} />
              <input className="input" value={maxMCPTokens} onChange={e => setMaxMCPTokens(e.target.value)} placeholder="mcp" style={{ width: 120 }} />
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_api_mcp_timeout')}</b><p>{t('sett_api_mcp_timeout_desc')}</p></div>
            <div className="control settings-row">
              <input className="input" value={apiTimeout} onChange={e => setApiTimeout(e.target.value)} placeholder="api" style={{ width: 120 }} />
              <input className="input" value={mcpTimeout} onChange={e => setMcpTimeout(e.target.value)} placeholder="mcp" style={{ width: 120 }} />
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('repair_title')}</b><p>{t('repair_desc')}</p></div>
            <div className="control">
              <button className="btn btn-sm btn-primary" onClick={async () => {
                if (!isWails()) return
                try { const r = await wails.RepairAllConfigurations(); toast(r || t('toast_repair_all_success'), 'success') }
                catch { toast(t('toast_repair_all_failed'), 'error') }
              }}>{t('btn_repair_all')}</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
