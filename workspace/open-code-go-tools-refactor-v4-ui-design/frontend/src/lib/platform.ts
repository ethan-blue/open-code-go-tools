/**
 * Platform detection for conditional UI rendering.
 * Detects OS at runtime for titlebar style switching.
 */

export type Platform = 'windows' | 'macos' | 'linux'

export function detectPlatform(): Platform {
  // Try modern API first
  const uaData = (navigator as any).userAgentData
  if (uaData?.platform) {
    const p = uaData.platform.toLowerCase()
    if (p === 'windows') return 'windows'
    if (p === 'macos') return 'macos'
    if (p === 'linux') return 'linux'
  }

  // Fallback to userAgent string
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac') || ua.includes('darwin')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'windows'
}

/** Singleton — computed once, cached */
let _platform: Platform | null = null
export function getPlatform(): Platform {
  if (!_platform) _platform = detectPlatform()
  return _platform
}

export function isWindows(): boolean { return getPlatform() === 'windows' }
export function isMacOS(): boolean { return getPlatform() === 'macos' }
export function isLinux(): boolean { return getPlatform() === 'linux' }
