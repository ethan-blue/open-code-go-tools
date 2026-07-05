/**
 * ModelDropdown — v4-design native dropdown for picking one or many models.
 *
 * Replaces the old chip-button group (`.model-multi`) and the bare `<input>` +
 * `<datalist>` pattern. The trigger shows the current value(s) as a comma
 * separated string; the panel exposes a searchable list with per-option
 * protocol tags and lets the user type in custom values that aren't listed.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { ProviderProtocol } from '@/lib/types'

export interface ModelDropdownProps {
  id?: string
  /** Currently selected value(s). Single mode → one model name; multi mode → comma separated. */
  value: string
  options: string[]
  /** Optional per-model protocol tag, surfaced as a small label next to each option. */
  protocols?: Partial<Record<string, ProviderProtocol>>
  multiple?: boolean
  placeholder?: string
  disabled?: boolean
  /** When true the panel also shows a free-text input so users can add values not in `options`. */
  allowCustom?: boolean
  onChange: (value: string) => void
}

function splitList(raw: string): string[] {
  return raw.split(',').map(v => v.trim()).filter(Boolean)
}

function joinList(values: string[]): string {
  return Array.from(new Set(values)).join(', ')
}

function protocolLabel(protocol?: ProviderProtocol): string {
  switch (protocol) {
    case 'anthropic': return 'Claude'
    case 'openai-chat': return 'Chat'
    case 'openai-responses': return 'Responses'
    case 'custom': return 'Custom'
    default: return ''
  }
}

export function ModelDropdown({
  id,
  value,
  options,
  protocols = {},
  multiple = false,
  placeholder = '',
  disabled = false,
  allowCustom = true,
  onChange,
}: ModelDropdownProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => splitList(value), [value])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus the search box whenever the panel opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      const t = setTimeout(() => searchRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.toLowerCase().includes(q))
  }, [options, query])

  const displayValue = value.trim()
  const canAddCustom = allowCustom && query.trim() && !options.some(o => o.toLowerCase() === query.trim().toLowerCase())

  const toggle = (model: string) => {
    if (multiple) {
      const exists = selected.includes(model)
      onChange(joinList(exists ? selected.filter(v => v !== model) : [...selected, model]))
    } else {
      onChange(model)
      setOpen(false)
    }
  }

  const addCustom = () => {
    const v = query.trim()
    if (!v) return
    if (multiple) {
      if (!selected.includes(v)) onChange(joinList([...selected, v]))
    } else {
      onChange(v)
      setOpen(false)
    }
    setQuery('')
  }

  const clearAll = () => {
    onChange('')
  }

  return (
    <div className={`model-dropdown${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className={`model-dropdown-trigger input prov-input${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`model-dropdown-value${displayValue ? '' : ' muted'}`}>
          {displayValue || placeholder}
        </span>
        <span className="model-dropdown-caret">
          {multiple && selected.length > 0 ? (
            <span
              className="model-dropdown-clear"
              role="button"
              tabIndex={-1}
              aria-label="clear"
              onClick={(e) => { e.stopPropagation(); clearAll() }}
            >
              <X width={13} height={13} />
            </span>
          ) : null}
          <ChevronDown width={14} height={14} className={open ? 'caret-flip' : ''} />
        </span>
      </button>

      {open && (
        <div className="model-dropdown-panel" role="listbox" aria-multiselectable={multiple}>
          <div className="model-dropdown-search">
            <Search width={13} height={13} />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (canAddCustom) addCustom()
                  else if (filtered.length === 1) toggle(filtered[0])
                }
              }}
              placeholder={allowCustom ? t('model_dropdown_search_custom') : t('model_dropdown_search')}
            />
            {canAddCustom && (
              <button type="button" className="model-dropdown-add" onClick={addCustom}>
                {t('model_dropdown_add')}
              </button>
            )}
          </div>

          <div className="model-dropdown-list">
            {filtered.length === 0 && !canAddCustom ? (
              <div className="model-dropdown-empty">{t('model_dropdown_empty')}</div>
            ) : (
              filtered.map(model => {
                const on = selected.includes(model)
                const tag = protocolLabel(protocols[model])
                return (
                  <button
                    key={model}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`model-dropdown-item${on ? ' on' : ''}`}
                    onClick={() => toggle(model)}
                    title={model}
                  >
                    <span className="model-dropdown-check">{on && <Check width={13} height={13} />}</span>
                    <span className="model-dropdown-item-name">{model}</span>
                    {tag && <small className="model-dropdown-item-tag">{tag}</small>}
                  </button>
                )
              })
            )}
            {canAddCustom && (
              <button
                type="button"
                className="model-dropdown-item custom"
                onClick={addCustom}
                title={`${t('model_dropdown_use')} "${query.trim()}"`}
              >
                <span className="model-dropdown-check" />
                <span className="model-dropdown-item-name">{t('model_dropdown_use')} "{query.trim()}"</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ModelDropdown
