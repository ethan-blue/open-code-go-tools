import { useState, useEffect, useMemo, useCallback } from 'react'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, Edit3, Check, AlertTriangle, Zap, Shield, Clock, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiGet, apiFetch, isWails, wails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { EmptyState, Skeleton } from '@/components/ui'
import type { Provider, AgentLine, ProviderProtocol } from './settings/types'
import { DEFAULT_PROVIDER_FORM } from './settings/types'

const LINE_COLORS: Record<AgentLine, string> = { claude: '#d97706', codex: '#16a34a' }
const PROTOCOL_OPTIONS: Record<AgentLine, { value: ProviderProtocol; label: string }[]> = {
  claude: [{ value: 'anthropic', label: 'Anthropic' }, { value: 'openai-chat', label: 'OpenAI Chat' }, { value: 'custom', label: 'Custom' }],
  codex: [{ value: 'openai-responses', label: 'OpenAI Responses' }, { value: 'openai-chat', label: 'OpenAI Chat' }, { value: 'custom', label: 'Custom' }],
}

type FormData = typeof DEFAULT_PROVIDER_FORM

function SortableProviderRow({ provider, onEdit, onDelete, onToggle }: { provider: Provider; onEdit: (p: Provider) => void; onDelete: (id: string) => void; onToggle: (id: string) => void }) {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: provider.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const healthConfig = { healthy: { icon: Zap, color: 'var(--online)', bg: 'var(--green-soft)', label: 'Healthy' }, degraded: { icon: AlertTriangle, color: 'var(--warn)', bg: 'rgba(245,158,11,0.1)', label: 'Degraded' }, down: { icon: Shield, color: 'var(--danger)', bg: 'rgba(239,68,68,0.1)', label: 'Down' } }
  const health = healthConfig[provider.health] || healthConfig.healthy
  const HealthIcon = health.icon
  const lineColor = provider.line ? LINE_COLORS[provider.line] : undefined

  return (
    <div ref={setNodeRef} className={provider.enabled ? 'prov-row' : 'prov-row disabled'} style={{ ...style, boxShadow: isDragging ? '0 10px 40px rgba(0,0,0,0.15)' : undefined, zIndex: isDragging ? 10 : undefined, borderLeft: lineColor ? `3px solid ${lineColor}` : undefined }}>
      <button className="prov-drag-handle" {...attributes} {...listeners}><GripVertical width={16} height={16} /></button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="prov-actions">
          <span className="prov-name">{provider.name}</span>
          {provider.line && <span className="tag" style={{ background: lineColor, color: '#fff', fontSize: 10, padding: '1px 6px' }}>{provider.line}</span>}
          <span className="prov-health-badge" style={{ background: health.bg, color: health.color }}><HealthIcon width={12} height={12} /> {health.label}</span>
          {!provider.enabled && <span className="prov-badge-disabled">{t('prov_disabled')}</span>}
        </div>
        <div className="prov-meta">{provider.baseUrl}</div>
        <div className="prov-stats">
          <span className="prov-stat-item"><Clock width={12} height={12} /> {provider.avgLatency}ms</span>
          <span>{provider.requestCount.toLocaleString()} requests</span>
          <span className={provider.errorCount > 0 ? 'text-danger' : undefined}>{provider.errorCount} errors</span>
          {provider.protocol && <span className="tag" style={{ fontSize: 10 }}>{provider.protocol}</span>}
          {provider.rateLimitPerSecond ? <span className="tag" style={{ fontSize: 10 }}>{provider.rateLimitPerSecond}/s</span> : null}
        </div>
      </div>
      <div className="prov-actions">
        <span className="prov-priority">P{provider.priority}</span>
        <button className={provider.enabled ? 'prov-icon-btn green' : 'prov-icon-btn neutral'} onClick={() => onToggle(provider.id)}><Check width={16} height={16} /></button>
        <button className="prov-icon-btn neutral" onClick={() => onEdit(provider)}><Edit3 width={16} height={16} /></button>
        <button className="prov-icon-btn red" onClick={() => onDelete(provider.id)}><Trash2 width={16} height={16} /></button>
      </div>
    </div>
  )
}

