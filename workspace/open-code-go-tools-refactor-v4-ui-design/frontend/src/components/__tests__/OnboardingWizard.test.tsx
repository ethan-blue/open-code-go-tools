import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OnboardingWizard } from '../OnboardingWizard'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

vi.mock('@/hooks/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/wails', () => ({
  wails: {
    FetchUpstreamModels: vi.fn().mockResolvedValue({ models: ['model1', 'model2'] }),
    SaveOnboarding: vi.fn().mockResolvedValue(undefined),
  },
  apiGet: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/utils', () => ({
  errMessage: (err: any) => err.message || 'Error',
}))

describe('OnboardingWizard', () => {
  const defaultProps = { open: true, onClose: vi.fn() }

  it('renders when open', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByText('onboarding_title')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<OnboardingWizard {...defaultProps} open={false} />)
    expect(screen.queryByText('onboarding_title')).not.toBeInTheDocument()
  })

  it('displays system detection step by default (step 0)', () => {
    render(<OnboardingWizard {...defaultProps} />)
    // Step 0 shows system detection
    expect(screen.getByText(/onboarding_step0_title|System Detection/)).toBeInTheDocument()
  })

  it('displays step indicator with 4 steps', () => {
    render(<OnboardingWizard {...defaultProps} />)
    // Should have 4 step indicators
    const stepIndicators = document.querySelectorAll('.step')
    expect(stepIndicators.length).toBe(4)
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<OnboardingWizard {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    render(<OnboardingWizard {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('aria_close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('has a Next button on first step', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByText('td_next')).toBeInTheDocument()
  })

  it('has a Close button on first step', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByText('about_close')).toBeInTheDocument()
  })
})
