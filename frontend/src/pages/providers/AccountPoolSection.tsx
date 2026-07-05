import { useState } from 'react'
import { Plus, Trash2, Gauge, Zap, ExternalLink } from 'lucide-react'
import { apiFetch, isWails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { ProviderAccount, RotationProviderStatus, AccountQuotaResult } from '@/lib/types'
import { QuickSetupModal } from '@/pages/providers/QuickSetupModal'
import * as rt from '@/wailsjs/runtime/runtime'

/** Renders a compact usage line ("滚动 42% · 周 12%") for one account. */
function QuotaLine({ result }: { result: AccountQuotaResult }) {
  const { t } = useI18n()
  if (!result.success || !result.data) {
    return <span className="prov-account-quota err">{result.error === 'quota cookie not configured' ? t('prov_pool_quota_no_cookie') : `${t('prov_pool_quota_failed')}: ${result.error || ''}`}</span>
  }
  const d = result.data
  return (
    <span className="prov-account-quota">
      {t('prov_pool_rolling')} {d.rolling.usage_percent}% · {t('prov_pool_weekly')} {d.weekly.usage_percent}%
      {d.monthly ? <> · {t('prov_pool_monthly')} {d.monthly.usage_percent}%</> : null}
    </span>
  )
}

/**
 * Account pool editor — the multi-account (多账号轮询) management UI inside the
 * provider editor. Each row is one credential; the proxy fails over across
 * them on 429 / auth errors / persistent 5xx (see backend account_rotation.go).
 */
export function AccountPoolSection({
  accounts,
  onChange,
  providerId,
  rotation,
}: {
  accounts: ProviderAccount[]
  onChange: (next: ProviderAccount[]) => void
  /** Persisted provider id — enables the per-account quota query. Empty while creating. */
  providerId: string | null
  rotation?: RotationProviderStatus
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [quotas, setQuotas] = useState<Record<string, AccountQuotaResult>>({})
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [showQuickSetup, setShowQuickSetup] = useState(false)

  const update = (idx: number, patch: Partial<ProviderAccount>) => {
    onChange(accounts.map((acc, i) => (i === idx ? { ...acc, ...patch } : acc)))
  }
  const remove = (idx: number) => {
    onChange(accounts.filter((_, i) => i !== idx))
  }
  const add = () => {
    onChange([...accounts, { id: '', label: `${t('prov_pool_default_label')} ${accounts.length + 1}`, apiKey: '' }])
  }
  // 一键配置 = 批量导入 key：把粘贴的多个 key 一次性追加到账号池。
  const importAccounts = (imported: ProviderAccount[]) => {
    onChange([...accounts, ...imported])
  }

  const fetchQuotas = async () => {
    if (!providerId) return
    setQuotaLoading(true)
    try {
      const data = await apiFetch<{ accounts: AccountQuotaResult[] }>(`/ocgt/api/quota/accounts?provider=${encodeURIComponent(providerId)}`, undefined, 45000)
      const next: Record<string, AccountQuotaResult> = {}
      for (const item of data?.accounts || []) next[item.account_id] = item
      setQuotas(next)
    } catch {
      toast(t('prov_pool_quota_failed'), 'error')
    } finally {
      setQuotaLoading(false)
    }
  }

  const openQuotaLogin = () => {
    if (isWails()) rt.BrowserOpenURL('https://opencode.ai/go')
    else window.open('https://opencode.ai/go', '_blank', 'noopener,noreferrer')
  }

  const stateOf = (acc: ProviderAccount) => rotation?.accounts.find(a => a.id === acc.id)

  return (
    <div className="prov-editor-section">
      <div className="prov-editor-section-head with-action">
        <div>
          <h4>{t('prov_pool_title')}</h4>
          <p>{t('prov_pool_desc')}</p>
        </div>
        <div className="row gap-2">
          <button className="btn btn-sm btn-ghost" onClick={openQuotaLogin}>
            <ExternalLink width={14} height={14} /> {t('prov_pool_quota_login')}
          </button>
          {providerId && accounts.some(a => a.quotaCookie) ? (
            <button className="btn btn-sm btn-ghost" onClick={fetchQuotas} disabled={quotaLoading}>
              <Gauge width={14} height={14} /> {quotaLoading ? t('prov_pool_quota_loading') : t('prov_pool_quota_btn')}
            </button>
          ) : null}
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="prov-pool-empty">{t('prov_pool_empty')}</div>
      ) : (
        <div className="prov-pool-list">
          {accounts.map((acc, idx) => {
            const st = stateOf(acc)
            return (
              <div key={acc.id || `new-${idx}`} className={acc.disabled ? 'prov-account-row disabled' : 'prov-account-row'}>
                <div className="prov-account-main">
                  <div className="prov-account-fields">
                    <input
                      className="input prov-input prov-account-label"
                      value={acc.label || ''}
                      onChange={e => update(idx, { label: e.target.value })}
                      placeholder={`${t('prov_pool_default_label')} ${idx + 1}`}
                      aria-label={t('prov_pool_label')}
                    />
                    <input
                      className="input prov-input prov-account-key"
                      type="password"
                      value={acc.apiKey}
                      onChange={e => update(idx, { apiKey: e.target.value })}
                      placeholder="sk-..."
                      aria-label={t('prov_pool_key')}
                    />
                    <input
                      className="input prov-input prov-account-cookie"
                      type="password"
                      value={acc.quotaCookie || ''}
                      onChange={e => update(idx, { quotaCookie: e.target.value })}
                      placeholder={t('prov_pool_cookie_placeholder')}
                      aria-label={t('prov_pool_cookie')}
                    />
                  </div>
                  <div className="prov-account-meta">
                    {idx === 0 && <span className="tag" style={{ fontSize: 10 }}>{t('prov_pool_primary')}</span>}
                    {st?.active && <span className="tag green" style={{ fontSize: 10 }}>{t('prov_pool_active_now')}</span>}
                    {st?.state === 'cooldown' && (
                      <span className="tag" style={{ fontSize: 10, background: 'rgba(245,158,11,0.15)', color: 'var(--warn)' }}>
                        {t('prov_pool_state_cooldown')} {Math.ceil((st.cooldown_remaining_ms || 0) / 1000)}s
                      </span>
                    )}
                    {st && st.failures > 0 && <span className="prov-account-failinfo">{st.failures} {t('prov_pool_failures')}</span>}
                    {quotas[acc.id] && <QuotaLine result={quotas[acc.id]} />}
                  </div>
                </div>
                <div className="prov-account-actions">
                  <label className="prov-editor-check" title={t('prov_pool_disabled')}>
                    <input type="checkbox" checked={!acc.disabled} onChange={e => update(idx, { disabled: !e.target.checked })} />
                    <span>{t('prov_pool_enabled')}</span>
                  </label>
                  <button className="prov-icon-btn red" onClick={() => remove(idx)} title={t('prov_pool_remove')} aria-label={t('prov_pool_remove')}>
                    <Trash2 width={15} height={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="row gap-2">
        <button className="btn btn-sm btn-outline prov-pool-add" onClick={add}>
          <Plus width={14} height={14} /> {t('prov_pool_add')}
        </button>
        <button className="btn btn-sm btn-outline" onClick={() => setShowQuickSetup(true)}>
          <Zap width={14} height={14} /> {t('prov_quick_setup')}
        </button>
      </div>

      {showQuickSetup && (
        <QuickSetupModal
          startIndex={accounts.length}
          onClose={() => setShowQuickSetup(false)}
          onImport={importAccounts}
        />
      )}
    </div>
  )
}
