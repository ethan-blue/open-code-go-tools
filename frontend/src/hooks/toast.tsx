import { createContext, useContext, useCallback, useState, type ReactNode } from 'react'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { useI18n } from '@/i18n'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} })

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t: ti } = useI18n()
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dismiss = useCallback((id: number) => {
    // add .out class for exit animation, then remove after animation ends
    const el = document.querySelector(`[data-toast-id="${id}"]`)
    if (el) {
      el.classList.add('out')
      setTimeout(() => remove(id), 200)
    } else {
      remove(id)
    }
  }, [remove])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => dismiss(id), type === 'error' ? 5000 : 3500)
  }, [dismiss])

  const icons = { success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info }
  const iconColors = { success: 'var(--online)', error: 'var(--danger)', warning: 'var(--warn)', info: 'var(--link)' }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div id="toast" aria-live="polite" role="status">
        {toasts.map((t) => {
          const Icon = icons[t.type]
          return (
            <div key={t.id} data-toast-id={t.id} className="toast fade-enter" role="alert">
              <span className="ic" style={{ color: iconColors[t.type] }}><Icon width={15} height={15} /></span>
              <div>
                <b>{t.type === 'error' ? ti('toast_error') : t.type === 'success' ? ti('toast_success') : ti('toast_notice')}</b>
                <p>{t.message}</p>
              </div>
              <button className="close" onClick={() => dismiss(t.id)} aria-label={ti('aria_close')}><X width={14} height={14} /></button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
