import { useEffect, useRef } from 'react'
import { Settings, Keyboard, Palette, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n'

interface AccountPopoverProps {
  open: boolean
  onClose: () => void
  onNavigate: (view: string) => void
  profile: string
  onThemeToggle: () => void
}

export function AccountPopover({ open, onClose, onNavigate, profile, onThemeToggle }: AccountPopoverProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="popover on" ref={ref}>
      <div className="it" role="button" tabIndex={0} onClick={() => { onNavigate('preferences'); onClose() }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate('preferences'); onClose() } }}>
        <Settings width={14} height={14} className="ic" />
        {t('sett_s05_title')}
      </div>
      <div className="it" role="button" tabIndex={0} onClick={() => { onNavigate('preferences'); onClose() }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate('preferences'); onClose() } }}>
        <Palette width={14} height={14} className="ic" />
        {t('sett_theme_label')}
      </div>
      <div className="it" role="button" tabIndex={0} onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('show-shortcuts')) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose(); window.dispatchEvent(new CustomEvent('show-shortcuts')) } }}>
        <Keyboard width={14} height={14} className="ic" />
        {t('shortcuts_title')}
      </div>
      <hr />
      <div className="it" role="button" tabIndex={0} onClick={() => { onClose(); if ((window as any).runtime) (window as any).runtime.EventsEmit('restart-proxy') }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose(); if ((window as any).runtime) (window as any).runtime.EventsEmit('restart-proxy') } }}>
        <RefreshCw width={14} height={14} className="ic" />
        {t('dash_refresh')}
      </div>
    </div>
  )
}
