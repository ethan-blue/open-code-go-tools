import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useI18n } from '@/i18n'

/**
 * Reusable confirmation modal — replaces the OS-native `confirm()` dialog so
 * destructive actions (remove client integration, delete provider, ...) match
 * the rest of the app's v4 modal styling. Visually identical to the close
 * dialog and QuickSetupModal: same `.modal-overlay.on` / `.modal` shell.
 *
 * Escape key and overlay-click both cancel, matching the other modals.
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** Red confirm button — for destructive actions (remove / delete). */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()

  // Escape cancels, just like the native confirm() and the other app modals.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="modal-overlay on"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()} role="document">
        <div className="mh">
          {danger && <AlertTriangle width={16} height={16} className="prov-add-icon-gap" style={{ color: 'var(--danger)' }} />}
          <h3 id="confirm-modal-title">{title}</h3>
        </div>
        {message && (
          <div className="mb">
            <p style={{ margin: 0, color: 'var(--ink-600)', fontSize: 13 }}>{message}</p>
          </div>
        )}
        <div className="mf">
          <button className="btn btn-sm" onClick={onCancel}>{cancelText || t('cancel')}</button>
          <button
            className={danger ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText || t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
