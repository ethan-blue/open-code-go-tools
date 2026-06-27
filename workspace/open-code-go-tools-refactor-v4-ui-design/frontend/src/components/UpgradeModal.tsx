import { memo } from 'react'
import { X, Download, Sparkles } from 'lucide-react'
import { useI18n } from '@/i18n'

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  currentVersion: string
  newVersion: string
}

export const UpgradeModal = memo(function UpgradeModal({ open, onClose, currentVersion, newVersion }: UpgradeModalProps) {
  const { t } = useI18n()
  if (!open) return null

  const features = t('upgrade_features').split(',')

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Upgrade">
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()} role="document">
        <div className="mh">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles width={16} height={16} style={{ color: 'var(--link)' }} />
            <h3>{t('upgrade_title')}</h3>
          </div>
          <span className="spacer" />
          <span className="muted tiny">{currentVersion} → </span>
          <span className="tag blue">{newVersion}</span>
          <button className="x" style={{ marginLeft: 6 }} onClick={onClose} aria-label={t('aria_close')}><X width={16} height={16} /></button>
        </div>
        <div className="mb">
          <div className="changelog">
            <div className="ver">
              <div className="meta"><b>{newVersion}</b></div>
              <ul>{features.map((f, i) => <li key={i}>{f.trim()}</li>)}</ul>
            </div>
          </div>
        </div>
        <div className="mf">
          <button className="btn btn-sm" onClick={onClose}>{t('upgrade_later')}</button>
          <button className="btn btn-sm btn-primary" onClick={() => { window.open('https://github.com/ethan-blue/open-code-go-tools/releases', '_blank'); onClose() }}>
            <Download width={13} height={13} /> {t('upgrade_download')}
          </button>
        </div>
      </div>
    </div>
  )
})
