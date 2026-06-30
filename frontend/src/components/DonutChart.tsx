import { useI18n } from '@/i18n'
import type { ModelStats } from '@/lib/types'

const DONUT_COLORS = ['var(--ink-500)', 'var(--ink-400)', 'var(--ink-300)', 'var(--ink-600)', 'var(--ink-200)', 'var(--ink-700)', 'var(--ink-100)']

export function DonutChart({ models, className }: { models: ModelStats[]; className?: string }) {
  const { t } = useI18n()
  const total = models.reduce((s, m) => s + m.total_tokens, 0)
  const r = 54, sw = 16, cx = 64, cy = 64
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className={`pie ${className || ''}`}>
      <div className="ring tm-relative">
        <svg viewBox="0 0 128 128" width="140" height="140">
          {models.map((m, i) => {
            const pct = total > 0 ? m.total_tokens / total : 0
            const dash = pct * circ
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={sw}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset} />
            )
            offset += dash
            return el
          })}
          <circle cx={cx} cy={cy} r={r - sw / 2} fill="var(--paper, #fff)" />
        </svg>
        <div className="tm-donut-center">
          <span className="tm-donut-count">{models.length}</span>
          <span className="tm-donut-label">{t('sessions_models')}</span>
        </div>
      </div>
      <div className="legend2">
        {models.map((m, i) => (
          <div className="row" key={i}>
            <span className="sw" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="nm">{m.name}</span>
            <span className="vv">{m.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
