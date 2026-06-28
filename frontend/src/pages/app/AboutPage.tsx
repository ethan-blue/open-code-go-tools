import { useState, useEffect } from 'react'
import { useI18n } from '@/i18n'
import { apiGet, apiFetch } from '@/lib/wails'
import { useToast } from '@/hooks/toast'
import { errMessage } from '@/lib/utils'

export default function AboutPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [version, setVersion] = useState('v4.0.0')
  const [rawJsonOpen, setRawJsonOpen] = useState(false)
  const [rawJsonContent, setRawJsonContent] = useState('')
  const [rawJsonError, setRawJsonError] = useState('')
  const [rawJsonSaving, setRawJsonSaving] = useState(false)

  useEffect(() => {
    apiGet('/ocgt/api/version').then(d => { if (d?.version) setVersion(`v${d.version}`) }).catch(() => {})
  }, [])

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_section_about')}</h1><p className="set-subtitle">{t('sett_section_about_desc')}</p></div>
      </div>
      <section className="set-section">
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('sett_version')}</b><p>{t('sett_version_desc')}</p></div>
            <div className="control"><span className="tag green">{version}</span></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_github')}</b><p>{t('sett_github_desc')}</p></div>
            <div className="control"><a className="btn btn-sm btn-ghost" href="https://github.com/ethan-blue/open-code-go-tools" target="_blank" rel="noopener">{t('btn_open_github')}</a></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_license')}</b><p>{t('sett_license_desc')}</p></div>
            <div className="control"><span className="tag">MIT</span></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_built_with')}</b><p>{t('sett_built_with_desc')}</p></div>
            <div className="control"><div className="settings-row"><span className="tag">Go</span><span className="tag">Wails</span><span className="tag">React</span><span className="tag">TypeScript</span></div></div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('raw_json_title')}</b><p>{t('raw_json_desc')}</p></div>
            <div className="control">
              <button className="btn btn-sm btn-ghost" onClick={async () => {
                setRawJsonOpen(true); setRawJsonError(''); setRawJsonContent(t('raw_json_loading'))
                try { const d = await apiGet('/ocgt/api/config/raw'); setRawJsonContent(d.content || JSON.stringify(d, null, 2)) }
                catch { setRawJsonError(t('raw_json_load_failed')) }
              }}>{t('raw_json_title')}</button>
            </div>
          </div>
        </div>
      </section>
      {rawJsonOpen && (
        <div className="modal-overlay on" onClick={e => { if (e.target === e.currentTarget) setRawJsonOpen(false) }}>
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <div className="modal-header modal-header-flex">
              <h3 className="settings-th">{t('raw_json_title')}</h3>
              <button className="modal-close settings-btn-ghost" onClick={() => setRawJsonOpen(false)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="raw-json-desc">{t('raw_json_desc')}</p>
              <textarea className="code-editor raw-json-editor settings-env-key" value={rawJsonContent} onChange={e => { setRawJsonContent(e.target.value); setRawJsonError('') }} spellCheck={false} />
              {rawJsonError && <div className="field-error-text raw-json-error">{rawJsonError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm btn-ghost" onClick={() => setRawJsonOpen(false)}>{t('raw_json_cancel')}</button>
              <button className="btn btn-sm btn-primary" disabled={rawJsonSaving} onClick={async () => {
                setRawJsonSaving(true); setRawJsonError('')
                try { JSON.parse(rawJsonContent); await apiFetch('/ocgt/api/config/raw', { method: 'POST', body: JSON.stringify({ content: rawJsonContent }) }); toast(t('raw_json_saved'), 'success'); setRawJsonOpen(false) }
                catch (err: unknown) { setRawJsonError(t('raw_json_save_failed') + errMessage(err)) }
                finally { setRawJsonSaving(false) }
              }}>{rawJsonSaving ? '...' : t('raw_json_save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