export default function Providers() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<Provider[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(DEFAULT_PROVIDER_FORM)
  const [lineFilter, setLineFilter] = useState<'all' | AgentLine>('all')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const loadProviders = useCallback(async () => {
    try { setLoading(true); const data = await apiGet<{ providers: Provider[] }>('/ocgt/api/providers'); if (data?.providers) setProviders(data.providers.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))) }
    catch { toast(t('prov_load_failed'), 'error') } finally { setLoading(false) }
  }, [t, toast])

  useEffect(() => { loadProviders() }, [loadProviders])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event; if (!over || active.id === over.id) return
    const oldIndex = providers.findIndex(p => p.id === active.id); const newIndex = providers.findIndex(p => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(providers, oldIndex, newIndex); setProviders(reordered)
    try { await apiFetch('/ocgt/api/providers/sort', { method: 'POST', body: JSON.stringify({ ids: reordered.map(p => p.id) }) }); toast(t('prov_order_saved'), 'success') }
    catch { toast(t('prov_order_fail'), 'error'); loadProviders() }
  }, [providers, loadProviders, toast, t])

  const handleAdd = useCallback(() => { setEditingId(null); setForm(DEFAULT_PROVIDER_FORM); setShowForm(true) }, [])
  const handleEdit = useCallback((provider: Provider) => {
    setEditingId(provider.id)
    setForm({ name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey, models: provider.models, priority: provider.priority, enabled: provider.enabled, line: (provider.line || 'claude') as AgentLine, protocol: (provider.protocol || 'anthropic') as ProviderProtocol, rateLimitPerSecond: String(provider.rateLimitPerSecond || ''), rateLimitBurst: String(provider.rateLimitBurst || '') })
    setShowForm(true)
  }, [])
  const handleDelete = useCallback(async (id: string) => { if (!confirm(t('prov_confirm_delete'))) return; try { await apiFetch(`/ocgt/api/providers/${id}`, { method: 'DELETE' }); setProviders(prev => prev.filter(p => p.id !== id)); toast(t('prov_deleted'), 'success') } catch { toast(t('prov_delete_fail'), 'error') } }, [t, toast])
  const handleToggle = useCallback(async (id: string) => { const provider = providers.find(p => p.id === id); if (!provider) return; try { const res = await apiFetch<{ enabled: boolean }>(`/ocgt/api/providers/${id}/toggle`, { method: 'PATCH' }); setProviders(prev => prev.map(p => p.id === id ? { ...p, enabled: res.enabled } : p)); toast(res.enabled ? t('prov_enabled') : t('prov_disabled'), 'success') } catch { toast(t('prov_toggle_fail'), 'error') } }, [providers, t, toast])

  const handleSave = useCallback(async () => {
    if (!form.name || !form.baseUrl) { toast(t('prov_name_url_required'), 'error'); return }
    const body = { ...form, rateLimitPerSecond: form.rateLimitPerSecond ? parseInt(form.rateLimitPerSecond) : 0, rateLimitBurst: form.rateLimitBurst ? parseInt(form.rateLimitBurst) : 0 }
    try {
      if (editingId) { await apiFetch(`/ocgt/api/providers/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); toast(t('prov_updated'), 'success') }
      else { await apiFetch('/ocgt/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sortIndex: providers.length }) }); toast(t('prov_added'), 'success') }
      setShowForm(false); loadProviders()
    } catch { toast(t('prov_save_fail'), 'error') }
  }, [editingId, form, providers.length, loadProviders, toast, t])

  const handleFetchModels = useCallback(async () => {
    try { await wails.FetchUpstreamModels(); toast(t('toast_sync_models_success'), 'success'); loadProviders() }
    catch { toast(t('toast_sync_models_failed'), 'error') }
  }, [t, toast, loadProviders])

  const filteredProviders = lineFilter === 'all' ? providers : providers.filter(p => (p.line || 'claude') === lineFilter)
  const stats = useMemo(() => ({ healthy: providers.filter(p => p.health === 'healthy').length, total: providers.length, totalRequests: providers.reduce((s, p) => s + p.requestCount, 0), totalErrors: providers.reduce((s, p) => s + p.errorCount, 0) }), [providers])

  return (
    <div className="providers-page">
      <div className="prov-header">
        <div><h2 className="prov-header-title">{t('prov_title')}</h2><p className="prov-header-sub">{t('prov_subtitle')}</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isWails() && <button className="btn btn-ghost btn-sm" onClick={handleFetchModels}><RefreshCw width={14} height={14} style={{ marginRight: 4 }} />{t('btn_sync_models')}</button>}
          <button className="btn btn-primary" onClick={handleAdd}><Plus width={16} height={16} style={{ marginRight: 8 }} />{t('prov_add')}</button>
        </div>
      </div>
      <div className="prov-stats-grid">
        <div className="card prov-stat-card"><div className="prov-label">{t('prov_total')}</div><div className="prov-value">{stats.total}</div></div>
        <div className="card prov-stat-card"><div className="prov-label">{t('prov_healthy')}</div><div className="prov-value" style={{ color: 'var(--online)' }}>{stats.healthy}</div></div>
        <div className="card prov-stat-card"><div className="prov-label">{t('dash_requests')}</div><div className="prov-value">{stats.totalRequests.toLocaleString()}</div></div>
        <div className="card prov-stat-card"><div className="prov-label">{t('dash_errors')}</div><div className={`prov-value ${stats.totalErrors > 0 ? 'text-danger' : 'text-success'}`}>{stats.totalRequests > 0 ? ((stats.totalErrors / stats.totalRequests) * 100).toFixed(1) : '0.0'}%</div></div>
      </div>
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={lineFilter === 'all' ? 'on' : ''} onClick={() => setLineFilter('all')}>All</button>
        <button className={lineFilter === 'claude' ? 'on' : ''} onClick={() => setLineFilter('claude')}>Claude</button>
        <button className={lineFilter === 'codex' ? 'on' : ''} onClick={() => setLineFilter('codex')}>Codex</button>
      </div>
      {loading ? (
        <div className="prov-flex-col" style={{ gap: 12, padding: '16px 0' }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="prov-row prov-skeleton-row"><Skeleton style={{ width: 20, height: 20 }} /><div className="prov-skeleton-col"><Skeleton style={{ width: '50%', height: 14 }} /><Skeleton style={{ width: '70%', height: 10 }} /></div></div>)}</div>
      ) : filteredProviders.length === 0 ? (
        <EmptyState icon={<Zap width={28} height={28} />} title={t('prov_no_providers')} description={t('prov_subtitle')} action={<button className="btn btn-outline" onClick={handleAdd} style={{ marginTop: 8 }}>{t('prov_add_first')}</button>} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filteredProviders.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <div className="prov-list">{filteredProviders.map(provider => <SortableProviderRow key={provider.id} provider={provider} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} />)}</div>
          </SortableContext>
        </DndContext>
      )}
      {showForm && (
        <div className="prov-form-overlay">
          <div className="prov-form" style={{ maxWidth: 520 }}>
            <h3 className="prov-form-title">{editingId ? t('prov_edit') : t('prov_add')}</h3>
            <div className="prov-form-body">
              <div><label className="prov-form-label">{t('prov_form_name')}</label><input className="input prov-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('prov_name_placeholder')} /></div>
              <div><label className="prov-form-label">{t('prov_base_url')}</label><input className="input prov-input" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder={t('prov_url_placeholder')} /></div>
              <div><label className="prov-form-label">{t('prov_api_key_label')}</label><input className="input prov-input" type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="sk-..." /></div>
              <div>
                <label className="prov-form-label">Product Line</label>
                <div className="segmented" style={{ marginBottom: 8 }}>
                  <button className={form.line === 'claude' ? 'on' : ''} onClick={() => setForm(f => ({ ...f, line: 'claude', protocol: 'anthropic' }))} style={form.line === 'claude' ? { borderColor: LINE_COLORS.claude } : undefined}>Claude</button>
                  <button className={form.line === 'codex' ? 'on' : ''} onClick={() => setForm(f => ({ ...f, line: 'codex', protocol: 'openai-responses' }))} style={form.line === 'codex' ? { borderColor: LINE_COLORS.codex } : undefined}>Codex</button>
                </div>
              </div>
              <div>
                <label className="prov-form-label">Protocol</label>
                <select className="select prov-input" value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value as ProviderProtocol }))}>
                  {PROTOCOL_OPTIONS[form.line].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div><label className="prov-form-label">{t('prov_priority_hint')}</label><input className="input prov-input" type="number" min="0" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))} /></div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}><label className="prov-form-label">Rate Limit /s</label><input className="input prov-input" type="number" min="0" value={form.rateLimitPerSecond} onChange={e => setForm(f => ({ ...f, rateLimitPerSecond: e.target.value }))} placeholder="0 = unlimited" /></div>
                <div style={{ flex: 1 }}><label className="prov-form-label">Burst</label><input className="input prov-input" type="number" min="0" value={form.rateLimitBurst} onChange={e => setForm(f => ({ ...f, rateLimitBurst: e.target.value }))} placeholder="0" /></div>
              </div>
              <div className="prov-actions"><input type="checkbox" id="enabled" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} /><label htmlFor="enabled" className="prov-form-label">{t('prov_enabled_label')}</label></div>
            </div>
            <div className="prov-form-actions"><button className="btn btn-ghost" onClick={() => setShowForm(false)}>{t('prov_form_cancel')}</button><button className="btn btn-primary" onClick={handleSave}>{t('prov_form_save')}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
