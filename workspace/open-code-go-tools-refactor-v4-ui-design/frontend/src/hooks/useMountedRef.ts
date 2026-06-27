import { useEffect, useRef } from 'react'

/**
 * Returns a ref that is `true` while the component is mounted.
 * Use inside async callbacks to guard setState calls.
 *
 * @example
 * const mounted = useMountedRef()
 * const data = await fetchSomething()
 * if (mounted.current) setData(data)
 */
export function useMountedRef() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}
