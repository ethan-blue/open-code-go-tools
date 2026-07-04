import { useCallback } from 'react'

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
