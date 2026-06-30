import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, AlertTriangle, Zap, Shield, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { apiGet, apiFetch } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { EmptyState, Skeleton } from '@/components/ui'
import type { Provider, AgentLine, ProviderProtocol, ProviderFormData } from '@/lib/types'
import { DEFAULT_PROVIDER_FORM } from '@/lib/types'

const LINE_COLORS: Record<AgentLine, string> = { claude: '#d97706', codex: '#16a34a' }
const PROTOCOL_OPTIONS: Record<AgentLine, { value: ProviderProtocol; label: string }[]> = {
  claude: [
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai-chat', label: 'OpenAI Chat' },
    { value: 'custom', label: 'Custom' },
  ],
  codex: [
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'openai-chat', label: 'OpenAI Chat' },
    { value: 'custom', label: 'Custom' },
  ],
}
const AUTH_MODE_OPTIONS = [
  { value: 'bearer', label: 'Bearer' },
  { value: 'x-api-key', label: 'X-Api-Key' },
  { value: 'both', label: 'Both' },
]

type FormData = ProviderFormData

function defaultProtocol(line: AgentLine): ProviderProtocol {
  return line === 'codex' ? 'openai-responses' : 'anthropic'
}

function jsonText(value: unknown): string {
  return JSON.stringify(value && typeof value === 'object' ? value : {}, null, 2)
}

function csvText(values: string[] | undefined): string {
  return (values || []).join(', ')
}

