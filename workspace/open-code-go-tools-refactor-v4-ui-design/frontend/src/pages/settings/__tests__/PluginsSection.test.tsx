import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PluginsSection } from '../PluginsSection'
import { DEFAULT_FORM, type FormState } from '../types'

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

function makeForm(overrides: Partial<FormState> = {}): FormState {
  return { ...DEFAULT_FORM, ...overrides }
}

describe('PluginsSection', () => {
  const mockSet = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the plugin list (web_search, auto_compress, session_save)', () => {
    render(<PluginsSection form={makeForm()} set={mockSet} />)
    expect(screen.getByText('plugin_web_search_title')).toBeInTheDocument()
    expect(screen.getByText('plugin_auto_compress_title')).toBeInTheDocument()
    expect(screen.getByText('plugin_session_save_title')).toBeInTheDocument()
  })

  it('renders a toggle for each plugin', () => {
    render(<PluginsSection form={makeForm()} set={mockSet} />)
    expect(screen.getByRole('switch', { name: 'plugin_web_search_title' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'plugin_auto_compress_title' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'plugin_session_save_title' })).toBeInTheDocument()
  })

  it('toggle click changes plugin enabled state', () => {
    render(<PluginsSection form={makeForm({ plugins: { web_search: false } })} set={mockSet} />)
    const toggle = screen.getByRole('switch', { name: 'plugin_web_search_title' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(mockSet).toHaveBeenCalledWith('plugins', { web_search: true })
  })

  it('reflects enabled state for an enabled plugin', () => {
    render(<PluginsSection form={makeForm({ plugins: { web_search: true } })} set={mockSet} />)
    const toggle = screen.getByRole('switch', { name: 'plugin_web_search_title' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('plugin_status_active')).toBeInTheDocument()
  })

  it('shows inactive status for a disabled plugin', () => {
    render(<PluginsSection form={makeForm({ plugins: {} })} set={mockSet} />)
    expect(screen.getAllByText('plugin_status_inactive').length).toBeGreaterThan(0)
  })
})
