import { useState, useEffect } from 'react'
import { useI18n } from '@/i18n'
import { apiGet } from '@/lib/wails'

export default function AboutPage() {
  const { t } = useI18n()
  const [version, setVersion] = useState('v4.0.0')

  useEffect(() => {
    apiGet('/ocgt/api/version').then((d) => { if (d?.version) setVersion(`v${d.version}`) }).catch(() => {})
  }, [])

  return (
    <div>
      <div className="set-top">
        <div><h2 className="set-section-title">{t('sett_section_about')}</h2><p className="set-subtitle">{t('sett_section_about_desc')}</p></div>
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
        </div>
      </section>
    </div>
  )
}
