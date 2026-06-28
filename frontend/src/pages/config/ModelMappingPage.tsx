import { useState, useEffect, useCallback } from 'react'
import { wails, apiGet } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { Provider } from '@/lib/types'

export default function ModelMappingPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [providers, setProviders] = useState<Provider[]>([])
  // Claude aliases
  const [defaultModel, setDefaultModel] = useState('')
  const [customDefaultModel, setCustomDefaultModel] = useState('')
  const [sonnetAlias, setSonnetAlias] = useState('')
  const [customSonnetAlias, setCustomSonnetAlias] = useState('')
  const [haikuAlias, setHaikuAlias] = useState('')
  const [customHaikuAlias, setCustomHaikuAlias] = useState('')
  const [opusAlias, setOpusAlias] = useState('')
  const [customOpusAlias, setCustomOpusAlias] = useState('')
  // Codex aliases
  const [codexDefaultModel, setCodexDefaultModel] = useState('')
  const [customCodexDefault, setCustomCodexDefault] = useState('')
  const [gpt5Mini, setGpt5Mini] = useState('')
  const [customGpt5Mini, setCustomGpt5Mini] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [customReasoning, setCustomReasoning] = useState('')

  useEffect(() => {
    apiGet('/ocgt/api/status').then(d => {
      if (!d) return
      const dm = d.defaultModel ?? d.model ?? ''
      setDefaultModel(dm)
      setSonnetAlias(d.sonnetAlias ?? '')
      setHaikuAlias(d.haikuAlias ?? '')
      setOpusAlias(d.opusAlias ?? '')
    }).catch(() => {})
    apiGet('/ocgt/api/providers').then(d => {
      if (d?.providers) setProviders(d.providers)
    }).catch(() => {})
  }, [])

  const claudeModels = [...new Set(providers.filter(p => p.enabled && (p.line === 'claude' || !p.line)).flatMap(p => p.models))]
  const codexModels = [...new Set(providers.filter(p => p.enabled && p.line === 'codex').flatMap(p => p.models))]

  function modelSelect(value: string, onChange: (v: string) => void, customValue: string, onCustomChange: (v: string) => void, models: string[]) {
    const isCustom = !models.includes(value) && value !== ''
    return (
      <>
        <select className="select" value={isCustom ? 'custom' : value} onChange={e => onChange(e.target.value)}>
          <option value="">{t('status_not_configured')}</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
          <option value="custom">{t('opt_custom')}</option>
        </select>
        {(isCustom || value === 'custom') && (
          <input className="input" value={customValue || (isCustom ? value : '')} onChange={e => onCustomChange(e.target.value)} placeholder="custom model id" style={{ marginTop: 6 }} />
        )}
      </>
    )
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const dm = defaultModel === 'custom' ? customDefaultModel : defaultModel
      const sa = sonnetAlias === 'custom' ? customSonnetAlias : sonnetAlias
      const ha = haikuAlias === 'custom' ? customHaikuAlias : haikuAlias
      const oa = opusAlias === 'custom' ? customOpusAlias : opusAlias
      // Codex aliases go into envJSON
      const envObj: Record<string, string> = {}
      const cdm = codexDefaultModel === 'custom' ? customCodexDefault : codexDefaultModel
      if (cdm) envObj.CODEX_DEFAULT_MODEL = cdm
      const gm = gpt5Mini === 'custom' ? customGpt5Mini : gpt5Mini
      if (gm) envObj.CODEX_GPT5_MINI = gm
      const rn = reasoning === 'custom' ? customReasoning : reasoning
      if (rn) envObj.CODEX_REASONING = rn
      const envJSON = JSON.stringify(envObj)
      const err = await wails.SaveProfileConfig('', '', dm, sa, ha, oa, '', '', '', '', '', '', '', envJSON, '', '')
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      toast(t('toast_saved'), 'success')
    } catch { toast(t('toast_save_failed'), 'error') }
    finally { setSaving(false) }
  }, [defaultModel, customDefaultModel, sonnetAlias, customSonnetAlias, haikuAlias, customHaikuAlias, opusAlias, customOpusAlias, codexDefaultModel, customCodexDefault, gpt5Mini, customGpt5Mini, reasoning, customReasoning, t, toast])

  return (
    <div>
      <div className="set-top">
        <div><h1 className="set-title">{t('sett_s02_title')}</h1><p className="set-subtitle">{t('sett_s02_sub')}</p></div>
        <div className="set-actions">
          <button className="btn btn-sm btn-ghost" onClick={async () => {
            try { await wails.FetchUpstreamModels(); toast(t('toast_sync_models_success'), 'success') }
            catch { toast(t('toast_sync_models_failed'), 'error') }
          }}>{t('btn_sync_models')}</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
        </div>
      </div>
      {/* Claude mapping */}
      <section className="set-section">
        <div className="head">
          <div><h3>Claude</h3><div className="sub">{t('sett_mapping_title')}</div></div>
          <span className="tag" style={{ background: '#d97706', color: '#fff' }}>Claude</span>
        </div>
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>{t('sett_default_model_label')}</b><p>{t('sett_default_model_desc')}</p></div>
            <div className="control">{modelSelect(defaultModel, setDefaultModel, customDefaultModel, setCustomDefaultModel, claudeModels)}</div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_alias_sonnet')}</b><p>{t('sett_alias_sonnet_desc')}</p></div>
            <div className="control">{modelSelect(sonnetAlias, setSonnetAlias, customSonnetAlias, setCustomSonnetAlias, claudeModels)}</div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_alias_haiku')}</b><p>{t('sett_alias_haiku_desc')}</p></div>
            <div className="control">{modelSelect(haikuAlias, setHaikuAlias, customHaikuAlias, setCustomHaikuAlias, claudeModels)}</div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('sett_alias_opus')}</b><p>{t('sett_alias_opus_desc')}</p></div>
            <div className="control">{modelSelect(opusAlias, setOpusAlias, customOpusAlias, setCustomOpusAlias, claudeModels)}</div>
          </div>
        </div>
      </section>
      {/* Codex mapping */}
      <section className="set-section">
        <div className="head">
          <div><h3>Codex</h3><div className="sub">Codex model aliases</div></div>
          <span className="tag" style={{ background: '#16a34a', color: '#fff' }}>Codex</span>
        </div>
        <div className="set-card">
          <div className="set-row">
            <div className="label"><b>Default Model</b><p>Default model for Codex clients</p></div>
            <div className="control">{modelSelect(codexDefaultModel, setCodexDefaultModel, customCodexDefault, setCustomCodexDefault, codexModels)}</div>
          </div>
          <div className="set-row">
            <div className="label"><b>GPT-5 Mini</b><p>Fast Codex model alias</p></div>
            <div className="control">{modelSelect(gpt5Mini, setGpt5Mini, customGpt5Mini, setCustomGpt5Mini, codexModels)}</div>
          </div>
          <div className="set-row">
            <div className="label"><b>Reasoning</b><p>Reasoning model alias (optional)</p></div>
            <div className="control">{modelSelect(reasoning, setReasoning, customReasoning, setCustomReasoning, codexModels)}</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', padding: '8px 16px' }}>
            {/* TODO(backend): native codex alias fields */}
            Codex aliases are stored in envJSON (CODEX_DEFAULT_MODEL, CODEX_GPT5_MINI, CODEX_REASONING).
          </div>
        </div>
      </section>
    </div>
  )
}
