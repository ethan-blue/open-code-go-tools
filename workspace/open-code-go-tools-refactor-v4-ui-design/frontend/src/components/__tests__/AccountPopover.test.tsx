import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AccountPopover } from '../AccountPopover'

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
    expect(screen.getByText('sett_s05_title')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<AccountPopover {...defaultProps} open={false} />)
    expect(screen.queryByText('sett_s05_title')).not.toBeInTheDocument()
  })

  it('displays menu items', () => {
    render(<AccountPopover {...defaultProps} />)
    expect(screen.getByText('sett_s05_title')).toBeInTheDocument()
    expect(screen.getByText('sett_theme_label')).toBeInTheDocument()
    expect(screen.getByText('shortcuts_title')).toBeInTheDocument()
    expect(screen.getByText('dash_refresh')).toBeInTheDocument()
  })

  it('calls onNavigate when Preferences is clicked', () => {
    const onNavigate = vi.fn()
    render(<AccountPopover {...defaultProps} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByText('sett_s05_title'))

    expect(onNavigate).toHaveBeenCalledWith('preferences')
  })

  it('calls onNavigate to preferences when Theme is clicked', () => {
    const onNavigate = vi.fn()
    render(<AccountPopover {...defaultProps} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByText('sett_theme_label'))

    expect(onNavigate).toHaveBeenCalledWith('preferences')
  })

  it('calls onClose when clicking outside', () => {
    const onClose = vi.fn()
    render(<AccountPopover {...defaultProps} onClose={onClose} />)

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
