import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AccountPopover } from '../AccountPopover'

// Mock the i18n hook
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

describe('AccountPopover', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    profile: 'test-user',
    onThemeToggle: vi.fn(),
  }

  it('renders when open', () => {
    render(<AccountPopover {...defaultProps} />)
    expect(screen.getByText('test-user')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<AccountPopover {...defaultProps} open={false} />)
    expect(screen.queryByText('test-user')).not.toBeInTheDocument()
  })

  it('displays user avatar with first letter', () => {
    render(<AccountPopover {...defaultProps} />)
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('displays menu items', () => {
    render(<AccountPopover {...defaultProps} />)
    expect(screen.getByText('nav_settings')).toBeInTheDocument()
    expect(screen.getByText('cmd_toggle_theme')).toBeInTheDocument()
    expect(screen.getByText('shortcuts_title')).toBeInTheDocument()
    expect(screen.getByText('dash_refresh')).toBeInTheDocument()
  })

  it('calls onNavigate when Settings is clicked', () => {
    const onNavigate = vi.fn()
    render(<AccountPopover {...defaultProps} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByText('nav_settings'))

    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('calls onThemeToggle when theme toggle is clicked', () => {
    const onThemeToggle = vi.fn()
    render(<AccountPopover {...defaultProps} onThemeToggle={onThemeToggle} />)

    fireEvent.click(screen.getByText('cmd_toggle_theme'))

    expect(onThemeToggle).toHaveBeenCalled()
  })

  it('calls onClose when clicking outside', () => {
    const onClose = vi.fn()
    const { container } = render(<AccountPopover {...defaultProps} onClose={onClose} />)

    // Click outside the popover
    fireEvent.mouseDown(document.body)

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<AccountPopover {...defaultProps} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
