import { useCallback } from 'react'

type ViewId =
  | 'dashboard' | 'history' | 'sessions' | 'copilot'
  | 'terminal' | 'providers'
  | 'model-mapping' | 'runtime-rules' | 'security' | 'plugins' | 'hub'
  | 'preferences' | 'logs' | 'backups' | 'about'
  | 'detail'

/** Navigate to a view via CustomEvent (consumed by App.tsx). */
export function useNavTo() {
  return useCallback((view: string) => {
    window.dispatchEvent(new CustomEvent('nav-to', { detail: view }))
  }, [])
}

/** Navigate to traffic detail via CustomEvent (consumed by App.tsx). */
export function useNavToDetail() {
  return useCallback((record: unknown) => {
    window.dispatchEvent(new CustomEvent('nav-to-detail', { detail: record }))
  }, [])
}
