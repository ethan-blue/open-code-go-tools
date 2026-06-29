import { useState, useEffect, useCallback } from 'react'
import { wails, apiGet } from '@/lib/wails'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import type { AgentLine, Provider } from '@/lib/types'

interface Props {
  embedded?: boolean
  line?: AgentLine
}

export default function ModelMappingPage({ embedded = false, line }: Props) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [providers, setProviders] = useState<Provider[]>([])
  const [activeProfile, setActiveProfile] = useState('')
  const [envJSON, setEnvJSON] = useState('{}')
  const [defaultModel, setDefaultModel] = useState('')
  const [customDefaultModel, setCustomDefaultModel] = useState('')
  const [sonnetAlias, setSonnetAlias] = useState('')
  const [customSonnetAlias, setCustomSonnetAlias] = useState('')
  const [haikuAlias, setHaikuAlias] = useState('')
  const [customHaikuAlias, setCustomHaikuAlias] = useState('')
  const [opusAlias, setOpusAlias] = useState('')
  const [customOpusAlias, setCustomOpusAlias] = useState('')
  const [codexDefaultModel, setCodexDefaultModel] = useState('')
  const [customCodexDefault, setCustomCodexDefault] = useState('')
  const [gpt5Mini, setGpt5Mini] = useState('')
  const [customGpt5Mini, setCustomGpt5Mini] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [customReasoning, setCustomReasoning] = useState('')

  useEffect(() => {
    Promise.all([
      apiGet('/ocgt/api/status').catch(() => null),
      apiGet('/ocgt/api/profiles').catch(() => null),
      apiGet('/ocgt/api/providers').catch(() => null),
    ]).then(([status, profilesData, providerData]: any[]) => {
      const active = status?.active_profile ?? status?.activeProfile ?? profilesData?.active_profile ?? ''
      setActiveProfile(active)
      setDefaultModel(status?.default_model ?? status?.defaultModel ?? status?.model ?? '')
      const envObj = status?.claude_env ?? {}
      setEnvJSON(JSON.stringify(envObj))
      setCodexDefaultModel(envObj.CODEX_DEFAULT_MODEL ?? '')
      setGpt5Mini(envObj.CODEX_GPT5_MINI ?? '')
      setReasoning(envObj.CODEX_REASONING ?? '')
      const profile = active ? profilesData?.profiles?.[active] : null
      const aliases = profile?.model_aliases ?? {}
      setSonnetAlias(aliases.sonnet ?? '')
      setHaikuAlias(aliases.haiku ?? '')
      setOpusAlias(aliases.opus ?? '')
      if (providerData?.providers) setProviders(providerData.providers)
    })
  }, [])

  const claudeModels = [...new Set(providers.filter(p => p.enabled && (p.line === 'claude' || !p.line)).flatMap(p => p.models))]
  const codexModels = [...new Set(providers.filter(p => p.enabled && p.line === 'codex').flatMap(p => p.models))]
  const showClaude = !line || line === 'claude'
  const showCodex = !line || line === 'codex'

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
      const envObj: Record<string, string> = {}
      try {
        const parsed = JSON.parse(envJSON)
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') envObj[key] = value
          }
        }
      } catch {}
      const cdm = codexDefaultModel === 'custom' ? customCodexDefault : codexDefaultModel
      if (cdm) envObj.CODEX_DEFAULT_MODEL = cdm; else delete envObj.CODEX_DEFAULT_MODEL
      const gm = gpt5Mini === 'custom' ? customGpt5Mini : gpt5Mini
      if (gm) envObj.CODEX_GPT5_MINI = gm; else delete envObj.CODEX_GPT5_MINI
      const rn = reasoning === 'custom' ? customReasoning : reasoning
      if (rn) envObj.CODEX_REASONING = rn; else delete envObj.CODEX_REASONING
      if (!activeProfile) throw new Error('active profile not found')
      const err = await wails.SaveProfileConfig(activeProfile, '', dm, sa, ha, oa, '', '', '', '', '', '', '', JSON.stringify(envObj), '', '')
      if (err && typeof err === 'string' && err !== 'success') throw new Error(err)
      toast(t('toast_saved'), 'success')
    } catch {
      toast(t('toast_save_failed'), 'error')
    } finally {
      setSaving(false)
    }
  }, [activeProfile, customCodexDefault, customDefaultModel, customGpt5Mini, customHaikuAlias, customOpusAlias, customReasoning, customSonnetAlias, defaultModel, envJSON, gpt5Mini, haikuAlias, opusAlias, reasoning, sonnetAlias, codexDefaultModel, t, toast])

  const top = (
    <div className="set-top">
      <div>
        <h1 className="set-title">{embedded ? t('sett_s02_title') : t('sett_s02_title')}</h1>
        <p className="set-subtitle">{embedded ? `Active ${line === 'codex' ? 'Codex' : 'Claude'} model aliases` : t('sett_s02_sub')}</p>
      </div>
      <div className="set-actions">
        <button className="btn btn-sm btn-ghost" onClick={async () => {
          try { await wails.FetchUpstreamModels(); toast(t('toast_sync_models_success'), 'success') }
          catch { toast(t('toast_sync_models_failed'), 'error') }
        }}>{t('btn_sync_models')}</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '...' : t('btn_save_config')}</button>
      </div>
    </div>
  )

  return (
    <div>
      {top}
      {showClaude && (
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
      )}
      {showCodex && (
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
              Codex aliases are stored in envJSON (CODEX_DEFAULT_MODEL, CODEX_GPT5_MINI, CODEX_REASONING).
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
