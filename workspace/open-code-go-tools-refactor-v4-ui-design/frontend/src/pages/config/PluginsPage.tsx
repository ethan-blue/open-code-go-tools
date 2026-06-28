import { useState, useEffect, useCallback } from 'react'
import { wails, apiGet } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'

export default function PluginsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [plugins, setPlugins] = useState<Record<string, boolean>>({})

  useEffect(() => {
    apiGet('/ocgt/api/status').then(d => {
      if (d?.plugins) setPlugins(d.plugins)
    }).catch(() => {})
  }, [])

  const pluginList = [
    { id: 'web_search', title: t('plugin_web_search_title'), desc: t('plugin_web_search_desc'), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
    { id: 'auto_compress', title: t('plugin_auto_compress_title'), desc: t('plugin_auto_compress_desc'), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 14h6v6H4zm10-10h6v6h-6zm-4 4H4v6h6zm10 2h-6v6h6z"/></svg> },
    { id: 'session_save', title: t('plugin_session_save_title'), desc: t('plugin_session_save_desc'), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> },
    { id: 'git_sync', title: t('plugin_git_sync_title'), desc: t('plugin_git_sync_desc'), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
  ]

  const togglePlugin = (id: string) => {
    setPlugins(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const err = await wails.SavePlugins(JSON.stringify(plugins))
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [plugins, t, toast])

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_section_plugins')}</h1><p className="set-subtitle">{t('sett_section_plugins_desc')}</p></div>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
      </div>
      <section className="set-section">
        <div className="set-card">
          {pluginList.map(p => {
            const isEnabled = !!plugins[p.id]
            return (
              <div className="set-row" key={p.id}>
                <div className="label">
                  <b className="settings-row">{p.icon}{p.title}</b>
                  <p>{p.desc}</p>
                </div>
                <div className="control">
                  <div className="settings-row">
                    <button type="button" className={`toggle${isEnabled ? ' on' : ''}`} onClick={() => togglePlugin(p.id)} role="switch" aria-checked={isEnabled} aria-label={p.title}><span /></button>
                    <span style={{ fontSize: 11.5, minWidth: 40, color: isEnabled ? 'var(--online)' : 'var(--ink-400)', fontWeight: 500 }}>
                      {isEnabled ? t('plugin_status_active') : t('plugin_status_inactive')}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
