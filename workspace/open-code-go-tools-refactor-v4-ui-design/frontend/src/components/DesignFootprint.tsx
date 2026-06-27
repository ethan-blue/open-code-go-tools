import { useI18n } from '@/i18n'

const SWATCHES = [
  { name: 'ink-0', bg: '#fff', border: true },
  { name: 'ink-100', bg: 'var(--ink-100)' },
  { name: 'ink-300', bg: 'var(--ink-300)' },
  { name: 'ink-500', bg: 'var(--ink-500)' },
  { name: 'ink-700', bg: 'var(--ink-700)' },
  { name: 'ink-950', bg: 'var(--ink-950)' },
  { name: 'link', bg: 'var(--link)' },
  { name: 'online', bg: 'var(--online)' },
  { name: 'warn', bg: 'var(--warn)' },
  { name: 'danger', bg: 'var(--danger)' },
]

export default function DesignFootprint() {
  const { t } = useI18n()

  return (
    <footer id="footprint">
      <div className="ft-row">
        <div>
          <div className="ft-eyebrow">DESIGN SYSTEM</div>
          <h2 className="ft-title">Tokens, type and motion.</h2>
          <p className="ft-lede">A single source of truth for color, spacing, radius and elevation. Every component opts into the token layer — no hex codes in product code.</p>
        </div>
        <div className="ft-swatches">
          {SWATCHES.map((s) => (
            <div className="sw" key={s.name}>
              <div className="chip" style={{ background: s.bg, border: s.border ? '1px solid var(--line)' : undefined }} />
              <span className="mono tiny">{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ft-grid">
        <div className="ft-cell">
          <div className="ft-h">Typography</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, marginBottom: 6 }}>Serif heading</div>
          <div style={{ fontSize: 13, color: 'var(--ink-600)' }}>Body text with <code className="inl">mono</code> inline code</div>
        </div>
        <div className="ft-cell">
          <div className="ft-h">Spacing</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ width: 8, height: 8, background: 'var(--ink-300)', borderRadius: 2 }} />
            <div style={{ width: 14, height: 14, background: 'var(--ink-400)', borderRadius: 3 }} />
            <div style={{ width: 20, height: 20, background: 'var(--ink-500)', borderRadius: 4 }} />
            <div style={{ width: 28, height: 28, background: 'var(--ink-600)', borderRadius: 5 }} />
          </div>
        </div>
        <div className="ft-cell">
          <div className="ft-h">Radius</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 36, height: 36, border: '2px solid var(--ink-400)', borderRadius: 4 }} />
            <div style={{ width: 36, height: 36, border: '2px solid var(--ink-400)', borderRadius: 8 }} />
            <div style={{ width: 36, height: 36, border: '2px solid var(--ink-400)', borderRadius: 14 }} />
            <div style={{ width: 36, height: 36, border: '2px solid var(--ink-400)', borderRadius: '50%' }} />
          </div>
        </div>
        <div className="ft-cell">
          <div className="ft-h">Elevation</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: '#fff', borderRadius: 6, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }} />
            <div style={{ width: 36, height: 36, background: '#fff', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }} />
            <div style={{ width: 36, height: 36, background: '#fff', borderRadius: 6, boxShadow: 'var(--sh-pop)' }} />
          </div>
        </div>
      </div>

      <div className="ft-mark">
        <div>
          <div className="big-mono">ocgt</div>
          <div className="big-serif">v4</div>
        </div>
        <div className="ft-mark-r">
          <div className="mono tiny muted">{t('footer_text')}</div>
          <div className="mono tiny muted" style={{ marginTop: 4 }}>No hex codes in product code.</div>
        </div>
      </div>
    </footer>
  )
}
