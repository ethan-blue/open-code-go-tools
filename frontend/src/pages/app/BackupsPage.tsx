import { useState, useEffect } from 'react'
import { useI18n } from '@/i18n'
import { apiFetch } from '@/lib/wails'
import { errMessage } from '@/lib/utils'
import { useToast } from '@/hooks/toast'

export default function BackupsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [dragging, setDragging] = useState(false)

  const handleExport = async () => {
    try {
      const res = await apiFetch('/ocgt/api/config/export')
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ocgt-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast(t('backup_create_success'), 'success')
    } catch (err: unknown) {
      toast(t('backup_create_failed') + ': ' + errMessage(err), 'error')
    }
  }

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.json')) { toast(t('backup_json_only'), 'error'); return }
    if (!confirm(t('backup_restore_confirm'))) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const res = await apiFetch<{ status: string; backupPath?: string }>('/ocgt/api/config/import', { method: 'POST', body: JSON.stringify(data) })
      // Surface the auto-backup path so the user knows where the pre-import
      // snapshot was written (the backend backs up settings.json before overwriting).
      if (res?.backupPath) {
        toast(t('backup_auto_backed_up').replace('{{path}}', res.backupPath), 'success')
      } else {
        toast(t('backup_restore_success'), 'success')
      }
      setTimeout(() => window.location.reload(), 1500)
    } catch (err: unknown) { toast(t('backup_restore_failed') + ': ' + errMessage(err), 'error') }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { await processFile(file); e.target.value = '' }
  }

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_section_backups')}</h1><p className="set-subtitle">{t('sett_section_backups_desc')}</p></div>
      </div>
      <section className="set-section">
        <div className="set-card">
          <div className="settings-row" style={{ gap: 8, marginBottom: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={handleExport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {t('backup_create')}
            </button>
            <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--line-strong)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {t('backup_restore')}
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
            </label>
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f) }}
            style={{ border: dragging ? '1px dashed var(--link)' : '1px dashed var(--line-strong)', borderRadius: 'var(--r-3)', padding: '32px 16px', textAlign: 'center', backgroundColor: dragging ? 'var(--sunken)' : 'transparent', transition: 'all 0.15s ease', cursor: 'pointer', position: 'relative' }}
          >
            <input type="file" accept=".json" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} onChange={handleImport} />
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={dragging ? 'var(--link)' : 'var(--ink-400)'} strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/>
            </svg>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-800)', margin: '0 0 4px' }}>{dragging ? t('backup_drag_release') : t('backup_drag_hint')}</p>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-500)', backgroundColor: 'var(--sunken)', padding: '10px 14px', borderRadius: 'var(--r-2)', lineHeight: 1.5, borderLeft: '2px solid var(--line-strong)', marginTop: 12 }}>
            {t('backup_section_desc')}
          </div>
        </div>
      </section>
    </div>
  )
}
