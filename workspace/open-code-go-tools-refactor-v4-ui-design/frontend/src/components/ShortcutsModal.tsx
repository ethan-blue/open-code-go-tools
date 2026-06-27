import { memo, useEffect, useRef } from 'react'
import { X, Keyboard } from 'lucide-react'
import { useI18n } from '@/i18n'
import { isMacOS } from '@/lib/platform'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export const ShortcutsModal = memo(function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const { t } = useI18n()
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    if (open) {
      timerId = setTimeout(() => modalRef.current?.focus(), 50)
    }
    return () => clearTimeout(timerId)
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const mod = isMacOS() ? '⌘' : 'Ctrl'
  const shortcuts = [
    { keys: [mod, '1'], desc: t('nav_dashboard') },
    { keys: [mod, '2'], desc: t('nav_settings') },
    { keys: [mod, '3'], desc: t('nav_terminal') },
    { keys: [mod, '4'], desc: t('nav_history') },
    { keys: [mod, '5'], desc: t('nav_traffic_detail') },
    { keys: [mod, '6'], desc: t('nav_hub') },
    { keys: [mod, '7'], desc: t('nav_sessions') },
    { keys: [mod, ','], desc: t('pref_title') },
    { keys: [mod, 'N'], desc: t('onboarding_title') },
    { keys: ['?'], desc: t('cmd_shortcuts') },
    { keys: ['Esc'], desc: t('cmd_close_modal') },
  ]

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shortcuts_title')}>
      <div className="modal" onClick={(e) => e.stopPropagation()} ref={modalRef} tabIndex={-1} role="document">
        <div className="mh">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Keyboard width={16} height={16} style={{ color: 'var(--ink-500)' }} />
            <h3>{t('cmd_shortcuts') }</h3>
          </div>
          <span className="spacer" />
          <button className="x" onClick={onClose} aria-label={t('aria_close')}><X width={16} height={16} /></button>
        </div>
        <div className="mb">
          <div className="kbd-grid">
            <div className="col">
              <h6>{t('cmd_navigate')}</h6>
              {shortcuts.slice(0, 7).map((s, i) => (
                <div className="r" key={i}>
                  <span>{s.desc}</span>
                  <div className="keys">{s.keys.map((k, j) => <kbd className="kbd" key={j}>{k}</kbd>)}</div>
                </div>
              ))}
            </div>
            <div className="col">
              <h6>{t('cmd_actions')}</h6>
              {shortcuts.slice(7).map((s, i) => (
                <div className="r" key={i}>
                  <span>{s.desc}</span>
                  <div className="keys">{s.keys.map((k, j) => <kbd className="kbd" key={j}>{k}</kbd>)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mf">
          <button className="btn btn-sm" onClick={onClose}>{t('about_close')}</button>
        </div>
      </div>
    </div>
  )
})
