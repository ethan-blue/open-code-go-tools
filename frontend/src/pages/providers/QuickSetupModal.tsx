import { useState } from 'react'
import { Zap } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { ProviderAccount } from '@/lib/types'

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
 * 一键配置 / 批量导入 (Quick Setup): paste N API keys → they get appended to
 * the provider's account pool. This is a pure front-end helper: it does NOT
 * call any backend API; it hands the parsed keys back to the caller via
 * onImport, which wires them into the editor's `accounts` array.
 *
 * Lives inside the account-pool section because bulk key import is exactly
 * what the account pool is for.
 */
export function QuickSetupModal({
  startIndex,
  onClose,
  onImport,
}: {
  /** Number of accounts already in the pool — used to label the new entries. */
  startIndex: number
  onClose: () => void
  /** Receives the parsed accounts to append to the pool. */
  onImport: (accounts: ProviderAccount[]) => void
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [raw, setRaw] = useState('')

  const apply = () => {
    const keys = parsePastedKeys(raw)
    if (keys.length === 0) {
      toast(t('prov_quick_setup_none'), 'error')
      return
    }
    const accounts: ProviderAccount[] = keys.map((apiKey, i) => ({
      id: '',
      label: `${t('prov_pool_default_label')} ${startIndex + i + 1}`,
      apiKey,
    }))
    toast(t('prov_quick_setup_done').replace('{{n}}', String(keys.length)), 'success')
    onImport(accounts)
    onClose()
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
          <button className="btn btn-sm btn-primary" onClick={apply} disabled={keyCount === 0}>
            {`${t('prov_quick_setup_apply')}${keyCount > 0 ? ` (${keyCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
