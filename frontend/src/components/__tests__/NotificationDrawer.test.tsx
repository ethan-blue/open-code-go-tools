import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NotificationDrawer } from '../NotificationDrawer'

// Mock the i18n hook
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

// Mock the toast hook
vi.mock('@/hooks/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}))

// Mock the wails module
vi.mock('@/lib/wails', () => ({
  apiGet: vi.fn().mockResolvedValue({}),
}))

// Mock the utils module
vi.mock('@/lib/utils', () => ({
  fmtTokens: (n: number) => `${n} tokens`,
  fmtCost: (n: number) => `$${n.toFixed(4)}`,
}))

describe('NotificationDrawer', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  it('renders when open', () => {
    render(<NotificationDrawer {...defaultProps} />)
    expect(screen.getByText('notif_title')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<NotificationDrawer {...defaultProps} open={false} />)
    expect(screen.queryByText('notif_title')).not.toBeInTheDocument()
  })

  it('displays close button', () => {
    render(<NotificationDrawer {...defaultProps} />)
    expect(screen.getByLabelText('aria_close')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<NotificationDrawer {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('aria_close'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<NotificationDrawer {...defaultProps} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('displays loading spinner', () => {
    render(<NotificationDrawer {...defaultProps} />)
    expect(document.querySelector('.spin')).toBeInTheDocument()
  })
})
