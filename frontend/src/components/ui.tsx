/**
 * UI Primitive Components — v4-design native (no Tailwind)
 */
import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'

// — Button —
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        variant === 'danger-ghost' && 'btn-danger-ghost',
        size === 'sm' && 'btn-sm',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

// — Card —
export function Card({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn('card', className)}>
      {children}
    </div>
  )
}

// — Badge —
type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'accent'

export function Badge({
  variant = 'default',
  className,
  children,
}: {
  variant?: BadgeVariant
  className?: string
  children: ReactNode
}) {
  const tagClass = variant === 'success' ? 'green' : variant === 'warning' ? 'amber' : variant === 'danger' ? 'red' : variant === 'accent' ? 'blue' : ''
  return (
    <span className={cn('tag', tagClass, className)}>
      {children}
    </span>
  )
}

// — Input —
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn('input', className)} {...props} />
  ),
)
Input.displayName = 'Input'

// — Select —
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn('select', className)} {...props}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

// — Toggle Switch —
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <label className="toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('toggle', checked && 'on')}
      />
      {label && <span className="toggle-label">{label}</span>}
    </label>
  )
}

// — Spinner —
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="spinner-wrap"
      style={{ width: size, height: size }}
    />
  )
}

// — Empty State —
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div role="status" aria-label={title} className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div>
        <p className="empty-state-title">{title}</p>
        {description && <p className="empty-state-desc">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// — Status Dot —
export function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  return <span className={cn('dot', status === 'online' ? 'online' : status === 'connecting' ? 'warn' : 'off')} />
}

// — Skeleton —
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skel', className)} style={style} aria-hidden="true" />
}
