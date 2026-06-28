import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { wails, apiGet, apiFetch, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { PreferencesSection } from './settings/PreferencesSection'
import { EnvironmentSection } from './settings/EnvironmentSection'
import { ModelSection } from './settings/ModelSection'
import { HubSection } from './settings/HubSection'
import { ApiSection } from './settings/ApiSection'
import { NetworkSection } from './settings/NetworkSection'
import { BackupsSection } from './settings/BackupsSection'
import { AboutSection } from './settings/AboutSection'
import { SecuritySection } from './settings/SecuritySection'
import { PluginsSection } from './settings/PluginsSection'
import { type FormState, type SetField, DEFAULT_FORM } from './settings/types'

const BUILTIN_MODELS = [
 { id: 'kimi-k2.6', label: 'kimi-k2.6', category: 'Kimi' },
 { id: 'kimi-k2.5', label: 'kimi-k2.5', category: 'Kimi' },
 { id: 'qwen3.7-max', label: 'Qwen3.7 Max', category: 'Qwen' },
 { id: 'qwen3.6-plus', label: 'qwen3.6-plus', category: 'Qwen' },
 { id: 'qwen3.5-plus', label: 'qwen3.5-plus', category: 'Qwen' },
 { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', category: 'DeepSeek' },
 { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', category: 'DeepSeek' },
 { id: 'glm-5.1', label: 'glm-5.1', category: 'Zhipu' },
 { id: 'glm-5', label: 'glm-5', category: 'Zhipu' },
 { id: 'hy3-preview', label: 'hy3-preview', category: 'Hunyuan' },
 { id: 'mimo-v2.5-pro', label: 'mimo-v2.5-pro', category: 'MiMo' },
 { id: 'mimo-v2.5', label: 'mimo-v2.5', category: 'MiMo' },
 { id: 'minimax-m2.7', label: 'minimax-m2.7', category: 'MiniMax' },
]

type TabId = 'proxy' | 'models' | 'advanced' | 'appearance' | 'more'

const TABS: { id: TabId; icon: string }[] = [
 { id: 'proxy', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
 { id: 'models', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
 { id: 'advanced', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' },
 { id: 'appearance', icon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' },
 { id: 'more', icon: 'M4 6h16M4 12h16M4 18h16' },
]

export default function SettingsPage() {
 const { t } = useI18n()
 const { toast } = useToast()
 const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM })
 const [saved, setSaved] = useState<FormState>({ ...DEFAULT_FORM })
 const [profiles, setProfiles] = useState<string[]>([])
 const [errors, setErrors] = useState<Record<string, string>>({})
 const [saving, setSaving] = useState(false)
 const [loading, setLoading] = useState(true)
 const initRef = useRef(false)
 const [activeTab, setActiveTab] = useState<TabId>(() => {
   const s = localStorage.getItem('settings-tab')
   return (['proxy','models','advanced','appearance','more'].includes(s || '') ? s : 'proxy') as TabId
 })

 const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
   const s = localStorage.getItem('theme')
   return (['light', 'dark', 'system'].includes(s || '') ? s : 'system') as any
 })
 const [accentHue, setAccentHue] = useState(() => {
   const s = localStorage.getItem('accent_hue')
   return s ? parseInt(s, 10) : 210
 })
 const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'zh')

 const [hubEnabled, setHubEnabled] = useState(false)
 const [hubUrl, setHubUrl] = useState('')
 const [hubSecret, setHubSecret] = useState('')
 const [hubDeviceName, setHubDeviceName] = useState('')
 const [hubInterval, setHubInterval] = useState('120')
 const [savedHub, setSavedHub] = useState({ enabled: false, url: '', secret: '', deviceName: '', interval: '120' })

 useEffect(() => {
   const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
   document.documentElement.dataset.theme = resolved
   localStorage.setItem('theme', theme)
 }, [theme])

 useEffect(() => {
   document.documentElement.style.setProperty('--link', `hsl(${accentHue}, 80%, 55%)`)
   localStorage.setItem('accent_hue', String(accentHue))
 }, [accentHue])

 useEffect(() => { localStorage.setItem('settings-tab', activeTab) }, [activeTab])

 const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
  setForm((prev) => ({ ...prev, [key]: value }))
 }, [])

 const hubDirty = hubEnabled !== savedHub.enabled || hubUrl !== savedHub.url || hubSecret !== savedHub.secret || hubDeviceName !== savedHub.deviceName || hubInterval !== savedHub.interval
 const isDirty = JSON.stringify(form) !== JSON.stringify(saved) || hubDirty

 useEffect(() => {
  if (!isDirty) return
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
 }, [isDirty])

 useEffect(() => { loadData() }, [])

 useEffect(() => {
  if (!initRef.current) return
  if (form.profile && form.profile !== saved.profile) loadProfileData(form.profile)
 }, [form.profile])

 async function loadData() {
  setLoading(true)
  try {
   const [statusData, profilesData] = await Promise.all([
    apiGet('/ocgt/api/status').catch(() => null),
    apiGet('/ocgt/api/profiles').catch(() => null),
   ])
   if (profilesData) {
    const profileList = Array.isArray(profilesData)
      ? profilesData
      : (profilesData.profiles && typeof profilesData.profiles === 'object')
        ? Object.keys(profilesData.profiles) : []
    setProfiles(profileList.map((p: string | { name?: string; id?: string }) => (typeof p === 'string' ? p : p.name ?? p.id ?? '')))
   }
   if (statusData) applyStatusData(statusData)
   if (isWails()) {
    try {
     const prefs = await wails.GetPreferences()
     if (prefs) {
      if (prefs.theme && ['light','dark','system'].includes(prefs.theme)) setTheme(prefs.theme as any)
      if (prefs.accent_hue) setAccentHue(parseInt(prefs.accent_hue))
      if (prefs.language) setLanguage(prefs.language)
      if (prefs.close_behavior) set('closeBehavior', prefs.close_behavior)
     }
    } catch {}
    try {
     const hubRaw = await wails.GetHubConfig()
     if (hubRaw) {
      const hubCfg = typeof hubRaw === 'string' ? JSON.parse(hubRaw) : hubRaw
      if (hubCfg && typeof hubCfg === 'object') {
        const hs = { enabled: !!hubCfg.enabled, url: hubCfg.hubUrl || '', secret: '', deviceName: hubCfg.deviceName || '', interval: String(hubCfg.interval || 120) }
        setHubEnabled(hs.enabled); setHubUrl(hs.url); setHubDeviceName(hs.deviceName); setHubInterval(hs.interval); setSavedHub(hs)
      }
     }
    } catch {}
   }
  } catch {} finally { setLoading(false); initRef.current = true }
 }

 function applyStatusData(d: Record<string, any>) {
  const env = parseEnvJSON(d.claudeEnvJSON ?? d.envJSON ?? '{}')
  const next: FormState = {
   profile: d.profile ?? 'default', apiKey: d.apiKey ?? d.api_key ?? '',
   defaultModel: '', sonnetAlias: '', haikuAlias: '', opusAlias: '',
   timeoutSeconds: String(d.timeout ?? d.timeoutSeconds ?? '300'),
   thinkingBudgetTokens: String(d.thinkingBudgetTokens ?? d.thinking_budget ?? '0'),
   listenAddr: d.listenAddr ?? d.listen ?? '127.0.0.1:8787',
   upstream: d.upstream ?? d.upstreamURL ?? '',
   rateLimitPerSecond: String(d.rateLimitPerSecond ?? d.rate_limit_per_second ?? '0'),
   rateLimitBurst: String(d.rateLimitBurst ?? d.rate_limit_burst ?? '0'),
   rateLimitPerMinute: String(d.rateLimitPerMinute ?? d.rate_limit_per_minute ?? '0'),
   claudeEnvJSON: d.claudeEnvJSON ?? d.envJSON ?? '{}',
   disableNonessential: env.DISABLE_NONESSENTIAL === 'true', enableToolSearch: env.ENABLE_TOOL_SEARCH === 'true',
   disableAttribution: env.DISABLE_ATTRIBUTION === 'true', disableThinking: env.DISABLE_THINKING === 'true',
   maxOutputTokens: env.MAX_OUTPUT_TOKENS ?? '', maxMCPTokens: env.MAX_MCP_TOKENS ?? '',
   apiTimeout: env.API_TIMEOUT ?? '', mcpTimeout: env.MCP_TIMEOUT ?? '',
   closeBehavior: d.closeBehavior ?? 'prompt', logEnabled: d.logEnabled ?? false,
   logDir: d.logDir ?? '', logRetention: String(d.logRetention ?? '7'),
   customDefaultModel: '', customSonnetAlias: '', customHaikuAlias: '', customOpusAlias: '',
   plugins: d.plugins ?? {}, authEnabled: !!d.auth_enabled,
   rateLimitingEnabled: parseInt(String(d.rate_limit_per_second ?? '0')) > 0 || parseInt(String(d.rate_limit_burst ?? '0')) > 0,
  }
  const dm = d.defaultModel ?? d.model ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === dm) || !dm) { next.defaultModel = dm } else { next.defaultModel = 'custom'; next.customDefaultModel = dm }
  const sa = d.sonnetAlias ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === sa) || !sa) { next.sonnetAlias = sa } else { next.sonnetAlias = 'custom'; next.customSonnetAlias = sa }
  const ha = d.haikuAlias ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === ha) || !ha) { next.haikuAlias = ha } else { next.haikuAlias = 'custom'; next.customHaikuAlias = ha }
  const oa = d.opusAlias ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === oa) || !oa) { next.opusAlias = oa } else { next.opusAlias = 'custom'; next.customOpusAlias = oa }
  setForm(next); setSaved(next)
 }

 async function loadProfileData(name: string) {
  try {
   const data = await apiGet(`/ocgt/api/profiles/${name}`).catch(() => null)
   if (data) { applyStatusData({ ...data, profile: name }); toast(t('toast_profile_changed'), 'info') }
  } catch {}
 }

 function parseEnvJSON(raw: string): Record<string, string> {
  try { const obj = JSON.parse(raw); if (typeof obj === 'object' && obj !== null) return obj } catch {} return {}
 }

 function buildEnvJSON(): string {
  const env: Record<string, string> = parseEnvJSON(form.claudeEnvJSON)
  if (form.disableNonessential) env.DISABLE_NONESSENTIAL = 'true'; else delete env.DISABLE_NONESSENTIAL
  if (form.enableToolSearch) env.ENABLE_TOOL_SEARCH = 'true'; else delete env.ENABLE_TOOL_SEARCH
  if (form.disableAttribution) env.DISABLE_ATTRIBUTION = 'true'; else delete env.DISABLE_ATTRIBUTION
  if (form.disableThinking) env.DISABLE_THINKING = 'true'; else delete env.DISABLE_THINKING
  if (form.maxOutputTokens) env.MAX_OUTPUT_TOKENS = form.maxOutputTokens; else delete env.MAX_OUTPUT_TOKENS
  if (form.maxMCPTokens) env.MAX_MCP_TOKENS = form.maxMCPTokens; else delete env.MAX_MCP_TOKENS
  if (form.apiTimeout) env.API_TIMEOUT = form.apiTimeout; else delete env.API_TIMEOUT
  if (form.mcpTimeout) env.MCP_TIMEOUT = form.mcpTimeout; else delete env.MCP_TIMEOUT
  return JSON.stringify(env, null, 2)
 }

 function validate(): boolean {
  const e: Record<string, string> = {}
  const addrPattern = /^[\w.\-]+:\d{1,5}$/
  if (form.listenAddr && !addrPattern.test(form.listenAddr)) e.listenAddr = t('err_listen_addr')
  const timeout = parseInt(form.timeoutSeconds)
  if (isNaN(timeout) || timeout < 1 || timeout > 3600) e.timeoutSeconds = t('err_timeout_range')
  if (form.rateLimitingEnabled) {
   const rps = parseInt(form.rateLimitPerSecond); if (isNaN(rps) || rps < 1 || rps > 10000) e.rateLimitPerSecond = t('err_rate_limit_range')
   const burst = parseInt(form.rateLimitBurst); if (isNaN(burst) || burst < 1 || burst > 100000) e.rateLimitBurst = t('err_rate_burst_range')
   const rpm = parseInt(form.rateLimitPerMinute); if (isNaN(rpm) || rpm < 0 || rpm > 100000) e.rateLimitPerMinute = t('err_rate_minute_range')
  }
  if (form.upstream && !/^https?:\/\/.+/.test(form.upstream)) e.upstream = t('err_upstream_url')
  try {
   const parsed = JSON.parse(form.claudeEnvJSON)
   if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { e.claudeEnvJSON = t('err_claude_env_json') }
   else { for (const [k, v] of Object.entries(parsed)) { if (typeof k !== 'string' || typeof v !== 'string') { e.claudeEnvJSON = t('err_claude_env_json'); break } } }
  } catch { e.claudeEnvJSON = t('err_claude_env_json') }
  setErrors(e); return Object.keys(e).length === 0
 }

 async function handleSave() {
  if (!validate()) { toast(t('toast_validation_error'), 'error'); return }
  setSaving(true)
  try {
   const dm = form.defaultModel === 'custom' ? form.customDefaultModel : form.defaultModel
   const sa = form.sonnetAlias === 'custom' ? form.customSonnetAlias : form.sonnetAlias
   const ha = form.haikuAlias === 'custom' ? form.customHaikuAlias : form.haikuAlias
   const oa = form.opusAlias === 'custom' ? form.customOpusAlias : form.opusAlias
   const envJSON = buildEnvJSON()
   const rps = form.rateLimitingEnabled ? form.rateLimitPerSecond : ''
   const burst = form.rateLimitingEnabled ? form.rateLimitBurst : ''
   const rpm = form.rateLimitingEnabled ? form.rateLimitPerMinute : ''
   const checkResult = (val: unknown) => { if (val && typeof val === 'string' && val !== 'success') return val; return null }

   const saveErr = await wails.SaveProfileConfig(form.profile, form.apiKey, dm, sa, ha, oa, form.timeoutSeconds, form.thinkingBudgetTokens, form.listenAddr, form.upstream, rps, burst, rpm, envJSON, '', '')
   const saveFail = checkResult(saveErr); if (saveFail) throw new Error(saveFail)
   const authErr = await wails.SetAuthEnabled(form.authEnabled)
   const authFail = checkResult(authErr); if (authFail) throw new Error(authFail)
   if (isWails()) {
    const interval = Math.max(30, Math.min(1800, parseInt(hubInterval) || 120))
    const hubErr = await wails.SaveHubConfig(hubEnabled, hubUrl, hubSecret, hubDeviceName, interval)
    const hubFail = checkResult(hubErr); if (hubFail) throw new Error(hubFail)
   }
   const logDirty = form.logEnabled !== saved.logEnabled || form.logDir !== saved.logDir || form.logRetention !== saved.logRetention
   if (logDirty) { const logErr = await wails.SaveLogPreferences(form.logEnabled, form.logDir, parseInt(form.logRetention) || 7); const logFail = checkResult(logErr); if (logFail) throw new Error(logFail) }
   const pluginErr = await wails.SavePlugins(JSON.stringify(form.plugins))
   const pluginFail = checkResult(pluginErr); if (pluginFail) throw new Error(pluginFail)
   if (isWails()) {
    await wails.SaveUIPreferences(theme, language, accentHue, localStorage.getItem('last-view') || 'dashboard', '', '').catch(() => {})
    await wails.SavePreferences(form.closeBehavior).catch(() => {})
    localStorage.setItem('theme', theme); localStorage.setItem('accent_hue', String(accentHue)); localStorage.setItem('language', language); localStorage.setItem('close_behavior', form.closeBehavior)
   }
   const next = { ...form, claudeEnvJSON: envJSON }
   setSaved(next); setForm(next)
   setSavedHub({ enabled: hubEnabled, url: hubUrl, secret: hubSecret, deviceName: hubDeviceName, interval: hubInterval })
   setErrors({}); toast(t('toast_saved'), 'success')
  } catch { toast(t('toast_save_failed'), 'error') } finally { setSaving(false) }
 }

 function handleCancel() {
  setForm({ ...saved }); setErrors({})
  setHubEnabled(savedHub.enabled); setHubUrl(savedHub.url); setHubSecret(savedHub.secret); setHubDeviceName(savedHub.deviceName); setHubInterval(savedHub.interval)
 }

 function modelOptions(currentCustom: string) {
  return (
   <>
    <option value="">{t('status_not_configured')}</option>
    {BUILTIN_MODELS.map((m) => (<option key={m.id} value={m.id}>{`${m.category} / ${m.label}`}</option>))}
    <option value="custom">{t('opt_custom')}</option>
    {currentCustom && (<option value="custom" hidden>{`${t('opt_custom')} (${currentCustom})`}</option>)}
   </>
  )
 }

 if (loading) return null

 const tabLabels: Record<TabId, string> = {
   proxy: t('sett_tab_proxy'), models: t('sett_tab_models'), advanced: t('sett_tab_advanced'),
   appearance: t('sett_tab_appearance'), more: t('sett_tab_more'),
 }

 return (
  <div id="page-settings">
   <div className="set-top">
    <div>
     <h1 className="set-title">{t('sett_hero_title')} <em>{t('sett_hero_title_em')}</em></h1>
     <p className="set-subtitle">{t('subtitle_settings')}</p>
    </div>
    <div className="set-actions">
     {isDirty && <span className="set-dirty">{t('hint_changes_detected')}</span>}
     <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={!isDirty}>{t('sett_discard')}</button>
     <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !isDirty}>{saving ? '...' : t('btn_save_config')}</button>
    </div>
   </div>

   <nav className="set-tabs" role="tablist">
     {TABS.map(tab => (
       <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
         className={`set-tab${activeTab === tab.id ? ' active' : ''}`}
         onClick={() => setActiveTab(tab.id)} type="button">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={tab.icon} /></svg>
         {tabLabels[tab.id]}
       </button>
     ))}
   </nav>

   <div className="set-panel">
     {activeTab === 'proxy' && (<>
       <ApiSection form={form} set={set} saved={saved} />
       <NetworkSection form={form} set={set} errors={errors} />
     </>)}
     {activeTab === 'models' && <ModelSection form={form} set={set} modelOptions={modelOptions} />}
     {activeTab === 'advanced' && (<>
       <EnvironmentSection form={form} set={set} errors={errors} />
       <SecuritySection form={form} set={set} />
     </>)}
     {activeTab === 'appearance' && <PreferencesSection form={form} set={set} theme={theme} setTheme={setTheme} accentHue={accentHue} setAccentHue={setAccentHue} language={language} setLanguage={setLanguage} />}
     {activeTab === 'more' && (<>
       <HubSection hubEnabled={hubEnabled} setHubEnabled={setHubEnabled} hubUrl={hubUrl} setHubUrl={setHubUrl} hubSecret={hubSecret} setHubSecret={setHubSecret} hubDeviceName={hubDeviceName} setHubDeviceName={setHubDeviceName} hubInterval={hubInterval} setHubInterval={setHubInterval} />
       <PluginsSection form={form} set={set} />
       <BackupsSection />
       <AboutSection />
     </>)}
   </div>
  </div>
 )
}
