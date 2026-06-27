import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { wails, isWails } from '@/lib/wails'
import type { FormState, SetField } from './types'

interface Props {
  form: FormState
  set: SetField
  saved: FormState
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export function ApiSection({ form, set, saved }: Props) {
  const { t } = useI18n()
  const [localToken, setLocalToken] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  // Load local auth token on mount
  useEffect(() => {
    if (isWails()) {
      wails.GetLocalToken().then(token => setLocalToken(token || '')).catch(() => {})
    }
  }, [])

  // Copy token to clipboard
  const handleCopyToken = useCallback(async () => {
    if (!localToken) return
    try {
      await navigator.clipboard.writeText(localToken)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      // fallback for non-secure contexts
      const ta = document.createElement('textarea')
      ta.value = localToken
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    }
  }, [localToken])

  // Test upstream connectivity via Go backend (avoids CORS in Wails webview)

  // Uses the DRAFT form values — no need to save first.

  const handleTestConnection = useCallback(async () => {

    setTestStatus('testing')

    setTestMessage('')

    try {

      const result = await wails.TestUpstreamConnection(form.upstream, form.apiKey)

      if (result && result.success && result.data) {

        const models = result.data.models

        if (Array.isArray(models)) {

          setTestStatus('success')

          setTestMessage(`${t('sett_test_ok')}: ${models.length} models`)

        } else {

          setTestStatus('success')

          setTestMessage(t('sett_test_ok'))

        }

      } else {

        setTestStatus('error')

        setTestMessage(result?.error || t('sett_test_fail'))

      }

    } catch (err: unknown) {

      const msg = err instanceof Error ? err.message : String(err)

      setTestStatus('error')

      setTestMessage(msg || t('sett_test_fail'))

    }

  }, [t, form.upstream, form.apiKey])

  return (
    <section className="set-section" id="set-01">
      <div className="head">
        <div><h3>01 · {t('sett_s01_title')}</h3><div className="sub">{t('sett_s01_sub')}</div></div>
        {form.upstream !== saved.upstream && <span className="dirty">dirty</span>}
      </div>
      <div className="set-card">
        <div className="set-row">
          <div className="label"><b>{t('sett_upstream_url')}</b><p>{t('sett_upstream_url_desc')}</p></div>
          <div className="control">
            <div className="input-wrap">
              <span className="prefix">https://</span>
              <input className="input with-prefix" value={form.upstream} onChange={(e) => set('upstream', e.target.value.replace(/^https?:\/\//i, ''))} placeholder="api.anthropic.com" />
            </div>
            <span className="hint">api.anthropic.com · gateway.ai.cloudflare.com · generativelanguage.googleapis.com</span>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>API Key</b><p>{t('sett_api_key_desc')}</p></div>
          <div className="control">
            <div className="input-wrap">
              <input className="input" type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-..." />
              <span className="suffix">{t('sett_keychain')}</span>
            </div>
            <div className="row gap-2">
              <button className="btn btn-sm btn-ghost" onClick={handleTestConnection} disabled={testStatus === 'testing'}>
                {testStatus === 'testing' ? <><Loader2 size={14} className="spin-icon" /> {t('sett_testing')}</> : t('sett_test_conn')}
              </button>
              {testStatus === 'success' && <span className="tag green">{testMessage}</span>}
              {testStatus === 'error' && <span className="tag red">{testMessage}</span>}
            </div>
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_local_token')}</b><p>{t('sett_local_token_desc')}</p></div>
          <div className="control">
            <div className="input-wrap">
              <input className="input" readOnly value={localToken || '••••••••'} type={localToken ? 'password' : 'text'} />
              <button className="suffix-btn" onClick={handleCopyToken} title={t('btn_copy')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px' }}>
                {copyFeedback ? <Check size={14} className="text-green" /> : <Copy size={14} />}
              </button>
            </div>
            <span className="hint">{t('sett_token_hint')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
