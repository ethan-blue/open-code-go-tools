/** Simple class name joiner (replaces tailwind-merge) */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ')
}

/** Extract error message from unknown error */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

/** Format token count: 1234567 → "1.23M" */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/** Format cost: 0.00234 → "$0.0023" */
export function fmtCost(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(2)
}

/** Format number with commas */
export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

/** Format ISO date to local time */
export function fmtDate(iso: string, locale?: string): string {
  const lang = localStorage.getItem('lang') || 'zh'
  const loc = locale || (lang === 'en' ? 'en-US' : 'zh-CN')
  const d = new Date(iso)
  return d.toLocaleString(loc, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Format relative time */
export function fmtRelative(seconds: number): string {
  const lang = localStorage.getItem('lang') || 'zh'
  if (lang === 'en') {
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
    return Math.floor(seconds / 86400) + 'd ago'
  }
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return Math.floor(seconds / 60) + '分钟前'
  if (seconds < 86400) return Math.floor(seconds / 3600) + '小时前'
  return Math.floor(seconds / 86400) + '天前'
}

/** Delay helper */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Escape HTML */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
