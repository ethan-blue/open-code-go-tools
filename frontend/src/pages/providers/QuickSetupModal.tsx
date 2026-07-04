import { useState } from 'react'
import { Zap } from 'lucide-react'
import { apiFetch } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { Provider, AgentLine, ProviderAccount } from '@/lib/types'

const DEFAULT_UPSTREAM = 'https://opencode.ai/zen/go'

/** Split pasted text into API keys (one per line, comma/semicolon also accepted). */
export function parsePastedKeys(raw: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const part of raw.split(/[\n,;]+/)) {
    const key = part.trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

/**
 * 一键配置 (Quick Setup): paste N API keys → the active provider on the current
 * line gets an account pool with failover rotation. Creates an OpenCode Go
 * provider when the line has none.
 */
export function QuickSetupModal({
  line,
  providers,
  onClose,
  onDone,
}: {
  line: AgentLine
  providers: Provider[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [raw, setRaw] = useState('')
  const [saving, setSaving] = useState(false)

  const target = providers.find(p => (p.line || 'claude') === line && p.enabled)
    || providers.find(p => (p.line || 'claude') === line)

  const apply = async () => {
    const keys = parsePastedKeys(raw)
    if (keys.length === 0) {
      toast(t('prov_quick_setup_none'), 'error')
      return
    }
    const accounts: ProviderAccount[] = keys.map((apiKey, i) => ({
      id: '',
      label: `${t('prov_pool_default_label')} ${i + 1}`,
      apiKey,
    }))
    setSaving(true)
    try {
      if (target) {
        await apiFetch(`/ocgt/api/providers/${target.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...target, accounts, enabled: true }),
        })
      } else {
        await apiFetch('/ocgt/api/providers', {
          method: 'POST',
          body: JSON.stringify({
            name: 'OpenCode Go',
            baseUrl: DEFAULT_UPSTREAM,
            line,
            protocol: line === 'codex' ? 'openai-responses' : 'openai-chat',
            enabled: true,
            accounts,
          }),
        })
      }
      toast(t('prov_quick_setup_done').replace('{{n}}', String(keys.length)), 'success')
      onDone()
      onClose()
    } catch {
      toast(t('prov_quick_setup_fail'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const keyCount = parsePastedKeys(raw).length

  return (
    <div className="modal-overlay on" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal prov-quick-modal" onClick={e => e.stopPropagation()} role="document">
        <div className="mh">
          <h3><Zap width={16} height={16} className="prov-add-icon-gap" />{t('prov_quick_setup_title')}</h3>
        </div>
        <div className="mb">
          <p className="prov-quick-desc">{t('prov_quick_setup_desc')}</p>
          <p className="prov-quick-target">
            {target
              ? t('prov_quick_setup_target').replace('{{name}}', target.name)
              : t('prov_quick_setup_create')}
          </p>
          <textarea
            className="settings-env-key prov-quick-textarea"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            rows={6}
            placeholder={'sk-...\nsk-...\nsk-...'}
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="mf">
          <button className="btn btn-sm" onClick={onClose}>{t('prov_form_cancel')}</button>
          <button className="btn btn-sm btn-primary" onClick={apply} disabled={saving || keyCount === 0}>
            {saving ? t('status_saving') : `${t('prov_quick_setup_apply')}${keyCount > 0 ? ` (${keyCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
