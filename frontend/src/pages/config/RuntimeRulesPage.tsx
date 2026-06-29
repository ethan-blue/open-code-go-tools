import { useState, useEffect, useCallback } from 'react'
import { wails, apiGet, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { AgentLine } from '@/lib/types'

interface Props {
  embedded?: boolean
  line?: AgentLine
}

export default function RuntimeRulesPage({ embedded = false, line }: Props) {
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
  const [activeProfile, setActiveProfile] = useState('')
  const [plugins, setPlugins] = useState<Record<string, boolean>>({})

  function parseEnv(raw: string): Record<string, string> {
    try { const o = JSON.parse(raw); return typeof o === 'object' && o ? o as Record<string, string> : {} } catch { return {} }
  }

  useEffect(() => {
    apiGet('/ocgt/api/status').then((d: any) => {
      if (!d) return
      setActiveProfile(d.active_profile ?? d.activeProfile ?? '')
      const envObj = d.claude_env ?? d.claudeEnv ?? {}
      const envRaw = d.claudeEnvJSON ?? d.envJSON ?? JSON.stringify(envObj, null, 2)
      const env = parseEnv(envRaw)
      setEnvJSON(envRaw)
      setTimeoutSeconds(String(d.request_timeout_seconds ?? d.timeout ?? 300))
      setThinkingBudget(String(d.max_thinking_budget_tokens ?? d.thinkingBudgetTokens ?? 0))
      setDisableNonessential(env.DISABLE_NONESSENTIAL === 'true')
      setEnableToolSearch(env.ENABLE_TOOL_SEARCH === 'true')
      setDisableAttribution(env.DISABLE_ATTRIBUTION === 'true')
      setDisableThinking(env.DISABLE_THINKING === 'true')
      setMaxOutputTokens(env.MAX_OUTPUT_TOKENS ?? '')
      setMaxMCPTokens(env.MAX_MCP_TOKENS ?? '')
      setApiTimeout(env.API_TIMEOUT ?? '')
      setMcpTimeout(env.MCP_TIMEOUT ?? '')
      if (d.plugins) setPlugins(d.plugins)
    }).catch(() => {})
  }, [])

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
      if (!activeProfile) throw new Error('active profile not found')
      const err = await wails.SaveProfileConfig(activeProfile, '', '', '', '', '', timeoutSeconds, thinkingBudget, '', '', '', '', '', built, '', '')
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      const pluginErr = await wails.SavePlugins(JSON.stringify(plugins))
      if (pluginErr && typeof pluginErr === 'string' && pluginErr !== 'success') throw new Error(pluginErr)
      toast(t('toast_saved'), 'success')
    } catch {
      toast(t('toast_save_failed'), 'error')
    } finally {
      setSaving(false)
    }
  }, [activeProfile, apiTimeout, disableAttribution, disableNonessential, disableThinking, enableToolSearch, envJSON, maxMCPTokens, maxOutputTokens, mcpTimeout, plugins, t, thinkingBudget, timeoutSeconds, toast])

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={onChange} type="button"><span /></button>
  )

  const featureToggles = [
    { id: 'web_search', title: t('plugin_web_search_title'), desc: t('plugin_web_search_desc') },
    { id: 'auto_compress', title: t('plugin_auto_compress_title'), desc: t('plugin_auto_compress_desc') },
    { id: 'session_save', title: t('plugin_session_save_title'), desc: t('plugin_session_save_desc') },
    { id: 'git_sync', title: t('plugin_git_sync_title'), desc: t('plugin_git_sync_desc') },
  ]

  return (
    <div>
      <div className="set-top">
        <div>
          <h1 className="set-title">{t('sett_s04_title')}</h1>
          <p className="set-subtitle">{embedded ? `Active ${line === 'codex' ? 'Codex' : 'Claude'} runtime and env overrides` : t('sett_s04_sub')}</p>
        </div>
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
      <section className="set-section">
        <div className="head"><div><h3>{t('sett_section_plugins')}</h3><div className="sub">{t('sett_section_plugins_desc')}</div></div></div>
        <div className="set-card">
          {featureToggles.map(p => {
            const isEnabled = !!plugins[p.id]
            return (
              <div className="set-row" key={p.id}>
                <div className="label"><b>{p.title}</b><p>{p.desc}</p></div>
                <div className="control">
                  <div className="settings-row">
                    <Toggle checked={isEnabled} onChange={() => setPlugins(prev => ({ ...prev, [p.id]: !prev[p.id] }))} label={p.title} />
                    <span style={{ fontSize: 11.5, minWidth: 40, color: isEnabled ? 'var(--online)' : 'var(--ink-400)', fontWeight: 500 }}>
                      {isEnabled ? t('plugin_status_active') : t('plugin_status_inactive')}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
