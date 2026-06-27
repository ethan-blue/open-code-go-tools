import { useI18n } from '@/i18n'

interface Props {
  hubEnabled: boolean
  setHubEnabled: (v: boolean) => void
  hubUrl: string
  setHubUrl: (v: string) => void
  hubSecret: string
  setHubSecret: (v: string) => void
  hubDeviceName: string
  setHubDeviceName: (v: string) => void
  hubInterval: string
  setHubInterval: (v: string) => void
}

export function HubSection({
  hubEnabled, setHubEnabled,
  hubUrl, setHubUrl,
  hubSecret, setHubSecret,
  hubDeviceName, setHubDeviceName,
  hubInterval, setHubInterval,
}: Props) {
  const { t } = useI18n()

  return (
    <section className="set-section" id="set-06">
      <div className="head">
        <div><h3>06 · {t('sett_s06_title')}</h3><div className="sub">{t('sett_s06_sub')}</div></div>
      </div>
      <div className="set-card">
        <div className="set-row">
          <div className="label"><b>{t('pref_hub_enable')}</b><p>{t('pref_hub_desc')}</p></div>
          <div className="control">
            <button role="switch" aria-checked={hubEnabled} aria-label={t('pref_hub_enable')} className={`toggle${hubEnabled ? ' on' : ''}`} onClick={() => setHubEnabled(!hubEnabled)} type="button"><span /></button>
          </div>
        </div>
        {hubEnabled && <>
          <div className="set-row">
            <div className="label"><b>{t('pref_hub_url')}</b><p>{t('sett_hub_addr_desc')}</p></div>
            <div className="control">
              <input className="input" value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="http://192.168.1.100:17321" style={{ width: 260 }} aria-label={t('pref_hub_url')} />
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('pref_hub_secret')}</b><p>{t('sett_hub_secret_desc')}</p></div>
            <div className="control">
              <input className="input" type="password" value={hubSecret} onChange={(e) => setHubSecret(e.target.value)} placeholder={t('sett_hub_secret_placeholder')} style={{ width: 200 }} aria-label={t('pref_hub_secret')} />
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('pref_hub_device_name')}</b><p>{t('sett_hub_device_desc')}</p></div>
            <div className="control">
              <input className="input" value={hubDeviceName} onChange={(e) => setHubDeviceName(e.target.value)} placeholder="my-laptop" style={{ width: 200 }} aria-label={t('pref_hub_device_name')} />
            </div>
          </div>
          <div className="set-row">
            <div className="label"><b>{t('pref_hub_interval')}</b><p>{t('sett_hub_interval_desc')}</p></div>
            <div className="control">
              <input className="input" type="number" value={hubInterval} onChange={(e) => setHubInterval(e.target.value)} min={30} max={1800} style={{ width: 100 }} aria-label={t('pref_hub_interval')} />
            </div>
          </div>
        </>}
      </div>
    </section>
  )
}