function parseStringMap(raw: string, field: string): Record<string, string> {
  const parsed = JSON.parse(raw || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${field} must be an object`)
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`${field} values must be strings`)
    }
    out[key] = value
  }
  return out
}

function parseStringList(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function parseEnvMap(raw: string): Record<string, string> {
  try {
    return parseStringMap(raw, 'env')
  } catch {
    return {}
  }
}

function updateEnvValue(raw: string, key: string, value: string | null): string {
  const next = parseEnvMap(raw)
  if (value === null || value === '') {
    delete next[key]
  } else {
    next[key] = value
  }
  return JSON.stringify(next, null, 2)
}

function toForm(provider: Provider): FormData {
  const line = (provider.line || 'claude') as AgentLine
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    models: provider.models || [],
    messageModelsText: csvText(provider.messageModels),
    fallbackChainText: csvText(provider.fallbackChain),
    defaultModel: provider.defaultModel || '',
    priority: provider.priority,
    enabled: provider.enabled,
    line,
    protocol: (provider.protocol || defaultProtocol(line)) as ProviderProtocol,
    rateLimitPerSecond: String(provider.rateLimitPerSecond || ''),
    rateLimitBurst: String(provider.rateLimitBurst || ''),
    requestTimeoutSeconds: String(provider.requestTimeoutSeconds || ''),
    thinkingBudgetTokens: String(provider.thinkingBudgetTokens || ''),
    authMode: provider.authMode || 'bearer',
    modelAliasesJSON: jsonText(provider.modelAliases),
    headersJSON: jsonText(provider.headers),
    envJSON: jsonText(provider.env),
  }
}

function ProviderEditor({
  form,
  setForm,
  onSave,
  onCancel,
}: {
  form: FormData
  setForm: Dispatch<SetStateAction<FormData>>
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const isClaude = form.line === 'claude'
  const lineLabel = isClaude ? 'Claude' : 'Codex'
  const runtimeCopy = isClaude
    ? {
        modelLabel: '模型映射',
        modelDesc: '当前 Claude 供应商专用的别名映射，例如 sonnet -> claude-sonnet-4-5。',
        envLabel: 'Env / Runtime',
        envDesc: '这个供应商生效时，Claude Code 会应用这里的运行时覆盖。',
        messageLabel: '消息模型链',
        messageDesc: '按顺序填写 Claude message routing 可用模型。',
        fallbackDesc: '请求失败时按顺序重试的模型链（逗号分隔）。',
        thinkingLabel: '思考预算',
      }
    : {
        modelLabel: '模型映射',
        modelDesc: '当前 Codex 供应商使用的别名映射，适合兼容客户端发来的简写模型名。',
        envLabel: '运行说明',
        envDesc: 'Codex 只使用上面的协议、鉴权、默认模型和 Header，不额外注入 env。',
        messageLabel: '响应模型链',
        messageDesc: '可选的 Codex fallback / compatibility 模型顺序。',
        fallbackDesc: '请求失败时按顺序重试的模型链（逗号分隔）。',
        thinkingLabel: '推理预算',
      }

  return (
    <div className="prov-inline-editor">
      <div className="prov-editor-section">
        <div className="prov-editor-section-head">
          <div>
            <h4>{lineLabel} Connection</h4>
            <p>下面的配置只属于当前线路。切换 Claude 不会改 Codex，反过来也一样。</p>
          </div>
        </div>
        <div className="prov-editor-grid">
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-name">{t('prov_form_name')}</label>
            <input id="provider-name" className="input prov-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('prov_name_placeholder')} />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-base-url">{t('prov_base_url')}</label>
            <input id="provider-base-url" className="input prov-input" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder={t('prov_url_placeholder')} />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-api-key">{t('prov_api_key_label')}</label>
            <input id="provider-api-key" className="input prov-input" type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="sk-..." />
          </div>
          <div className="field">
            <label className="prov-form-label">Line</label>
            <div className="segmented">
              <button className={form.line === 'claude' ? 'on' : ''} type="button" onClick={() => setForm(f => ({ ...f, line: 'claude', protocol: defaultProtocol('claude') }))}>Claude</button>
              <button className={form.line === 'codex' ? 'on' : ''} type="button" onClick={() => setForm(f => ({ ...f, line: 'codex', protocol: defaultProtocol('codex') }))}>Codex</button>
            </div>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-protocol">Protocol</label>
            <select id="provider-protocol" className="select prov-input" value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value as ProviderProtocol }))}>
              {PROTOCOL_OPTIONS[form.line].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-auth-mode">Auth Mode</label>
            <select id="provider-auth-mode" className="select prov-input" value={form.authMode} onChange={e => setForm(f => ({ ...f, authMode: e.target.value }))}>
              {AUTH_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-default-model">Default Model</label>
            <input id="provider-default-model" className="input prov-input" value={form.defaultModel} onChange={e => setForm(f => ({ ...f, defaultModel: e.target.value }))} placeholder="model id" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-message-models">{runtimeCopy.messageLabel}</label>
            <input
              id="provider-message-models"
              className="input prov-input"
              value={form.messageModelsText}
              onChange={e => setForm(f => ({ ...f, messageModelsText: e.target.value }))}
              placeholder="model-a, model-b"
            />
            <div className="prov-field-hint">{runtimeCopy.messageDesc}</div>
          </div>
        </div>
      </div>

      <div className="prov-editor-section">
        <div className="prov-editor-section-head">
          <div>
            <h4>{lineLabel} Runtime</h4>
            <p>模型、超时、思考强度和限流，都跟着当前生效供应商走。</p>
          </div>
        </div>
        <div className="prov-editor-grid">
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-timeout">Request Timeout (s)</label>
            <input id="provider-timeout" className="input prov-input" type="number" min="1" value={form.requestTimeoutSeconds} onChange={e => setForm(f => ({ ...f, requestTimeoutSeconds: e.target.value }))} placeholder="300" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-thinking">{runtimeCopy.thinkingLabel}</label>
            <input id="provider-thinking" className="input prov-input" type="number" min="-1" value={form.thinkingBudgetTokens} onChange={e => setForm(f => ({ ...f, thinkingBudgetTokens: e.target.value }))} placeholder="2048" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-rate-limit">Rate Limit /s</label>
            <input id="provider-rate-limit" className="input prov-input" type="number" min="0" value={form.rateLimitPerSecond} onChange={e => setForm(f => ({ ...f, rateLimitPerSecond: e.target.value }))} placeholder="0 = unlimited" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-burst">Burst</label>
            <input id="provider-burst" className="input prov-input" type="number" min="0" value={form.rateLimitBurst} onChange={e => setForm(f => ({ ...f, rateLimitBurst: e.target.value }))} placeholder="0" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-fallback">Fallback Chain</label>
            <input id="provider-fallback" className="input prov-input" value={form.fallbackChainText} onChange={e => setForm(f => ({ ...f, fallbackChainText: e.target.value }))} placeholder="model-a, model-b" />
            <div className="prov-field-hint">{runtimeCopy.fallbackDesc}</div>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-priority">{t('prov_priority_hint')}</label>
            <input id="provider-priority" className="input prov-input" type="number" min="0" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))} />
          </div>
          <label className="prov-editor-check">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            <span>{t('prov_enabled_label')}</span>
          </label>
        </div>
      </div>

      <div className="prov-editor-section">
        <div className="prov-editor-section-head">
          <div>
            <h4>{lineLabel} Advanced</h4>
            <p>只有当前启用供应商的映射、Header 和运行时参数会被应用。</p>
          </div>
        </div>
        <div className="set-card">
          <div className="set-row">
            <div className="label">
              <b>{runtimeCopy.modelLabel}</b>
              <p>{runtimeCopy.modelDesc}</p>
            </div>
            <div className="control">
              <textarea className="settings-env-key" value={form.modelAliasesJSON} onChange={e => setForm(f => ({ ...f, modelAliasesJSON: e.target.value }))} rows={6} />
            </div>
          </div>
          <div className="set-row">
            <div className="label">
              <b>Headers</b>
              <p>Extra upstream headers for this provider.</p>
            </div>
            <div className="control">
              <textarea className="settings-env-key" value={form.headersJSON} onChange={e => setForm(f => ({ ...f, headersJSON: e.target.value }))} rows={4} />
            </div>
          </div>
          {isClaude ? (
            <>
              <div className="set-row">
                <div className="label">
                  <b>Claude 常用开关</b>
                  <p>把最常改的开关直接露出来，其他高级项继续保留在下面的 JSON 里。</p>
                </div>
                <div className="control">
                  <div className="prov-quick-grid">
                    <label className="prov-editor-check">
                      <input
                        type="checkbox"
                        checked={parseEnvMap(form.envJSON).ENABLE_TOOL_SEARCH === 'true'}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'ENABLE_TOOL_SEARCH', e.target.checked ? 'true' : null) }))}
                      />
                      <span>启用 Tool Search</span>
                    </label>
                    <label className="prov-editor-check">
                      <input
                        type="checkbox"
                        checked={parseEnvMap(form.envJSON).CLAUDE_CODE_DISABLE_THINKING === '1'}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'CLAUDE_CODE_DISABLE_THINKING', e.target.checked ? '1' : null) }))}
                      />
                      <span>禁用 Thinking</span>
                    </label>
                    <label className="prov-editor-check">
                      <input
                        type="checkbox"
                        checked={parseEnvMap(form.envJSON).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1'}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', e.target.checked ? '1' : null) }))}
                      />
                      <span>禁用非必要流量</span>
                    </label>
                    <label className="prov-editor-check">
                      <input
                        type="checkbox"
                        checked={parseEnvMap(form.envJSON).CLAUDE_CODE_ATTRIBUTION_HEADER === '0'}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'CLAUDE_CODE_ATTRIBUTION_HEADER', e.target.checked ? '0' : null) }))}
                      />
                      <span>禁用 Attribution</span>
                    </label>
                  </div>
                  <div className="prov-editor-grid">
                    <div className="field">
                      <label className="prov-form-label" htmlFor="claude-max-output">最大输出 Token</label>
                      <input
                        id="claude-max-output"
                        className="input prov-input"
                        value={parseEnvMap(form.envJSON).CLAUDE_CODE_MAX_OUTPUT_TOKENS || ''}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', e.target.value.trim() || null) }))}
                        placeholder="131072"
                      />
                    </div>
                    <div className="field">
                      <label className="prov-form-label" htmlFor="claude-api-timeout">API 超时 (ms)</label>
                      <input
                        id="claude-api-timeout"
                        className="input prov-input"
                        value={parseEnvMap(form.envJSON).API_TIMEOUT_MS || ''}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'API_TIMEOUT_MS', e.target.value.trim() || null) }))}
                        placeholder="600000"
                      />
                    </div>
                    <div className="field">
                      <label className="prov-form-label" htmlFor="claude-mcp-timeout">MCP 超时 (ms)</label>
                      <input
                        id="claude-mcp-timeout"
                        className="input prov-input"
                        value={parseEnvMap(form.envJSON).MCP_TIMEOUT || ''}
                        onChange={e => setForm(f => ({ ...f, envJSON: updateEnvValue(f.envJSON, 'MCP_TIMEOUT', e.target.value.trim() || null) }))}
                        placeholder="600000"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="set-row">
                <div className="label">
                  <b>{runtimeCopy.envLabel}</b>
                  <p>{runtimeCopy.envDesc}</p>
                </div>
                <div className="control">
                  <textarea className="settings-env-key" value={form.envJSON} onChange={e => setForm(f => ({ ...f, envJSON: e.target.value }))} rows={8} />
                </div>
              </div>
            </>
          ) : (
            <div className="set-row">
              <div className="label">
                <b>{runtimeCopy.envLabel}</b>
                <p>{runtimeCopy.envDesc}</p>
              </div>
              <div className="control">
                <div className="prov-runtime-note">
                  Codex 默认优先 `openai-responses`。只有当上游或客户端还锁在 chat completions 时，才退回 `openai-chat`。
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="prov-editor-actions">
        <button className="btn btn-ghost" onClick={onCancel}>{t('prov_form_cancel')}</button>
        <button className="btn btn-primary" onClick={onSave}>{t('prov_form_save')}</button>
      </div>
    </div>
  )
}

function SortableProviderCard({
  provider,
  expanded,
  form,
  setForm,
  onToggleExpand,
  onDelete,
  onActivate,
  onSave,
  onCancel,
}: {
  provider: Provider
  expanded: boolean
  form: FormData
  setForm: Dispatch<SetStateAction<FormData>>
  onToggleExpand: (provider: Provider) => void
  onDelete: (id: string) => void
  onActivate: (id: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: provider.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 10px 40px rgba(0,0,0,0.15)' : undefined,
    zIndex: isDragging ? 10 : undefined,
    borderLeft: `3px solid ${LINE_COLORS[(provider.line || 'claude') as AgentLine]}`,
  }
  const healthConfig = {
    healthy: { icon: Zap, color: 'var(--online)', bg: 'var(--green-soft)', label: 'Healthy' },
    degraded: { icon: AlertTriangle, color: 'var(--warn)', bg: 'rgba(245,158,11,0.1)', label: 'Degraded' },
    down: { icon: Shield, color: 'var(--danger)', bg: 'rgba(239,68,68,0.1)', label: 'Down' },
    unknown: { icon: Shield, color: 'var(--ink-400)', bg: 'var(--ink-100)', label: 'Unknown' },
  }
  const health = healthConfig[provider.health] || healthConfig.unknown
  const HealthIcon = health.icon

  return (
    <div ref={setNodeRef} className="prov-card" style={style}>
      <div className={provider.enabled ? 'prov-row' : 'prov-row disabled'} style={{ border: 'none', borderRadius: 0, padding: '12px 14px' }}>
        <button className="prov-drag-handle" {...attributes} {...listeners}><GripVertical width={16} height={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="prov-chip-row">
            <span className="prov-name">{provider.name}</span>
            <span className="tag" style={{ background: LINE_COLORS[(provider.line || 'claude') as AgentLine], color: '#fff', fontSize: 10, padding: '1px 6px' }}>{provider.line || 'claude'}</span>
            <span className="prov-health-badge" style={{ background: health.bg, color: health.color }}><HealthIcon width={12} height={12} /> {health.label}</span>
            {provider.enabled && <span className="tag green" style={{ fontSize: 10 }}>当前</span>}
          </div>
          <div className="prov-meta">{provider.baseUrl}</div>
          <div className="prov-stats">
            <span className="prov-stat-item"><Clock width={12} height={12} /> {provider.avgLatency}ms</span>
            <span>{provider.requestCount.toLocaleString()} requests</span>
            <span className={provider.errorCount > 0 ? 'text-danger' : undefined}>{provider.errorCount} errors</span>
            {provider.protocol && <span className="tag" style={{ fontSize: 10 }}>{provider.protocol}</span>}
            {provider.defaultModel ? <span className="tag" style={{ fontSize: 10 }}>{provider.defaultModel}</span> : null}
          </div>
        </div>
        <div className="prov-row-controls">
          <span className="prov-priority">P{provider.priority}</span>
          <button className={provider.enabled ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'} onClick={() => onActivate(provider.id)} disabled={provider.enabled}>
            {provider.enabled ? '当前' : '启用'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onToggleExpand(provider)}>
            {expanded ? <ChevronUp width={14} height={14} /> : <ChevronDown width={14} height={14} />}
            {expanded ? '收起' : '编辑'}
          </button>
          <button className="prov-icon-btn red" onClick={() => onDelete(provider.id)}><Trash2 width={16} height={16} /></button>
        </div>
      </div>
      {expanded ? <ProviderEditor form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} /> : null}
    </div>
  )
}

export default function Providers() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<Provider[]>([])
  const [loadError, setLoadError] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormData>(DEFAULT_PROVIDER_FORM)
  const [lineFilter, setLineFilter] = useState<AgentLine>('claude')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true)
      const data = await apiGet<{ providers: Provider[] }>('/ocgt/api/providers')
      if (data?.providers) {
        setProviders(data.providers.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0)))
      }
      setLoadError(false)
    } catch {
      setLoadError(true)
      toast(t('prov_load_failed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => { loadProviders() }, [loadProviders])

  const closeEditor = useCallback(() => {
    setEditingId(null)
    setCreating(false)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = providers.findIndex(p => p.id === active.id)
    const newIndex = providers.findIndex(p => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(providers, oldIndex, newIndex)
    setProviders(reordered)
    try {
      await apiFetch('/ocgt/api/providers/sort', { method: 'POST', body: JSON.stringify({ ids: reordered.map(p => p.id) }) })
      toast(t('prov_order_saved'), 'success')
    } catch {
      toast(t('prov_order_fail'), 'error')
      loadProviders()
    }
  }, [providers, loadProviders, toast, t])

  const handleAdd = useCallback(() => {
    setEditingId(null)
    setCreating(true)
    setForm({ ...DEFAULT_PROVIDER_FORM, line: lineFilter, protocol: defaultProtocol(lineFilter) })
  }, [lineFilter])

  const handleToggleExpand = useCallback((provider: Provider) => {
    if (editingId === provider.id) {
      closeEditor()
      return
    }
    setCreating(false)
    setEditingId(provider.id)
    setForm(toForm(provider))
  }, [editingId, closeEditor])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t('prov_confirm_delete'))) return
    try {
      await apiFetch(`/ocgt/api/providers/${id}`, { method: 'DELETE' })
      setProviders(prev => prev.filter(p => p.id !== id))
      if (editingId === id) closeEditor()
      toast(t('prov_deleted'), 'success')
    } catch {
      toast(t('prov_delete_fail'), 'error')
    }
  }, [closeEditor, editingId, t, toast])

  const handleActivate = useCallback(async (id: string) => {
    const provider = providers.find(p => p.id === id)
    if (!provider) return
    const line = provider.line || 'claude'
    try {
      await apiFetch(`/ocgt/api/providers/${id}/toggle`, { method: 'PATCH' })
      setProviders(prev => prev.map(p => (p.line || 'claude') === line ? { ...p, enabled: p.id === id } : p))
      if (editingId === id) {
        setForm(current => ({ ...current, enabled: true }))
      }
      toast(t('prov_enabled'), 'success')
    } catch {
      toast(t('prov_toggle_fail'), 'error')
    }
  }, [editingId, providers, t, toast])

  const handleSave = useCallback(async () => {
    if (!form.name || !form.baseUrl) {
      toast(t('prov_name_url_required'), 'error')
      return
    }
    let body: Record<string, unknown>
    try {
      body = {
        ...form,
        messageModels: parseStringList(form.messageModelsText),
        fallbackChain: parseStringList(form.fallbackChainText),
        rateLimitPerSecond: form.rateLimitPerSecond ? parseInt(form.rateLimitPerSecond, 10) : 0,
        rateLimitBurst: form.rateLimitBurst ? parseInt(form.rateLimitBurst, 10) : 0,
        requestTimeoutSeconds: form.requestTimeoutSeconds ? parseInt(form.requestTimeoutSeconds, 10) : 0,
        thinkingBudgetTokens: form.thinkingBudgetTokens ? parseInt(form.thinkingBudgetTokens, 10) : 0,
        modelAliases: parseStringMap(form.modelAliasesJSON, 'modelAliases'),
        headers: parseStringMap(form.headersJSON, 'headers'),
        env: parseStringMap(form.envJSON, 'env'),
      }
      delete body.modelAliasesJSON
      delete body.headersJSON
      delete body.envJSON
      delete body.messageModelsText
      delete body.fallbackChainText
    } catch (error) {
      toast(error instanceof Error ? error.message : t('toast_save_failed'), 'error')
      return
    }
    try {
      if (editingId) {
        await apiFetch(`/ocgt/api/providers/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        toast(t('prov_updated'), 'success')
      } else {
        await apiFetch('/ocgt/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sortIndex: providers.length }) })
        toast(t('prov_added'), 'success')
      }
      closeEditor()
      loadProviders()
    } catch {
      toast(t('prov_save_fail'), 'error')
    }
  }, [closeEditor, editingId, form, loadProviders, providers.length, t, toast])

  const filteredProviders = providers.filter(p => (p.line || 'claude') === lineFilter)
  const activeProvider = filteredProviders.find(p => p.enabled)

  return (
    <div className="providers-page">
      <div className="prov-header">
        <div>
          <h2 className="prov-header-title">{t('prov_title')}</h2>
          <p className="prov-header-sub">Claude / Codex 各自维护当前生效供应商，不再额外引入配置集。</p>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}><Plus width={16} height={16} className="prov-add-icon-gap" />{t('prov_add')}</button>
      </div>

      <div className="segmented prov-filter-gap">
        <button className={lineFilter === 'claude' ? 'on' : ''} onClick={() => setLineFilter('claude')}>Claude</button>
        <button className={lineFilter === 'codex' ? 'on' : ''} onClick={() => setLineFilter('codex')}>Codex</button>
      </div>

      <section className="set-section">
        <div className="head">
          <div>
            <h3>{lineFilter === 'claude' ? 'Claude 当前供应商' : 'Codex 当前供应商'}</h3>
            <div className="sub">
              {activeProvider ? `${activeProvider.name} 正在承载当前 ${lineFilter} 线路。` : `当前还没有启用 ${lineFilter} 供应商。`}
            </div>
          </div>
        </div>
      </section>

      {creating ? <div className="prov-card prov-card-new"><ProviderEditor form={form} setForm={setForm} onSave={handleSave} onCancel={closeEditor} /></div> : null}

      {loading ? (
        <div className="prov-flex-col" style={{ gap: 12, padding: '16px 0' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="prov-row prov-skeleton-row">
              <Skeleton style={{ width: 20, height: 20 }} />
              <div className="prov-skeleton-col">
                <Skeleton style={{ width: '50%', height: 14 }} />
                <Skeleton style={{ width: '70%', height: 10 }} />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <EmptyState icon={<Zap width={28} height={28} />} title={t('td_load_failed')} description={t('prov_load_failed')} action={<button className="btn btn-outline" onClick={loadProviders} style={{ marginTop: 8 }}>{t('retry')}</button>} />
      ) : filteredProviders.length === 0 && !creating ? (
        <EmptyState icon={<Zap width={28} height={28} />} title={t('prov_no_providers')} description="Create the first provider for this line." action={<button className="btn btn-outline" onClick={handleAdd} style={{ marginTop: 8 }}>{t('prov_add_first')}</button>} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filteredProviders.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <div className="prov-list">
              {filteredProviders.map(provider => (
                <SortableProviderCard
                  key={provider.id}
                  provider={provider}
                  expanded={editingId === provider.id}
                  form={form}
                  setForm={setForm}
                  onToggleExpand={handleToggleExpand}
                  onDelete={handleDelete}
                  onActivate={handleActivate}
                  onSave={handleSave}
                  onCancel={closeEditor}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
