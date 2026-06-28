/** Shared types for OCGT settings and providers */

// ─── Product Lines ───
export type AgentLine = 'claude' | 'codex'

// ─── Provider Protocols ───
export type ProviderProtocol = 'anthropic' | 'openai-responses' | 'openai-chat' | 'custom'

// ─── Provider (upstream API provider, single source of truth) ───
export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  priority: number
  enabled: boolean
  health: 'healthy' | 'degraded' | 'down'
  lastCheck: string
  requestCount: number
  errorCount: number
  avgLatency: number
  createdAt: number
  sortIndex?: number
  line?: AgentLine
  protocol?: ProviderProtocol
  rateLimitPerSecond?: number
  rateLimitBurst?: number
}

export interface ProviderFormData {
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  priority: number
  enabled: boolean
  line: AgentLine
  protocol: ProviderProtocol
  rateLimitPerSecond: string
  rateLimitBurst: string
}

// ─── L3: ProfileConfig (tied to a profile, travels with it) ───
export interface ModelAliases {
  defaultModel: string
  customDefaultModel: string
  [key: string]: string
}

export interface ClaudeAliases extends ModelAliases {
  sonnet: string
  customSonnet: string
  haiku: string
  customHaiku: string
  opus: string
  customOpus: string
}

export interface CodexAliases extends ModelAliases {
  gpt5Mini: string
  customGpt5Mini: string
  reasoning: string
  customReasoning: string
}

export interface ProfileConfig {
  profile: string
  apiKey: string
  upstream: string
  listenAddr: string
  timeoutSeconds: string
  thinkingBudgetTokens: string
  modelMapping: {
    claude: ClaudeAliases
    codex: CodexAliases
  }
  runtimeRules: {
    claudeEnvJSON: string
    disableNonessential: boolean
    enableToolSearch: boolean
    disableAttribution: boolean
    disableThinking: boolean
    maxOutputTokens: string
    maxMCPTokens: string
    apiTimeout: string
    mcpTimeout: string
  }
  security: {
    authEnabled: boolean
    rateLimitingEnabled: boolean
    rateLimitPerSecond: string
    rateLimitBurst: string
    rateLimitPerMinute: string
  }
  plugins: Record<string, boolean>
  hub: {
    enabled: boolean
    url: string
    secret: string
    deviceName: string
    interval: string
  }
}

// ─── L4: AppPreferences (tied to this machine, not to a profile) ───
export interface AppPreferences {
  theme: 'light' | 'dark' | 'system'
  accentHue: number
  language: 'zh' | 'en'
  closeBehavior: string
  logEnabled: boolean
  logDir: string
  logRetention: string
}

// ─── Legacy FormState (for backward compat during migration) ───
export interface FormState {
  profile: string
  apiKey: string
  defaultModel: string
  sonnetAlias: string
  haikuAlias: string
  opusAlias: string
  timeoutSeconds: string
  thinkingBudgetTokens: string
  listenAddr: string
  upstream: string
  rateLimitPerSecond: string
  rateLimitBurst: string
  rateLimitPerMinute: string
  claudeEnvJSON: string
  disableNonessential: boolean
  enableToolSearch: boolean
  disableAttribution: boolean
  disableThinking: boolean
  maxOutputTokens: string
  maxMCPTokens: string
  apiTimeout: string
  mcpTimeout: string
  closeBehavior: string
  logEnabled: boolean
  logDir: string
  logRetention: string
  customDefaultModel: string
  customSonnetAlias: string
  customHaikuAlias: string
  customOpusAlias: string
  plugins: Record<string, boolean>
  authEnabled: boolean
  rateLimitingEnabled: boolean
}

export type SetField = <K extends keyof FormState>(key: K, value: FormState[K]) => void
export type TFunc = (key: string) => string

export const DEFAULT_CLAUDE_ALIASES: ClaudeAliases = {
  defaultModel: '', customDefaultModel: '',
  sonnet: '', customSonnet: '',
  haiku: '', customHaiku: '',
  opus: '', customOpus: '',
}

export const DEFAULT_CODEX_ALIASES: CodexAliases = {
  defaultModel: '', customDefaultModel: '',
  gpt5Mini: '', customGpt5Mini: '',
  reasoning: '', customReasoning: '',
}

export const DEFAULT_APP_PREFS: AppPreferences = {
  theme: 'system',
  accentHue: 174,
  language: 'zh',
  closeBehavior: 'prompt',
  logEnabled: false,
  logDir: '',
  logRetention: '7',
}

export const DEFAULT_FORM: FormState = {
  profile: 'default',
  apiKey: '',
  defaultModel: '',
  sonnetAlias: '',
  haikuAlias: '',
  opusAlias: '',
  timeoutSeconds: '300',
  thinkingBudgetTokens: '0',
  listenAddr: '127.0.0.1:8787',
  upstream: '',
  rateLimitPerSecond: '0',
  rateLimitBurst: '0',
  rateLimitPerMinute: '0',
  claudeEnvJSON: '{}',
  disableNonessential: false,
  enableToolSearch: false,
  disableAttribution: false,
  disableThinking: false,
  maxOutputTokens: '',
  maxMCPTokens: '',
  apiTimeout: '',
  mcpTimeout: '',
  closeBehavior: 'prompt',
  logEnabled: false,
  logDir: '',
  logRetention: '7',
  customDefaultModel: '',
  customSonnetAlias: '',
  customHaikuAlias: '',
  customOpusAlias: '',
  plugins: {},
  authEnabled: false,
  rateLimitingEnabled: false,
}

export const DEFAULT_PROVIDER_FORM: ProviderFormData = {
  name: '',
  baseUrl: '',
  apiKey: '',
  models: [],
  priority: 0,
  enabled: true,
  line: 'claude',
  protocol: 'anthropic',
  rateLimitPerSecond: '',
  rateLimitBurst: '',
}

/** Map legacy flat FormState to ProfileConfig */
export function toProfileConfig(form: FormState, hub: { enabled: boolean; url: string; secret: string; deviceName: string; interval: string }): ProfileConfig {
  return {
    profile: form.profile,
    apiKey: form.apiKey,
    upstream: form.upstream,
    listenAddr: form.listenAddr,
    timeoutSeconds: form.timeoutSeconds,
    thinkingBudgetTokens: form.thinkingBudgetTokens,
    modelMapping: {
      claude: {
        defaultModel: form.defaultModel, customDefaultModel: form.customDefaultModel,
        sonnet: form.sonnetAlias, customSonnet: form.customSonnetAlias,
        haiku: form.haikuAlias, customHaiku: form.customHaikuAlias,
        opus: form.opusAlias, customOpus: form.customOpusAlias,
      },
      codex: { ...DEFAULT_CODEX_ALIASES },
    },
    runtimeRules: {
      claudeEnvJSON: form.claudeEnvJSON,
      disableNonessential: form.disableNonessential,
      enableToolSearch: form.enableToolSearch,
      disableAttribution: form.disableAttribution,
      disableThinking: form.disableThinking,
      maxOutputTokens: form.maxOutputTokens,
      maxMCPTokens: form.maxMCPTokens,
      apiTimeout: form.apiTimeout,
      mcpTimeout: form.mcpTimeout,
    },
    security: {
      authEnabled: form.authEnabled,
      rateLimitingEnabled: form.rateLimitingEnabled,
      rateLimitPerSecond: form.rateLimitPerSecond,
      rateLimitBurst: form.rateLimitBurst,
      rateLimitPerMinute: form.rateLimitPerMinute,
    },
    plugins: form.plugins,
    hub: { ...hub },
  }
}
