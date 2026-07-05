import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, Zap, ChevronDown, ChevronUp, Users, RefreshCw, FlaskConical } from 'lucide-react'
import { apiGet, apiFetch } from '@/lib/wails'
import { errMessage } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { EmptyState, Skeleton } from '@/components/ui'
import { ModelDropdown } from '@/components/ModelDropdown'
import { ConfirmModal } from '@/components/ConfirmModal'
import { AccountPoolSection } from '@/pages/providers/AccountPoolSection'
import type { Provider, AgentLine, ProviderProtocol, ProviderFormData, RotationProviderStatus } from '@/lib/types'
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
    accounts: (provider.accounts || []).map(acc => ({ ...acc })),
    models: provider.models || [],
    messageModelsText: csvText(provider.messageModels),
    fallbackChainText: csvText(provider.fallbackChain),
    defaultModel: provider.defaultModel || '',
    enabled: provider.enabled,
    line,
    protocol: (provider.protocol || defaultProtocol(line)) as ProviderProtocol,
    requestTimeoutSeconds: String(provider.requestTimeoutSeconds || ''),
    thinkingBudgetTokens: String(provider.thinkingBudgetTokens == null || provider.thinkingBudgetTokens === 0 ? -1 : provider.thinkingBudgetTokens),
    authMode: provider.authMode || 'bearer',
    modelAliasesJSON: jsonText(provider.modelAliases),
    modelProtocols: provider.modelProtocols || {},
    headersJSON: jsonText(provider.headers),
    envJSON: jsonText(provider.env),
  }
}

function protocolLabel(protocol?: string) {
  // Only the Anthropic-native protocol is surfaced as a label on the
  // quick-switcher pill; other protocols stay unlabelled to reduce noise.
  if (protocol === 'anthropic') return 'Claude'
  return ''
}

function isOpenCodeGoProvider(form: FormData) {
  return /opencode\.ai\/zen\/go/i.test(form.baseUrl)
}

