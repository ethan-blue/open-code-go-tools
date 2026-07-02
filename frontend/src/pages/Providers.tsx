import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
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

/** Best-effort JSON object parse — returns fallback on any error. */
function safeParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? parsed as T : fallback
  } catch {
    return fallback
  }
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
  const { toast } = useToast()
  const isClaude = form.line === 'claude'
  const lineLabel = isClaude ? 'Claude' : 'Codex'

  // The JSON preview reflects the advanced fields (modelAliases / headers / env
  // / messageModels / fallbackChain) as a single editable blob. It regenerates
  // from the form whenever the user hasn't manually overridden it.
  const advancedJSON = useMemo(() => JSON.stringify({
    modelAliases: safeParse(form.modelAliasesJSON, {}),
    headers: safeParse(form.headersJSON, {}),
    env: safeParse(form.envJSON, {}),
    messageModels: parseStringList(form.messageModelsText),
    fallbackChain: parseStringList(form.fallbackChainText),
  }, null, 2), [form.modelAliasesJSON, form.headersJSON, form.envJSON, form.messageModelsText, form.fallbackChainText])

  const [jsonText, setJsonText] = useState(advancedJSON)
  const jsonDirty = jsonText !== advancedJSON

  // Re-sync from the form when it changes (e.g. toggling a quick switch) and
  // the user hasn't manually edited the JSON area.
  useEffect(() => {
    if (!jsonDirty) setJsonText(advancedJSON)
  }, [advancedJSON, jsonDirty])

  const applyJSON = () => {
    try {
      const parsed = JSON.parse(jsonText)
      setForm(f => ({
        ...f,
        modelAliasesJSON: JSON.stringify(parsed.modelAliases && typeof parsed.modelAliases === 'object' ? parsed.modelAliases : {}, null, 2),
        headersJSON: JSON.stringify(parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : {}, null, 2),
        envJSON: JSON.stringify(parsed.env && typeof parsed.env === 'object' ? parsed.env : {}, null, 2),
        messageModelsText: Array.isArray(parsed.messageModels) ? parsed.messageModels.join(', ') : '',
        fallbackChainText: Array.isArray(parsed.fallbackChain) ? parsed.fallbackChain.join(', ') : '',
      }))
      toast(t('prov_json_applied'), 'success')
    } catch {
      toast(t('prov_json_invalid'), 'error')
    }
  }
  const runtimeCopy = isClaude
    ? {
        messageLabel: t('prov_rt_claude_message_label'),
        messageDesc: t('prov_rt_claude_message_desc'),
        fallbackDesc: t('prov_rt_fallback_desc'),
        thinkingLabel: t('prov_rt_claude_thinking_label'),
      }
    : {
        messageLabel: t('prov_rt_codex_message_label'),
        messageDesc: t('prov_rt_codex_message_desc'),
        fallbackDesc: t('prov_rt_fallback_desc'),
        thinkingLabel: t('prov_rt_codex_thinking_label'),
      }

  return (
    <div className="prov-inline-editor">
      <div className="prov-editor-section">
        <div className="prov-editor-section-head">
          <div>
            <h4>{t('prov_conn_title').replace('{{line}}', lineLabel)}</h4>
            <p>{t('prov_conn_desc')}</p>
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
            <label className="prov-form-label">{t('prov_field_line')}</label>
            <div className="segmented">
              <button className={form.line === 'claude' ? 'on' : ''} type="button" onClick={() => setForm(f => {
                // Only reset protocol if the current one isn't valid for the new
                // line — preserves a user's manual protocol choice when it carries over.
                const validForClaude = PROTOCOL_OPTIONS.claude.some(o => o.value === f.protocol)
                return { ...f, line: 'claude', protocol: validForClaude ? f.protocol : defaultProtocol('claude') }
              })}>Claude</button>
              <button className={form.line === 'codex' ? 'on' : ''} type="button" onClick={() => setForm(f => {
                const validForCodex = PROTOCOL_OPTIONS.codex.some(o => o.value === f.protocol)
                return { ...f, line: 'codex', protocol: validForCodex ? f.protocol : defaultProtocol('codex') }
              })}>Codex</button>
            </div>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-protocol">{t('prov_field_protocol')}</label>
            <select id="provider-protocol" className="select prov-input" value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value as ProviderProtocol }))}>
              {PROTOCOL_OPTIONS[form.line].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-auth-mode">{t('prov_field_auth_mode')}</label>
            <select id="provider-auth-mode" className="select prov-input" value={form.authMode} onChange={e => setForm(f => ({ ...f, authMode: e.target.value }))}>
              {AUTH_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-default-model">{t('prov_field_default_model')}</label>
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
            <h4>{t('prov_runtime_title').replace('{{line}}', lineLabel)}</h4>
            <p>{t('prov_runtime_desc')}</p>
          </div>
        </div>
        <div className="prov-editor-grid">
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-timeout">{t('prov_field_timeout')}</label>
            <input id="provider-timeout" className="input prov-input" type="number" min="1" value={form.requestTimeoutSeconds} onChange={e => setForm(f => ({ ...f, requestTimeoutSeconds: e.target.value }))} placeholder="300" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-thinking">{runtimeCopy.thinkingLabel}</label>
            <input id="provider-thinking" className="input prov-input" type="number" min="-1" value={form.thinkingBudgetTokens} onChange={e => setForm(f => ({ ...f, thinkingBudgetTokens: e.target.value }))} placeholder="2048" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-rate-limit">{t('prov_field_rate_limit')}</label>
            <input id="provider-rate-limit" className="input prov-input" type="number" min="0" value={form.rateLimitPerSecond} onChange={e => setForm(f => ({ ...f, rateLimitPerSecond: e.target.value }))} placeholder="0 = unlimited" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-burst">{t('prov_field_burst')}</label>
            <input id="provider-burst" className="input prov-input" type="number" min="0" value={form.rateLimitBurst} onChange={e => setForm(f => ({ ...f, rateLimitBurst: e.target.value }))} placeholder="0" />
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-fallback">{t('prov_field_fallback')}</label>
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
        <div className="prov-editor-section-head with-action">
          <div>
            <h4>{t('prov_json_section').replace('{{line}}', lineLabel)}</h4>
            <p>{t('prov_json_hint')}</p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={applyJSON} disabled={!jsonDirty}>
            {t('prov_json_apply')}
          </button>
        </div>
        <textarea
          className={`settings-env-key prov-json-area${jsonDirty ? ' prov-json-dirty' : ''}`}
          value={jsonText}
          onChange={e => setJsonText(e.target.value)}
          rows={16}
          spellCheck={false}
        />
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
    healthy: { icon: Zap, color: 'var(--online)', bg: 'var(--green-soft)', label: t('prov_health_healthy') },
    degraded: { icon: AlertTriangle, color: 'var(--warn)', bg: 'rgba(245,158,11,0.1)', label: t('prov_health_degraded') },
    down: { icon: Shield, color: 'var(--danger)', bg: 'rgba(239,68,68,0.1)', label: t('prov_health_down') },
    unknown: { icon: Shield, color: 'var(--ink-400)', bg: 'var(--ink-100)', label: t('prov_health_unknown') },
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
            {provider.enabled && <span className="tag green" style={{ fontSize: 10 }}>{t('prov_card_active_tag')}</span>}
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
            {provider.enabled ? t('prov_card_current') : t('prov_card_enable')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onToggleExpand(provider)}>
            {expanded ? <ChevronUp width={14} height={14} /> : <ChevronDown width={14} height={14} />}
            {expanded ? t('prov_card_collapse') : t('prov_card_edit')}
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
      toast(t('prov_enabled'), 'success')
      // Collapse the editor after activating so the card doesn't stay stuck open.
      closeEditor()
    } catch {
      toast(t('prov_toggle_fail'), 'error')
    }
  }, [closeEditor, providers, t, toast])

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
          <p className="prov-header-sub">{t('prov_page_subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}><Plus width={16} height={16} className="prov-add-icon-gap" />{t('prov_add')}</button>
      </div>

      <div className="segmented prov-filter-gap">
        <button className={lineFilter === 'claude' ? 'on' : ''} onClick={() => { setLineFilter('claude'); closeEditor() }}>Claude</button>
        <button className={lineFilter === 'codex' ? 'on' : ''} onClick={() => { setLineFilter('codex'); closeEditor() }}>Codex</button>
      </div>

      <section className="set-section">
        <div className="head">
          <div>
            <h3>{t('prov_current_provider_title').replace('{{line}}', lineFilter === 'claude' ? 'Claude' : 'Codex')}</h3>
            <div className="sub">
              {activeProvider
                ? t('prov_active_carrying').replace('{{name}}', activeProvider.name).replace('{{line}}', lineFilter)
                : t('prov_no_active_provider').replace('{{line}}', lineFilter)}
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
