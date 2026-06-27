import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SecuritySection } from '../SecuritySection'
import { DEFAULT_FORM, type FormState } from '../types'

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

function makeForm(overrides: Partial<FormState> = {}): FormState {
  return { ...DEFAULT_FORM, ...overrides }
}

describe('SecuritySection', () => {
  const mockSet = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the auth toggle and rate limit inputs', () => {
    render(<SecuritySection form={makeForm({ rateLimitingEnabled: true })} set={mockSet} />)
    expect(screen.getByRole('switch', { name: 'sett_auth_enabled' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'sett_rate_limiting' })).toBeInTheDocument()
    expect(screen.getByLabelText('sett_rate_sec')).toBeInTheDocument()
    expect(screen.getByLabelText('sett_rate_burst')).toBeInTheDocument()
    expect(screen.getByLabelText('sett_rate_minute')).toBeInTheDocument()
  })

  it('auth toggle click changes form state', () => {
    render(<SecuritySection form={makeForm({ authEnabled: false })} set={mockSet} />)
    const toggle = screen.getByRole('switch', { name: 'sett_auth_enabled' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(mockSet).toHaveBeenCalledWith('authEnabled', true)
  })

  it('rate-limiting toggle click changes form state', () => {
    render(<SecuritySection form={makeForm({ rateLimitingEnabled: false })} set={mockSet} />)
    const toggle = screen.getByRole('switch', { name: 'sett_rate_limiting' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(mockSet).toHaveBeenCalledWith('rateLimitingEnabled', true)
  })

  it('rate limit inputs are disabled (pointer-events none) when rate limiting is off', () => {
    render(<SecuritySection form={makeForm({ rateLimitingEnabled: false })} set={mockSet} />)
    const input = screen.getByLabelText('sett_rate_sec')
    // The wrapper div that gates the rate-limit rows sits above each .set-row
    const wrapper = input.closest('.set-row')!.parentElement as HTMLElement
    expect(wrapper.style.pointerEvents).toBe('none')
  })

  it('rate limit inputs are enabled (pointer-events auto) when rate limiting is on', () => {
    render(<SecuritySection form={makeForm({ rateLimitingEnabled: true })} set={mockSet} />)
    const input = screen.getByLabelText('sett_rate_sec')
    const wrapper = input.closest('.set-row')!.parentElement as HTMLElement
    expect(wrapper.style.pointerEvents).toBe('auto')
  })
})
