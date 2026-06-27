import { memo, useState, useEffect } from 'react'
import { X, ArrowRight, ArrowLeft, Server, Cpu, Terminal, Check, Monitor } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useToast } from '@/hooks/toast'
import { wails, apiGet } from '@/lib/wails'
import { errMessage } from '@/lib/utils'

interface OnboardingWizardProps {
  open: boolean
  onClose: () => void
}

const FALLBACK_MODELS = [
  'claude-3-5-sonnet-latest',
  'gpt-4o',
  'kimi-k2.6',
  'qwen3.6-plus',
  'deepseek-v4-flash',
]

export const OnboardingWizard = memo(function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [step, setStep] = useState(0)
  const [upstream, setUpstream] = useState('https://opencode.ai/zen/go')
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState('kimi-k2.6')
  const [sonnetAlias, setSonnetAlias] = useState('qwen3.6-plus')
  const [haikuAlias, setHaikuAlias] = useState('deepseek-v4-flash')
  const [opusAlias, setOpusAlias] = useState('kimi-k2.6')
  const [installCli, setInstallCli] = useState(true)
  const [installVscode, setInstallVscode] = useState(false)
  const [installDesktop, setInstallDesktop] = useState(false)
  const [installCodex, setInstallCodex] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modelList, setModelList] = useState<string[]>(FALLBACK_MODELS)
  const [systemInfo, setSystemInfo] = useState<{ os: string; arch: string; num_cpu: number } | null>(null)

  useEffect(() => {
    wails.FetchUpstreamModels()
      .then((res: any) => { if (res?.models?.length) setModelList(res.models.map((m: any) => typeof m === 'string' ? m : m.id || m.name)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      apiGet('/ocgt/api/status').then((s) => { if (s?.upstream) setUpstream(s.upstream) }).catch(() => {})
      apiGet('/ocgt/api/system-info').then((info) => { if (info) setSystemInfo(info) }).catch(() => {})
    }
  }, [open])

  if (!open) return null

  const steps = [
    { icon: Monitor, title: t('onboarding_step0_title') || 'System Detection' },
    { icon: Server, title: t('onboarding_step1_title')  },
    { icon: Cpu, title: t('onboarding_step2_title')  },
    { icon: Terminal, title: t('onboarding_step3_title')  },
  ]

  const handleFinish = async () => {
    setSaving(true)
    try {
      const res = await wails.SaveProfileConfig('opencode-go', apiKey, defaultModel, sonnetAlias, haikuAlias, opusAlias, '300', '2048', '127.0.0.1:8787', upstream, '0', '0', '0', '{}', '', '')
      if (res !== 'success') throw new Error(res)
      if (installCli) await wails.InstallClaudeUserEnv().catch(() => {})
      if (installVscode) await wails.InstallVSCodeEnv().catch(() => {})
      if (installDesktop) await wails.SetupClaudeDesktop().catch(() => {})
      if (installCodex) await wails.SetupCodex().catch(() => {})
      localStorage.setItem('onboarding-done', 'true')
      toast(t('toast_saved'), 'success')
      onClose()
    } catch (err: unknown) {
      toast(t('toast_save_failed') + ': ' + errMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('onboarding_title')}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()} role="document">
        <div className="mh">
          <h3>{t('onboarding_title') }</h3>
          <span className="spacer" />
          <button className="x" onClick={onClose} aria-label={t('aria_close')}><X width={16} height={16} /></button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <div className="wiz"><div className={'step' + (i < step ? ' done' : i === step ? ' on' : '')}><span className="n">{i < step ? '' : i + 1}</span></div></div>
              <span style={{ fontSize: 11, fontWeight: i <= step ? 600 : 400, color: i <= step ? 'var(--ink-900)' : 'var(--ink-400)' }}>{s.title}</span>
              {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />}
            </div>
          ))}
        </div>

        <div className="mb" style={{ minHeight: 280 }}>
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
              <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{t('onboarding_welcome') || 'Welcome to Open Code Go'}</h2>
                <p className="muted">{t('onboarding_detecting') || 'Detecting system...'}</p>
              </div>
              {systemInfo && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 300 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 8 }}>
                    <span className="muted">CPU</span>
                    <span className="mono">{systemInfo.num_cpu} cores</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 8 }}>
                    <span className="muted">OS</span>
                    <span className="mono">{systemInfo.os} / {systemInfo.arch}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label>{t('sett_default_model')}</label>
                <select className="select" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
                  {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div className="field"><label>{t('sett_mapping_sonnet')}</label><select className="select" value={sonnetAlias} onChange={(e) => setSonnetAlias(e.target.value)}>{modelList.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                <div className="field"><label>{t('sett_mapping_haiku')}</label><select className="select" value={haikuAlias} onChange={(e) => setHaikuAlias(e.target.value)}>{modelList.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                <div className="field"><label>{t('sett_mapping_opus')}</label><select className="select" value={opusAlias} onChange={(e) => setOpusAlias(e.target.value)}>{modelList.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="muted tiny" style={{ marginBottom: 8 }}>{t('onboarding_step3_desc')}</p>
              {[
                { id: 'cli', label: t('int_sys_title'), desc: '~/.claude/settings.json', checked: installCli, set: setInstallCli },
                { id: 'vscode', label: t('int_vscode_title'), desc: 'VS Code settings.json', checked: installVscode, set: setInstallVscode },
                { id: 'desktop', label: t('int_claude_desktop_title'), desc: 'Claude Desktop 3P', checked: installDesktop, set: setInstallDesktop },
                { id: 'codex', label: t('int_codex_title'), desc: '~/.codex/config.toml', checked: installCodex, set: setInstallCodex },
              ].map((item) => (
                <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, border: '1px solid var(--line)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={item.checked} onChange={(e) => item.set(e.target.checked)} style={{ accentColor: 'var(--ink-950)' }} />
                  <div><p style={{ fontSize: 13, fontWeight: 550, color: 'var(--ink-900)' }}>{item.label}</p><p className="muted tiny">{item.desc}</p></div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="mf">
          <button className="btn btn-sm btn-ghost" onClick={() => step > 0 ? setStep(step - 1) : onClose()} disabled={saving}>
            {step > 0 ? <><ArrowLeft width={13} height={13} /> {t('td_prev')}</> : t('about_close')}
          </button>
          {step < 2 ? (
            <button className="btn btn-sm btn-primary" onClick={() => setStep(step + 1)}>
              {t('td_next')} <ArrowRight width={13} height={13} />
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={handleFinish} disabled={saving}>
              {saving ? t('status_saving') : t('btn_save_config')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
