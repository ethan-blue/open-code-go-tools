import { useI18n } from '@/i18n'
import type { FormState, SetField } from './types'

interface Props {
  form: FormState
  set: SetField
  errors: Record<string, string>
}

export function NetworkSection({ form, set, errors }: Props) {
  const { t } = useI18n()

  return (
    <section className="set-section" id="set-03">
      <div className="head">
        <div><h3>03 · {t('sett_s03_title')}</h3><div className="sub">{t('sett_s03_sub')}</div></div>
      </div>
      <div className="set-card">
        <div className="set-row">
          <div className="label"><b>{t('sett_listen_label')}</b><p>{t('sett_listen_desc')}</p></div>
          <div className="control">
            <div className="row gap-2">
              <input className="input" value={form.listenAddr.split(':')[0]} placeholder="127.0.0.1" style={{ width: 160 }}
                onChange={(e) => {
                  const port = form.listenAddr.split(':')[1] ?? '8787'
                  set('listenAddr', `${e.target.value}:${port}`)
                }} />
              <input className="input" value={form.listenAddr.split(':')[1] ?? ''} placeholder="8787" style={{ width: 80 }}
                onChange={(e) => {
                  const host = form.listenAddr.split(':')[0] || '127.0.0.1'
                  set('listenAddr', `${host}:${e.target.value}`)
                }} />
            </div>
            {errors.listenAddr && <span className="hint" style={{ color: 'var(--danger)' }}>{errors.listenAddr}</span>}
          </div>
        </div>
        <div className="set-row">
          <div className="label"><b>{t('sett_timeout_label')}</b><p>{t('sett_timeout_desc')}</p></div>
          <div className="control">
            <input className="input" value={form.timeoutSeconds} onChange={(e) => set('timeoutSeconds', e.target.value)} style={{ width: 120 }} />
            {errors.timeoutSeconds && <span className="hint" style={{ color: 'var(--danger)' }}>{errors.timeoutSeconds}</span>}
          </div>
        </div>

      </div>
    </section>
  )
}
