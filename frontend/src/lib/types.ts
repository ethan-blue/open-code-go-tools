/** Shared types across config/providers/clients pages. */

export type AgentLine = 'claude' | 'codex'
// 'custom' is a UI-only sentinel for the provider form (user-entered protocol);
// real upstreams use one of the concrete values.
export type ProviderProtocol = 'anthropic' | 'openai-responses' | 'openai-chat' | 'custom'

/** Upstream API provider (matches Go `internal/providers.Provider` struct). */
export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  priority: number
  enabled: boolean
  health: 'healthy' | 'degraded' | 'down' | 'unknown'
  lastCheck?: string
  requestCount: number
  errorCount: number
  avgLatency: number
  createdAt: number
  sortIndex?: number
  // Product-line + protocol + per-provider rate limit (added in v4 refactor;
  // persisted via the Go Provider struct fields Line/Protocol/RateLimitPerSecond/RateLimitBurst)
  line: AgentLine
  protocol: ProviderProtocol
  rateLimitPerSecond: number
  rateLimitBurst: number
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
