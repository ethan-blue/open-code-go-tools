import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ShortcutsModal } from '../ShortcutsModal'

// Mock the i18n hook
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

// Mock the platform utility
vi.mock('@/lib/platform', () => ({
  isMacOS: () => false,
}))

describe('ShortcutsModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  it('renders when open', () => {
    render(<ShortcutsModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<ShortcutsModal {...defaultProps} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('displays shortcuts title', () => {
    render(<ShortcutsModal {...defaultProps} />)
    expect(screen.getByRole('heading', { name: 'cmd_shortcuts' })).toBeInTheDocument()
  })

  it('displays navigation shortcuts section', () => {
    render(<ShortcutsModal {...defaultProps} />)
    expect(screen.getByText('cmd_navigate')).toBeInTheDocument()
  })

  it('displays action shortcuts section', () => {
    render(<ShortcutsModal {...defaultProps} />)
    expect(screen.getByText('cmd_actions')).toBeInTheDocument()
  })

  it('displays keyboard shortcuts', () => {
    render(<ShortcutsModal {...defaultProps} />)

    // Check for some key shortcuts
    expect(screen.getByText('nav_dashboard')).toBeInTheDocument()
    expect(screen.getByText('nav_settings')).toBeInTheDocument()
    expect(screen.getByText('nav_terminal')).toBeInTheDocument()
    expect(screen.getByText('nav_history')).toBeInTheDocument()
  })

  it('displays close button', () => {
    render(<ShortcutsModal {...defaultProps} />)
    expect(screen.getByText('about_close')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsModal {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByText('about_close'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ShortcutsModal {...defaultProps} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsModal {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalled()
  })

  it('displays keyboard shortcuts with correct format', () => {
    render(<ShortcutsModal {...defaultProps} />)

    // Check that keyboard shortcuts are displayed
    const kbdElements = screen.getAllByText(/Ctrl/)
    expect(kbdElements.length).toBeGreaterThan(0)
  })
})
