/** Shared types across config/providers/clients pages. */

export type AgentLine = 'claude' | 'codex'
// 'custom' is a UI-only sentinel for the provider form (user-entered protocol);
// real upstreams use one of the concrete values.
export type ProviderProtocol = 'anthropic' | 'openai-responses' | 'openai-chat' | 'custom'

/** One credential in a provider's account pool (matches Go `providers.Account`). */
export interface ProviderAccount {
  id: string
  label?: string
  apiKey: string
  quotaCookie?: string
  quotaWorkspaceId?: string
  disabled?: boolean
}

/** Upstream API provider (matches Go `internal/providers.Provider` struct). */
export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  accounts?: ProviderAccount[]
  models: string[]
  defaultModel?: string
  messageModels?: string[]
  fallbackChain?: string[]
  enabled: boolean
  createdAt: number
  sortIndex?: number
  line: AgentLine
  protocol: ProviderProtocol
  requestTimeoutSeconds?: number
  thinkingBudgetTokens?: number
  authMode?: string
  modelAliases?: Record<string, string>
  modelProtocols?: Partial<Record<string, ProviderProtocol>>
  headers?: Record<string, string>
  env?: Record<string, string>
}

export interface ProviderFormData {
  name: string
  baseUrl: string
  apiKey: string
  accounts: ProviderAccount[]
  models: string[]
  messageModelsText: string
  fallbackChainText: string
  defaultModel: string
  enabled: boolean
  line: AgentLine
  protocol: ProviderProtocol
  requestTimeoutSeconds: string
  thinkingBudgetTokens: string
  authMode: string
  modelAliasesJSON: string
  modelProtocols: Partial<Record<string, ProviderProtocol>>
  headersJSON: string
  envJSON: string
}

export const DEFAULT_PROVIDER_FORM: ProviderFormData = {
  name: '',
  baseUrl: '',
  apiKey: '',
  accounts: [],
  models: [],
  messageModelsText: '',
  fallbackChainText: '',
  defaultModel: '',
  enabled: true,
  line: 'claude',
  protocol: 'anthropic',
  requestTimeoutSeconds: '',
  thinkingBudgetTokens: '-1',
  authMode: 'bearer',
  modelAliasesJSON: '{}',
  modelProtocols: {},
  headersJSON: '{}',
  envJSON: '{}',
}

// ── Shared API response types (Dashboard, TrafficMonitor, etc.) ──

export interface ProviderStatus {
  id: string
  name: string
  line: string
  base_url: string
  default_model: string
  protocol: string
  enabled: boolean
  api_key_configured: boolean
}

export interface StatusData {
  listen: string
  upstream: string
  default_model: string
  uptime_seconds: number
  request_timeout_seconds: number
  api_key_configured: boolean
  rate_limit_per_second: number
  rate_limit_burst: number
  rate_limit_per_minute: number
  providers?: {
    claude?: ProviderStatus
    codex?: ProviderStatus
  }
}

export interface SummaryTotals {
  total_requests: number
  success_count: number
  success_rate: number
  avg_latency_ms: number
  p50_latency_ms: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_create_tokens: number
  total_tokens: number
  estimated_cost: number
  cache_hit_rate: number
}

export interface ClientStat { name: string; requests: number; pct: number; p50_latency_ms?: number; p95_latency_ms?: number }

export interface StatsSummary {
  period: { from: string; to: string; days: number }
  summary: SummaryTotals
  by_client: ClientStat[]
}

export interface TrendData {
  daily: { date: string; total_tokens: number; input_tokens: number; output_tokens: number; requests: number }[]
  granularity: string
}

export interface ModelStats {
  name: string
  requests: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  cache_hit_rate: number
  cost_usd: number
  pct: number
}

export interface ModelsData {
  models: ModelStats[]
}

export interface HistoryEntry {
  id: string
  time: string
  method: string
  path: string
  status: number
  duration: string
  model: string
  route: string
  client?: string
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  error?: string
}

export interface QuotaData {
  success: boolean
  data?: {
    rolling: { usage_percent: number; reset_display: string }
    weekly: { usage_percent: number; reset_display: string }
    monthly?: { usage_percent: number; reset_display: string }
  }
}

// ── Account rotation (multi-account failover) ──

export interface RotationAccountStatus {
  id: string
  label?: string
  masked_key: string
  disabled?: boolean
  state: 'ready' | 'cooldown' | 'disabled'
  cooldown_remaining_ms?: number
  consecutive_failures?: number
  requests: number
  failures: number
  last_error?: string
  active: boolean
  has_quota_cookie: boolean
}

export interface RotationProviderStatus {
  provider_id: string
  provider_name: string
  line: string
  enabled: boolean
  accounts: RotationAccountStatus[]
}

export interface AccountQuotaResult {
  account_id: string
  label?: string
  success: boolean
  error?: string
  data?: {
    rolling: { usage_percent: number; reset_display: string }
    weekly: { usage_percent: number; reset_display: string }
    monthly?: { usage_percent: number; reset_display: string }
  }
}
