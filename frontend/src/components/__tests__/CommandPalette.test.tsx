import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CommandPalette } from '../CommandPalette'

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

describe('CommandPalette', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  }

  it('renders when open', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<CommandPalette {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('displays search input', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByPlaceholderText('cmd_placeholder')).toBeInTheDocument()
  })

  it('displays navigation items', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByText('cmd_goto_dashboard')).toBeInTheDocument()
    expect(screen.getByText('cmd_goto_traffic')).toBeInTheDocument()
    expect(screen.getByText('cmd_goto_sessions')).toBeInTheDocument()
  })

  it('displays action items', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByText('cmd_export_traffic')).toBeInTheDocument()
    expect(screen.queryByText('cmd_restart_proxy')).not.toBeInTheDocument()
    expect(screen.queryByText('cmd_toggle_theme')).not.toBeInTheDocument()
  })

  it('routes settings command to a real view', () => {
    const listener = vi.fn()
    window.addEventListener('nav-to', listener)
    render(<CommandPalette {...defaultProps} />)

    fireEvent.click(screen.getByText('cmd_open_settings'))

    expect(listener.mock.calls[0][0].detail).toBe('preferences')
    window.removeEventListener('nav-to', listener)
  })

  it('filters items based on search query', () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('cmd_placeholder')

    fireEvent.change(input, { target: { value: 'dashboard' } })

    expect(screen.getByText('cmd_goto_dashboard')).toBeInTheDocument()
    expect(screen.queryByText('cmd_goto_traffic')).not.toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps} onClose={onClose} />)

    // Click on the backdrop (the outer div with id="palette")
    const backdrop = document.getElementById('palette')
    fireEvent.click(backdrop!)

    expect(onClose).toHaveBeenCalled()
  })

  it('navigates with arrow keys', () => {
    render(<CommandPalette {...defaultProps} />)

    // Get all item elements
    const items = document.querySelectorAll('.item')

    // First item should be selected by default
    expect(items[0]).toHaveClass('on')

    // Press ArrowDown to select second item
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    // Second item should now be selected
    expect(items[1]).toHaveClass('on')
  })

  it('selects item with Enter key', () => {
    render(<CommandPalette {...defaultProps} />)

    fireEvent.keyDown(window, { key: 'Enter' })

    // Should trigger navigation
  })
})
