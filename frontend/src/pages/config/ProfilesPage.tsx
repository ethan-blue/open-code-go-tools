import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiFetch, wails } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

interface ProfileInfo {
  name: string
  upstream?: string
  defaultModel?: string
  isActive: boolean
}

export default function ProfilesPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet('/ocgt/api/profiles')
      if (data?.profiles) {
        const activeName = data.active_profile || ''
        const list: ProfileInfo[] = Object.entries(data.profiles).map(([name, cfg]: [string, any]) => ({
          name,
          upstream: cfg?.upstream || '',
          defaultModel: cfg?.defaultModel || cfg?.model || '',
          isActive: name === activeName,
        }))
        setProfiles(list)
      }
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const handleSetActive = useCallback(async (name: string) => {
    try {
      await apiFetch('/ocgt/api/profiles/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: name }),
      })
      toast(t('toast_profile_changed'), 'success')
      loadProfiles()
    } catch { toast(t('toast_save_failed'), 'error') }
  }, [t, toast, loadProfiles])

  return (
    <div>
      <div className="set-top">
        <div>
          <h1 className="set-title">Profiles</h1>
          <p className="set-subtitle">A profile = one set of Claude + Codex mappings, rules, and provider bindings.</p>
        </div>
        <div className="set-actions">
          <button className="btn btn-sm" disabled title="待后端支持">{t('sett_tab_proxy')}: New</button>
        </div>
      </div>
      {loading ? null : profiles.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-400)' }}>No profiles found.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {profiles.map(p => (
            <div key={p.name} className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b style={{ fontSize: 14 }}>{p.name}</b>
                  {p.isActive && <span className="tag green" style={{ fontSize: 10 }}>active</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4 }}>
                  {p.upstream && <span>upstream: {p.upstream}</span>}
                  {p.defaultModel && <span style={{ marginLeft: 12 }}>model: {p.defaultModel}</span>}
                </div>
              </div>
              {!p.isActive && (
                <button className="btn btn-sm btn-ghost" onClick={() => handleSetActive(p.name)}>Set Active</button>
              )}
              <button className="btn btn-sm btn-ghost" disabled title="待后端支持" style={{ opacity: 0.5 }}>Rename</button>
              <button className="btn btn-sm btn-ghost" disabled title="待后端支持" style={{ opacity: 0.5 }}>Delete</button>
              <button className="btn btn-sm btn-ghost" onClick={() => wails.OpenConfigLocation().catch(() => {})}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