function ProviderEditor({
  form,
  setForm,
  onSave,
  onCancel,
  providerId,
  rotation,
}: {
  form: FormData
  setForm: Dispatch<SetStateAction<FormData>>
  onSave: () => void
  onCancel: () => void
  providerId: string | null
  rotation?: RotationProviderStatus
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const isClaude = form.line === 'claude'
  const lineLabel = isClaude ? 'Claude' : 'Codex'
  const openCodeGo = isOpenCodeGoProvider(form)
  const [syncingModels, setSyncingModels] = useState(false)
  const [syncCount, setSyncCount] = useState<number | null>(null)
  const [testingModel, setTestingModel] = useState(false)
  const [jsonTouched, setJsonTouched] = useState(false)

  // The JSON preview reflects the advanced fields (modelAliases / headers / env
  // / messageModels / fallbackChain) as a single editable blob. It regenerates
  // from the form whenever the user hasn't manually overridden it.
  const advancedJSON = useMemo(() => JSON.stringify({
    modelAliases: safeParse(form.modelAliasesJSON, {}),
    headers: safeParse(form.headersJSON, {}),
    env: safeParse(form.envJSON, {}),
    messageModels: parseStringList(form.messageModelsText),
    fallbackChain: parseStringList(form.fallbackChainText),
    modelProtocols: form.modelProtocols || {},
  }, null, 2), [form.modelAliasesJSON, form.headersJSON, form.envJSON, form.messageModelsText, form.fallbackChainText, form.modelProtocols])

  const [jsonText, setJsonText] = useState(advancedJSON)
  const jsonDirty = jsonTouched && jsonText !== advancedJSON

  // Re-sync from the form when it changes (e.g. toggling a quick switch) and
  // the user hasn't manually edited the JSON area.
  useEffect(() => {
    if (!jsonTouched) setJsonText(advancedJSON)
  }, [advancedJSON, jsonTouched])

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
        modelProtocols: parsed.modelProtocols && typeof parsed.modelProtocols === 'object' && !Array.isArray(parsed.modelProtocols) ? parsed.modelProtocols : {},
      }))
      setJsonTouched(false)
      toast(t('prov_json_applied'), 'success')
    } catch {
      toast(t('prov_json_invalid'), 'error')
    }
  }

  // Model-alias quick fields (sonnet/haiku/opus): first-class inputs that
  // read/write the same modelAliases blob the JSON section edits.
  const aliasValue = (key: string) => safeParse<Record<string, string>>(form.modelAliasesJSON, {})[key] || ''
  const modelOptions = useMemo(() => {
    const aliases = Object.values(safeParse<Record<string, string>>(form.modelAliasesJSON, {}))
    return Array.from(new Set([
      form.defaultModel,
      ...form.models,
      ...parseStringList(form.messageModelsText),
      ...parseStringList(form.fallbackChainText),
      ...aliases,
    ].map(v => v.trim()).filter(Boolean))).sort()
  }, [form.defaultModel, form.models, form.messageModelsText, form.fallbackChainText, form.modelAliasesJSON])
  const setAlias = (key: string, value: string) => setForm(f => {
    const next = { ...safeParse<Record<string, string>>(f.modelAliasesJSON, {}) }
    if (value.trim()) next[key] = value.trim()
    else delete next[key]
    return { ...f, modelAliasesJSON: JSON.stringify(next, null, 2) }
  })
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

  const syncModels = async () => {
    setSyncingModels(true)
    try {
      const result = await apiGet<{ data?: Array<{ id?: string; name?: string; protocol?: ProviderProtocol }> }>(`/ocgt/api/providers/models?line=${form.line}`)
      const protocols: Partial<Record<string, ProviderProtocol>> = {}
      const models = (result?.data || []).map(m => {
        const id = (m.id || m.name || '').trim()
        if (id && m.protocol) protocols[id] = m.protocol
        return id
      }).filter(Boolean)
      setForm(f => ({ ...f, models, modelProtocols: protocols }))
      setSyncCount(models.length)
      toast(t('toast_sync_models_success'), 'success')
    } catch {
      toast(t('toast_sync_models_failed'), 'error')
    } finally {
      setSyncingModels(false)
    }
  }

  // Send a 1-token probe to the upstream to verify the current default model
  // actually completes inference. Uses the editor's draft fields (baseUrl /
  // apiKey / model / protocol) so it works even before the provider is saved.
  const testModel = async () => {
    const model = form.defaultModel.trim()
    if (!model) {
      toast(t('prov_test_no_model'), 'error')
      return
    }
    // 账号池模式下 key 存在 accounts 里；回退到 legacy apiKey 字段。
    const firstAccountKey = form.accounts.find(a => !a.disabled && a.apiKey)?.apiKey || ''
    setTestingModel(true)
    try {
      const result = await apiFetch<{ success: boolean; latencyMs?: number; error?: string }>('/ocgt/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          baseUrl: form.baseUrl,
          apiKey: firstAccountKey || form.apiKey,
          model,
          protocol: form.protocol,
          modelProtocols: form.modelProtocols,
          authMode: form.authMode,
        }),
      }, 35000)
      if (result?.success) {
        toast(t('prov_test_success').replace('{{ms}}', String(result.latencyMs ?? '?')), 'success')
      } else {
        toast(`${t('prov_test_failed')}: ${result?.error || ''}`, 'error')
      }
    } catch (err: unknown) {
      toast(`${t('prov_test_failed')}: ${errMessage(err)}`, 'error')
    } finally {
      setTestingModel(false)
    }
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
          {!openCodeGo && (
            <div className="field">
              <label className="prov-form-label" htmlFor="provider-protocol">{t('prov_field_protocol')}</label>
              <select id="provider-protocol" className="select prov-input" value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value as ProviderProtocol }))}>
                {PROTOCOL_OPTIONS[form.line].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-auth-mode">{t('prov_field_auth_mode')}</label>
            <select id="provider-auth-mode" className="select prov-input" value={form.authMode} onChange={e => setForm(f => ({ ...f, authMode: e.target.value }))}>
              {AUTH_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-default-model">{t('prov_field_default_model')}</label>
            <ModelDropdown
              id="provider-default-model"
              value={form.defaultModel}
              options={modelOptions}
              protocols={form.modelProtocols}
              multiple={false}
              placeholder={t('prov_model_placeholder')}
              onChange={value => setForm(f => ({ ...f, defaultModel: value }))}
            />
          </div>
        </div>
        <div className="prov-sync-row">
          <button type="button" className="btn btn-sm btn-outline" onClick={syncModels} disabled={syncingModels}>
            <RefreshCw width={14} height={14} className={syncingModels ? 'spin-icon' : undefined} />
            {syncingModels ? t('status_saving') : t('btn_sync_models')}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={testModel} disabled={testingModel}>
            <FlaskConical width={14} height={14} className={testingModel ? 'spin-icon' : undefined} />
            {testingModel ? t('status_saving') : t('btn_test_model')}
          </button>
          <span className="muted tiny">{syncCount === null ? t('prov_sync_models_hint') : t('prov_sync_models_count').replace('{{n}}', String(syncCount))}</span>
        </div>
      </div>

      <AccountPoolSection
        accounts={form.accounts}
        onChange={accounts => setForm(f => ({ ...f, accounts }))}
        providerId={providerId}
        rotation={rotation}
      />

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
            <input id="provider-thinking" className="input prov-input" type="number" min="-1" value={form.thinkingBudgetTokens} onChange={e => setForm(f => ({ ...f, thinkingBudgetTokens: e.target.value }))} placeholder="-1" />
            <div className="prov-field-hint">{t('prov_thinking_budget_hint')}</div>
          </div>
          <div className="field">
            <label className="prov-form-label" htmlFor="provider-fallback">{t('prov_field_fallback')}</label>
            <ModelDropdown
              id="provider-fallback"
              value={form.fallbackChainText}
              options={modelOptions}
              protocols={form.modelProtocols}
              multiple
              placeholder={t('prov_models_placeholder')}
              onChange={value => setForm(f => ({ ...f, fallbackChainText: value }))}
            />
            <div className="prov-field-hint">{runtimeCopy.fallbackDesc}</div>
          </div>
          {isClaude && (
            <>
              <div className="field">
                <label className="prov-form-label" htmlFor="provider-alias-sonnet">{t('prov_alias_sonnet')}</label>
                <ModelDropdown id="provider-alias-sonnet" value={aliasValue('sonnet')} options={modelOptions} protocols={form.modelProtocols} placeholder="deepseek-v4-pro" onChange={value => setAlias('sonnet', value)} />
              </div>
              <div className="field">
                <label className="prov-form-label" htmlFor="provider-alias-haiku">{t('prov_alias_haiku')}</label>
                <ModelDropdown id="provider-alias-haiku" value={aliasValue('haiku')} options={modelOptions} protocols={form.modelProtocols} placeholder="deepseek-v4-flash" onChange={value => setAlias('haiku', value)} />
              </div>
              <div className="field">
                <label className="prov-form-label" htmlFor="provider-alias-opus">{t('prov_alias_opus')}</label>
                <ModelDropdown id="provider-alias-opus" value={aliasValue('opus')} options={modelOptions} protocols={form.modelProtocols} placeholder="kimi-k2.6" onChange={value => setAlias('opus', value)} />
                <div className="prov-field-hint">{t('prov_alias_hint')}</div>
              </div>
            </>
          )}
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
          onChange={e => { setJsonTouched(true); setJsonText(e.target.value) }}
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
  rotation,
}: {
  provider: Provider
  expanded: boolean
  form: FormData
  setForm: Dispatch<SetStateAction<FormData>>
  onToggleExpand: (provider: Provider) => void
  onDelete: (provider: Provider) => void
  onActivate: (id: string) => void
  onSave: () => void
  onCancel: () => void
  rotation?: RotationProviderStatus
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
  const poolSize = provider.accounts?.length || 0
  const coolingCount = rotation?.accounts.filter(a => a.state === 'cooldown').length || 0
  const activeAccount = rotation?.accounts.find(a => a.active)

  return (
    <div ref={setNodeRef} className="prov-card" style={style}>
      <div className={provider.enabled ? 'prov-row' : 'prov-row disabled'} style={{ border: 'none', borderRadius: 0, padding: '12px 14px' }}>
        <button className="prov-drag-handle" {...attributes} {...listeners}><GripVertical width={16} height={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="prov-chip-row">
            <span className="prov-name">{provider.name}</span>
            <span className="tag" style={{ background: LINE_COLORS[(provider.line || 'claude') as AgentLine], color: '#fff', fontSize: 10, padding: '1px 6px' }}>{provider.line || 'claude'}</span>
            {provider.enabled && <span className="tag green" style={{ fontSize: 10 }}>{t('prov_card_active_tag')}</span>}
            {poolSize > 1 && (
              <span className="tag" style={{ fontSize: 10 }} title={activeAccount ? `${t('prov_pool_active_now')}: ${activeAccount.label || activeAccount.masked_key}` : undefined}>
                <Users width={11} height={11} style={{ verticalAlign: -1 }} /> {t('prov_pool_badge').replace('{{n}}', String(poolSize))}
              </span>
            )}
            {coolingCount > 0 && (
              <span className="tag" style={{ fontSize: 10, background: 'rgba(245,158,11,0.15)', color: 'var(--warn)' }}>
                {t('prov_pool_cooling_badge').replace('{{n}}', String(coolingCount))}
              </span>
            )}
          </div>
          <div className="prov-meta">{provider.baseUrl}</div>
          <div className="prov-stats">
            {provider.protocol && <span className="tag" style={{ fontSize: 10 }}>{provider.protocol}</span>}
            {provider.defaultModel ? <span className="tag" style={{ fontSize: 10 }}>{provider.defaultModel}</span> : null}
          </div>
        </div>
        <div className="prov-row-controls">
          <button className={provider.enabled ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'} onClick={() => onActivate(provider.id)} disabled={provider.enabled}>
            {provider.enabled ? t('prov_card_current') : t('prov_card_enable')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onToggleExpand(provider)}>
            {expanded ? <ChevronUp width={14} height={14} /> : <ChevronDown width={14} height={14} />}
            {expanded ? t('prov_card_collapse') : t('prov_card_edit')}
          </button>
          <button className="prov-icon-btn red" onClick={() => onDelete(provider)}><Trash2 width={16} height={16} /></button>
        </div>
      </div>
      {expanded ? <ProviderEditor form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} providerId={provider.id} rotation={rotation} /> : null}
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
  const [rotation, setRotation] = useState<Record<string, RotationProviderStatus>>({})
  // Pending provider-deletion confirmation. Null when the modal is closed.
  // Reuses the same ConfirmModal component as the client-integration removal
  // flow so the two pages share a consistent destructive-action prompt.
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null)

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

  // Poll account-rotation status while the page is open so cooldown badges
  // and the "current account" marker stay live.
  const loadRotation = useCallback(async () => {
    try {
      const data = await apiGet<{ providers: RotationProviderStatus[] }>('/ocgt/api/rotation')
      const next: Record<string, RotationProviderStatus> = {}
      for (const item of data?.providers || []) next[item.provider_id] = item
      setRotation(next)
    } catch {
      // Non-critical status overlay — keep the last snapshot on failure.
    }
  }, [])

  useEffect(() => {
    loadRotation()
    const timer = setInterval(loadRotation, 10000)
    return () => clearInterval(timer)
  }, [loadRotation])

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

  // Open the shared confirm modal instead of the OS-native confirm().
  const handleDelete = useCallback((provider: Provider) => {
    setDeleteTarget(provider)
  }, [])

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    const id = target.id
    try {
      await apiFetch(`/ocgt/api/providers/${id}`, { method: 'DELETE' })
      setProviders(prev => prev.filter(p => p.id !== id))
      if (editingId === id) closeEditor()
      toast(t('prov_deleted'), 'success')
    } catch {
      toast(t('prov_delete_fail'), 'error')
    }
  }, [closeEditor, deleteTarget, editingId, t, toast])

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
        requestTimeoutSeconds: form.requestTimeoutSeconds ? parseInt(form.requestTimeoutSeconds, 10) : 0,
        thinkingBudgetTokens: form.thinkingBudgetTokens ? parseInt(form.thinkingBudgetTokens, 10) : -1,
        modelAliases: parseStringMap(form.modelAliasesJSON, 'modelAliases'),
        headers: parseStringMap(form.headersJSON, 'headers'),
        env: parseStringMap(form.envJSON, 'env'),
        modelProtocols: form.modelProtocols,
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
        <div className="prov-header-actions">
          <button className="btn btn-primary" onClick={handleAdd}><Plus width={16} height={16} className="prov-add-icon-gap" />{t('prov_add')}</button>
        </div>
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
        {/* One-click provider switcher: routing follows the active provider,
            so switching must not require opening the editor. */}
        {filteredProviders.length > 0 && (
          <div className="prov-switcher" role="radiogroup" aria-label={t('prov_switch_hint')}>
            {filteredProviders.map(p => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.enabled}
                className={p.enabled ? 'prov-switch-pill on' : 'prov-switch-pill'}
                onClick={() => { if (!p.enabled) handleActivate(p.id) }}
                title={p.baseUrl}
              >
                <span className={p.enabled ? 'dot online' : 'dot off'} />
                <span className="prov-switch-name">{p.name}</span>
                {protocolLabel(p.protocol) && <span className="prov-switch-model">{protocolLabel(p.protocol)}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="prov-switch-hint">{activeProvider ? t('prov_switch_hint') : t('prov_no_active_warning')}</div>
      </section>

      {creating ? <div className="prov-card prov-card-new"><ProviderEditor form={form} setForm={setForm} onSave={handleSave} onCancel={closeEditor} providerId={null} /></div> : null}

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
        <EmptyState icon={<Zap width={28} height={28} />} title={t('prov_no_providers')} description={t('prov_empty_line_desc')} action={<button className="btn btn-outline" onClick={handleAdd} style={{ marginTop: 8 }}>{t('prov_add_first')}</button>} />
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
                  rotation={rotation[provider.id]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Shared confirm modal for provider deletion — same component as the
          client-integration removal prompt. */}
      <ConfirmModal
        open={deleteTarget !== null}
        danger
        title={deleteTarget ? t('prov_delete_title').replace('{{name}}', deleteTarget.name) : ''}
        message={t('prov_confirm_delete')}
        confirmText={t('prov_form_delete')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
