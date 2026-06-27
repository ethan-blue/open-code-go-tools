/** Shared types for SettingsPage sub-sections */

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
