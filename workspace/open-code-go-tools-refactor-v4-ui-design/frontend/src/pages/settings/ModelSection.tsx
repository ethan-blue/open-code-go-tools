import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { isWails, wails } from '@/lib/wails'
import { useToast } from '@/hooks/toast'
import type { FormState, SetField } from './types'

interface Props {
  form: FormState
  set: SetField
  modelOptions: (custom: string) => ReactNode
}

export function ModelSection({ form, set, modelOptions }: Props) {
  const { t } = useI18n()
  const { toast } = useToast()

  return (
    <section className="set-section" id="set-02">
      <div className="head">
        <div><h3>02 · {t('sett_s02_title')}</h3><div className="sub">{t('sett_s02_sub')}</div></div>
        {isWails() && (
          <button className="btn btn-sm btn-ghost" onClick={async () => {
            try {
              const models = await wails.FetchUpstreamModels()
              if (models && Array.isArray(models.models)) {
                toast(t('toast_sync_models_success'), 'success')
              }
            } catch { toast(t('toast_sync_models_failed'), 'error') }
          }}>{t('btn_sync_models')}</button>
        )}
      </div>
      <div className="set-card">
        <div className="set-row">
          <div className="label"><b>{t('sett_default_model_label')}</b><p>{t('sett_default_model_desc')}</p></div>
          <div className="control">
            <select className="select" value={form.defaultModel} onChange={(e) => set('defaultModel', e.target.value)} aria-label={t('sett_default_model_label')}>{modelOptions(form.customDefaultModel)}</select>
            {form.defaultModel === 'custom' && <input className="input" value={form.customDefaultModel} onChange={(e) => set('customDefaultModel', e.target.value)} placeholder="custom model id" style={{ marginTop: 6 }} aria-label={t('sett_default_model_label')} />}
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_alias_sonnet')}</b><p>{t('sett_alias_sonnet_desc')}</p></div>
          <div className="control">
            <div className="row gap-2">
              <select className="select" value={form.sonnetAlias} onChange={(e) => set('sonnetAlias', e.target.value)} aria-label={t('sett_alias_sonnet')}>{modelOptions(form.customSonnetAlias)}</select>
              <span className="tag blue">{t('sett_model_thinking')}</span>
              <span className="tag">{t('sett_model_cache')}</span>
            </div>
            {form.sonnetAlias === 'custom' && <input className="input" value={form.customSonnetAlias} onChange={(e) => set('customSonnetAlias', e.target.value)} style={{ marginTop: 6 }} aria-label={t('sett_alias_sonnet')} />}
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_alias_haiku')}</b><p>{t('sett_alias_haiku_desc')}</p></div>
          <div className="control">
            <select className="select" value={form.haikuAlias} onChange={(e) => set('haikuAlias', e.target.value)} aria-label={t('sett_alias_haiku')}>{modelOptions(form.customHaikuAlias)}</select>
            {form.haikuAlias === 'custom' && <input className="input" value={form.customHaikuAlias} onChange={(e) => set('customHaikuAlias', e.target.value)} style={{ marginTop: 6 }} aria-label={t('sett_alias_haiku')} />}
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_alias_opus')}</b><p>{t('sett_alias_opus_desc')}</p></div>
          <div className="control">
            <select className="select" value={form.opusAlias} onChange={(e) => set('opusAlias', e.target.value)} aria-label={t('sett_alias_opus')}>{modelOptions(form.customOpusAlias)}</select>
            {form.opusAlias === 'custom' && <input className="input" value={form.customOpusAlias} onChange={(e) => set('customOpusAlias', e.target.value)} style={{ marginTop: 6 }} aria-label={t('sett_alias_opus')} />}
          </div>
        </div>
      </div>
    </section>
  )
}
