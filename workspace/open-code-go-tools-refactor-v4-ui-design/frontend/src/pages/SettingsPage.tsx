import { memo, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
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

const THINKING_OPTIONS = [
 { value: '0', labelKey: 'opt_thinking_off' as const },
 { value: '256', labelKey: 'opt_thinking_256' as const },
 { value: '512', labelKey: 'opt_thinking_512' as const },
 { value: '1024', labelKey: 'opt_thinking_1024' as const },
 { value: '2048', labelKey: 'opt_thinking_2048' as const },
]


 /** Reusable toggle row for settings */
 function SettingToggle({ label, desc, checked, onChange, ariaLabel }: {
 label: string; desc: string; checked: boolean; onChange: () => void; ariaLabel: string
 }) {
 return (
   <div className="set-row">
     <div className="label"><b>{label}</b><p>{desc}</p></div>
     <div className="control">
       <button role="switch" aria-checked={checked} aria-label={ariaLabel} className={`toggle${checked ? ' on' : ''}`} onClick={onChange} type="button">
         <span />
       </button>
     </div>
   </div>
 )
 }

 /** Reusable input row for settings */
 function SettingInput({ label, desc, value, onChange, placeholder, prefix, type = 'text', error }: {
 label: string; desc: string; value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string; type?: string; error?: string
 }) {
 return (
   <div className="set-row">
     <div className="label"><b>{label}</b><p>{desc}</p></div>
     <div className="control">
       <div className="input-wrap">
         {prefix && <span className="prefix">{prefix}</span>}
         <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
       </div>
       {error && <div className="error">{error}</div>}
     </div>
   </div>
 )
 }

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
 // Theme & Accent preference (localStorage, no backend)
 const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
   const saved = localStorage.getItem('theme')
   return (['light', 'dark', 'system'].includes(saved || '') ? saved : 'system') as any
 })
 const [accentHue, setAccentHue] = useState(() => {
   const saved = localStorage.getItem('accent_hue')
   return saved ? parseInt(saved, 10) : 210
 })
 const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'zh')
 const [closeBehavior, setCloseBehavior] = useState(() => localStorage.getItem('close_behavior') || 'prompt')
 const [hubEnabled, setHubEnabled] = useState(false)
 const [hubUrl, setHubUrl] = useState('')
 const [hubSecret, setHubSecret] = useState('')
 const [hubDeviceName, setHubDeviceName] = useState('')
 const [hubInterval, setHubInterval] = useState('120')
 const [savedHub, setSavedHub] = useState({ enabled: false, url: '', secret: '', deviceName: '', interval: '120' })
 useEffect(() => {
   // Apply theme
   const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
   document.documentElement.dataset.theme = resolved
   localStorage.setItem('theme', theme)
 }, [theme])
 useEffect(() => {
   // Apply accent hue to --link CSS variable
   document.documentElement.style.setProperty('--link', `hsl(${accentHue}, 80%, 55%)`)
   localStorage.setItem('accent_hue', String(accentHue))
 }, [accentHue])

 // Active section tracking for sec-nav
 const [activeSection, setActiveSection] = useState(0)
 useEffect(() => {
  const ids = ['set-01','set-02','set-03','set-04','set-05','set-06','set-07','set-08','set-09','set-10']
  const observer = new IntersectionObserver((entries) => {
   for (const e of entries) {
    if (e.isIntersecting) {
     const idx = ids.indexOf(e.target.id)
     if (idx >= 0) setActiveSection(idx)
    }
   }
  }, { rootMargin: '-20% 0px -70% 0px' })
  // Delay to ensure sub-component sections are rendered
  const timer = setTimeout(() => {
   ids.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el) })
  }, 100)
  return () => { clearTimeout(timer); observer.disconnect() }
 }, [])

 const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
  setForm((prev) => ({ ...prev, [key]: value }))
 }, [])

 const hubDirty = hubEnabled !== savedHub.enabled || hubUrl !== savedHub.url || hubSecret !== savedHub.secret || hubDeviceName !== savedHub.deviceName || hubInterval !== savedHub.interval
 const isDirty = JSON.stringify(form) !== JSON.stringify(saved) || hubDirty

 // Warn on navigation away with unsaved changes
 useEffect(() => {
  if (!isDirty) return
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
 }, [isDirty])

 useEffect(() => {
  loadData()
 }, [])

 useEffect(() => {
  if (!initRef.current) return
  if (form.profile && form.profile !== saved.profile) {
   loadProfileData(form.profile)
  }
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
        ? Object.keys(profilesData.profiles)
        : []
    setProfiles(profileList.map((p: string | { name?: string; id?: string }) => (typeof p === 'string' ? p : p.name ?? p.id ?? '')))
   }

   if (statusData) {
    applyStatusData(statusData)
   }

   // Load Wails preferences (theme, language, accent, etc.)
   if (isWails()) {
    try {
     const prefs = await wails.GetPreferences()
     if (prefs) {
      if (prefs.theme && ['light','dark','system'].includes(prefs.theme)) setTheme(prefs.theme as 'light' | 'dark' | 'system')
      if (prefs.accent_hue) setAccentHue(parseInt(prefs.accent_hue))
      if (prefs.language) setLanguage(prefs.language)
      if (prefs.close_behavior) setCloseBehavior(prefs.close_behavior)
     }
    } catch { /* ignore */ }

    // Load Hub config
    try {
     const hubRaw = await wails.GetHubConfig()
     if (hubRaw) {
      const hubCfg = typeof hubRaw === 'string' ? JSON.parse(hubRaw) : hubRaw
      if (hubCfg && typeof hubCfg === 'object') {
        const hubState = {
          enabled: !!hubCfg.enabled,
          url: hubCfg.hubUrl || '',
          secret: '',
          deviceName: hubCfg.deviceName || '',
          interval: String(hubCfg.interval || 120),
        }
        setHubEnabled(hubState.enabled)
        setHubUrl(hubState.url)
        setHubDeviceName(hubState.deviceName)
        setHubInterval(hubState.interval)
        setSavedHub(hubState)
      }
     }
    } catch { /* ignore */ }
   }
  } catch {
   // dev mode fallback
  } finally {
   setLoading(false)
   initRef.current = true
  }
 }

 function applyStatusData(d: Record<string, any>) {
  const env = parseEnvJSON(d.claudeEnvJSON ?? d.envJSON ?? '{}')

  const next: FormState = {
   profile: d.profile ?? 'default',
   apiKey: d.apiKey ?? d.api_key ?? '',
   defaultModel: '',
   sonnetAlias: '',
   haikuAlias: '',
   opusAlias: '',
   timeoutSeconds: String(d.timeout ?? d.timeoutSeconds ?? '300'),
   thinkingBudgetTokens: String(d.thinkingBudgetTokens ?? d.thinking_budget ?? '0'),
   listenAddr: d.listenAddr ?? d.listen ?? '127.0.0.1:8787',
   upstream: d.upstream ?? d.upstreamURL ?? '',
   rateLimitPerSecond: String(d.rateLimitPerSecond ?? d.rate_limit_per_second ?? '0'),
   rateLimitBurst: String(d.rateLimitBurst ?? d.rate_limit_burst ?? '0'),
   rateLimitPerMinute: String(d.rateLimitPerMinute ?? d.rate_limit_per_minute ?? '0'),
   claudeEnvJSON: d.claudeEnvJSON ?? d.envJSON ?? '{}',
   disableNonessential: env.DISABLE_NONESSENTIAL === 'true',
   enableToolSearch: env.ENABLE_TOOL_SEARCH === 'true',
   disableAttribution: env.DISABLE_ATTRIBUTION === 'true',
   disableThinking: env.DISABLE_THINKING === 'true',
   maxOutputTokens: env.MAX_OUTPUT_TOKENS ?? '',
   maxMCPTokens: env.MAX_MCP_TOKENS ?? '',
   apiTimeout: env.API_TIMEOUT ?? '',
   mcpTimeout: env.MCP_TIMEOUT ?? '',
   closeBehavior: d.closeBehavior ?? 'prompt',
   logEnabled: d.logEnabled ?? false,
   logDir: d.logDir ?? '',
   logRetention: String(d.logRetention ?? '7'),
   customDefaultModel: '',
   customSonnetAlias: '',
   customHaikuAlias: '',
   customOpusAlias: '',
   plugins: d.plugins ?? {},
    authEnabled: !!d.auth_enabled,
    rateLimitingEnabled: parseInt(String(d.rate_limit_per_second ?? '0')) > 0 || parseInt(String(d.rate_limit_burst ?? '0')) > 0,
   }

  const dm = d.defaultModel ?? d.model ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === dm) || !dm) {
   next.defaultModel = dm
  } else {
   next.defaultModel = 'custom'
   next.customDefaultModel = dm
  }

  const sa = d.sonnetAlias ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === sa) || !sa) {
   next.sonnetAlias = sa
  } else {
   next.sonnetAlias = 'custom'
   next.customSonnetAlias = sa
  }

  const ha = d.haikuAlias ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === ha) || !ha) {
   next.haikuAlias = ha
  } else {
   next.haikuAlias = 'custom'
   next.customHaikuAlias = ha
  }

  const oa = d.opusAlias ?? ''
  if (BUILTIN_MODELS.some((m) => m.id === oa) || !oa) {
   next.opusAlias = oa
  } else {
   next.opusAlias = 'custom'
   next.customOpusAlias = oa
  }

  setForm(next)
  setSaved(next)
 }

 async function loadProfileData(name: string) {
  try {
   const data = await apiGet(`/ocgt/api/profiles/${name}`).catch(() => null)
   if (data) {
    applyStatusData({ ...data, profile: name })
    toast(t('toast_profile_changed'), 'info')
   }
  } catch {
   // profile load failed silently
  }
 }

 function parseEnvJSON(raw: string): Record<string, string> {
  try {
   const obj = JSON.parse(raw)
   if (typeof obj === 'object' && obj !== null) return obj
  } catch {
   // invalid JSON
  }
  return {}
 }

 function buildEnvJSON(): string {
  const env: Record<string, string> = parseEnvJSON(form.claudeEnvJSON)
  if (form.disableNonessential) env.DISABLE_NONESSENTIAL = 'true'
  else delete env.DISABLE_NONESSENTIAL
  if (form.enableToolSearch) env.ENABLE_TOOL_SEARCH = 'true'
  else delete env.ENABLE_TOOL_SEARCH
  if (form.disableAttribution) env.DISABLE_ATTRIBUTION = 'true'
  else delete env.DISABLE_ATTRIBUTION
  if (form.disableThinking) env.DISABLE_THINKING = 'true'
  else delete env.DISABLE_THINKING
  if (form.maxOutputTokens) env.MAX_OUTPUT_TOKENS = form.maxOutputTokens
  else delete env.MAX_OUTPUT_TOKENS
  if (form.maxMCPTokens) env.MAX_MCP_TOKENS = form.maxMCPTokens
  else delete env.MAX_MCP_TOKENS
  if (form.apiTimeout) env.API_TIMEOUT = form.apiTimeout
  else delete env.API_TIMEOUT
  if (form.mcpTimeout) env.MCP_TIMEOUT = form.mcpTimeout
  else delete env.MCP_TIMEOUT
  return JSON.stringify(env, null, 2)
 }

 function validate(): boolean {
  const e: Record<string, string> = {}
  const addrPattern = /^[\w.\-]+:\d{1,5}$/
  if (form.listenAddr && !addrPattern.test(form.listenAddr)) {
   e.listenAddr = t('err_listen_addr')
  }
  const timeout = parseInt(form.timeoutSeconds)
  if (isNaN(timeout) || timeout < 1 || timeout > 3600) {
   e.timeoutSeconds = t('err_timeout_range')
  }
  const rps = parseInt(form.rateLimitPerSecond)
  if (form.rateLimitPerSecond !== '0' && (isNaN(rps) || rps < 1 || rps > 10000)) {
   e.rateLimitPerSecond = t('err_rate_limit_range')
  }
  const burst = parseInt(form.rateLimitBurst)
  if (form.rateLimitBurst !== '0' && (isNaN(burst) || burst < 1 || burst > 100000)) {
   e.rateLimitBurst = t('err_rate_burst_range')
  }
  const rpm = parseInt(form.rateLimitPerMinute)
  if (isNaN(rpm) || rpm < 0 || rpm > 100000) {
   e.rateLimitPerMinute = t('err_rate_minute_range')
  }
  if (form.upstream && !/^https?:\/\/.+/.test(form.upstream)) {
   e.upstream = t('err_upstream_url')
  }
  try {
   const parsed = JSON.parse(form.claudeEnvJSON)
   if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    e.claudeEnvJSON = t('err_claude_env_json')
   } else {
    for (const [k, v] of Object.entries(parsed)) {
     if (typeof k !== 'string' || typeof v !== 'string') {
      e.claudeEnvJSON = t('err_claude_env_json')
      break
     }
    }
   }
  } catch {
   e.claudeEnvJSON = t('err_claude_env_json')
  }
  setErrors(e)
  return Object.keys(e).length === 0
 }

 async function handleSave() {
  if (!validate()) {
   toast(t('toast_validation_error'), 'error')
   return
  }
  setSaving(true)
  try {
   const dm = form.defaultModel === 'custom' ? form.customDefaultModel : form.defaultModel
   const sa = form.sonnetAlias === 'custom' ? form.customSonnetAlias : form.sonnetAlias
   const ha = form.haikuAlias === 'custom' ? form.customHaikuAlias : form.haikuAlias
   const oa = form.opusAlias === 'custom' ? form.customOpusAlias : form.opusAlias
   const envJSON = buildEnvJSON()

   // Rate limiting: when custom limits off, keep saved/default values
   const rps = form.rateLimitingEnabled ? form.rateLimitPerSecond : saved.rateLimitPerSecond
   const burst = form.rateLimitingEnabled ? form.rateLimitBurst : saved.rateLimitBurst
   const rpm = form.rateLimitingEnabled ? form.rateLimitPerMinute : saved.rateLimitPerMinute

   const checkResult = (val: unknown) => {
    if (val && typeof val === 'string' && val !== 'success') return val
    return null
   }

   const saveErr = await wails.SaveProfileConfig(
    form.profile,
    form.apiKey,
    dm,
    sa,
    ha,
    oa,
    form.timeoutSeconds,
    form.thinkingBudgetTokens,
    form.listenAddr,
    form.upstream,
    rps,
    burst,
    rpm,
    envJSON,
    '',
    '',
   )
   const saveFail = checkResult(saveErr)
   if (saveFail) throw new Error(saveFail)

   // Persist auth toggle (generates/clears local_auth_token in config)
   const authErr = await wails.SetAuthEnabled(form.authEnabled)
   const authFail = checkResult(authErr)
   if (authFail) throw new Error(authFail)

   // Persist Hub config
   if (isWails()) {
    const interval = Math.max(30, Math.min(1800, parseInt(hubInterval) || 120))
    const hubErr = await wails.SaveHubConfig(hubEnabled, hubUrl, hubSecret, hubDeviceName, interval)
    const hubFail = checkResult(hubErr)
    if (hubFail) throw new Error(hubFail)
   }

   if (form.logDir || form.logRetention !== '7' || form.logEnabled) {
    await wails.SaveLogPreferences(form.logEnabled, form.logDir, parseInt(form.logRetention) || 7)
   }

   // Save UI preferences (theme, accent, language, closeBehavior)
   if (isWails()) {
    await wails.SaveUIPreferences(theme, language, accentHue, localStorage.getItem('last-view') || 'dashboard', '', '').catch(() => {})
    await wails.SavePreferences(closeBehavior).catch(() => {})
    // Persist to localStorage as well for web fallback
    localStorage.setItem('theme', theme)
    localStorage.setItem('accent_hue', String(accentHue))
    localStorage.setItem('language', language)
    localStorage.setItem('close_behavior', closeBehavior)
   }

   const next = { ...form, claudeEnvJSON: envJSON }
   setSaved(next)
   setForm(next)
   setSavedHub({ enabled: hubEnabled, url: hubUrl, secret: hubSecret, deviceName: hubDeviceName, interval: hubInterval })
   setErrors({})
   toast(t('toast_saved'), 'success')
  } catch {
   toast(t('toast_save_failed'), 'error')
  } finally {
   setSaving(false)
  }
 }

 function handleCancel() {
  setForm({ ...saved })
  setErrors({})
  setHubEnabled(savedHub.enabled)
  setHubUrl(savedHub.url)
  setHubSecret(savedHub.secret)
  setHubDeviceName(savedHub.deviceName)
  setHubInterval(savedHub.interval)
 }

 function modelOptions(currentCustom: string) {
  return (
   <>
    <option value="">{t('status_not_configured')}</option>
    {BUILTIN_MODELS.map((m) => (
     <option key={m.id} value={m.id}>{`${m.category} / ${m.label}`}</option>
    ))}
    <option value="custom">{t('opt_custom')}</option>
    {currentCustom && (
     <option value="custom" hidden>
      {`${t('opt_custom')} (${currentCustom})`}
     </option>
    )}
   </>
  )
 }

 if (loading) return null

 return (
  <div id="page-settings">
   <div className="page-label"><span className="idx">7</span><span>{t('nav_settings').toUpperCase()}</span><span className="path">/settings</span></div>

   <div className="row between" style={{ marginBottom: 18, alignItems: 'flex-end' }}>
    <div>
     <h1 className="hero">{t('sett_hero_title')} <em>{t('sett_hero_title_em')}</em></h1>
     <p className="lede">{t('subtitle_settings')}</p>
    </div>
    <div className="row gap-2">
     {isDirty && <span className="tag amber">{t('hint_changes_detected')}</span>}
     <button className="btn btn-sm btn-ghost" onClick={handleCancel} disabled={!isDirty}>{t('sett_discard')}</button>
     <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || !isDirty}>{saving ? '...' : t('btn_save_config')}</button>
    </div>
   </div>

   <div className="layout">
    <nav className="sec-nav">
     <a className={activeSection === 0 ? 'on' : ''} onClick={() => document.getElementById('set-01')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">01</span>{t('sett_sidebar_api')}</a>
     <a className={activeSection === 1 ? 'on' : ''} onClick={() => document.getElementById('set-02')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">02</span>{t('sett_sidebar_models')}</a>
     <a className={activeSection === 2 ? 'on' : ''} onClick={() => document.getElementById('set-03')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">03</span>{t('sett_sidebar_network')}</a>
     <a className={activeSection === 3 ? 'on' : ''} onClick={() => document.getElementById('set-04')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">04</span>{t('sett_sidebar_env')}</a>
     <a className={activeSection === 4 ? 'on' : ''} onClick={() => document.getElementById('set-05')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">05</span>{t('sett_sidebar_prefs')}</a>
     <a className={activeSection === 5 ? 'on' : ''} onClick={() => document.getElementById('set-06')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">06</span>{t('sett_sidebar_hub')}</a>
     <a className={activeSection === 6 ? 'on' : ''} onClick={() => document.getElementById('set-07')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">07</span>{t('sett_section_security')}</a>
     <a className={activeSection === 7 ? 'on' : ''} onClick={() => document.getElementById('set-08')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">08</span>{t('sett_section_plugins')}</a>
     <a className={activeSection === 8 ? 'on' : ''} onClick={() => document.getElementById('set-09')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">09</span>{t('sett_section_backups')}</a>
     <a className={activeSection === 9 ? 'on' : ''} onClick={() => document.getElementById('set-10')?.scrollIntoView({ behavior: 'smooth' })}><span className="num">10</span>{t('sett_section_about')}</a>
    </nav>

    <div>
     {/* ─── 01 API & Credentials ─── */}
     <ApiSection form={form} set={set} saved={saved} />

     {/* ─── 02 Model mapping ─── */}
     <ModelSection form={form} set={set} modelOptions={modelOptions} />

     {/* ─── 03 Network & limits ─── */}
     <NetworkSection form={form} set={set} errors={errors} />

     {/* ─── 04 Environment ─── */}
     <EnvironmentSection form={form} set={set} errors={errors} />

     {/* ─── 05 Preferences ─── */}
     <PreferencesSection form={form} set={set} theme={theme} setTheme={setTheme} accentHue={accentHue} setAccentHue={setAccentHue} />

     {/* ─── 06 Hub Sync ─── */}
     <HubSection hubEnabled={hubEnabled} setHubEnabled={setHubEnabled} hubUrl={hubUrl} setHubUrl={setHubUrl} hubSecret={hubSecret} setHubSecret={setHubSecret} hubDeviceName={hubDeviceName} setHubDeviceName={setHubDeviceName} hubInterval={hubInterval} setHubInterval={setHubInterval} />

     {/* ─── 07 Security ─── */}
     <SecuritySection form={form} set={set} />

     {/* ─── 08 Plugins ─── */}
     <PluginsSection form={form} set={set} />

     {/* ─── 09 Backups ─── */}
     <BackupsSection />

     {/* ─── 10 About ─── */}
     <AboutSection />
    </div>
   </div>

   {/* Raw JSON Editor is now in AboutSection */}
  </div>
     )
}
