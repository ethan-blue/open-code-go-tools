import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OnboardingWizard } from '../OnboardingWizard'

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
  wails: {
    FetchUpstreamModels: vi.fn().mockResolvedValue({ models: ['model1', 'model2'] }),
    SaveOnboarding: vi.fn().mockResolvedValue(undefined),
  },
  apiGet: vi.fn().mockResolvedValue({}),
}))

// Mock the utils module
vi.mock('@/lib/utils', () => ({
  errMessage: (err: any) => err.message || 'Error',
}))

describe('OnboardingWizard', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  it('renders when open', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByText('onboarding_title')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<OnboardingWizard {...defaultProps} open={false} />)
    expect(screen.queryByText('onboarding_title')).not.toBeInTheDocument()
  })

  it('displays step 1 by default', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByText('onboarding_step1_title')).toBeInTheDocument()
  })

  it('displays upstream input field', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByDisplayValue('https://opencode.ai/zen/go')).toBeInTheDocument()
  })

  it('displays API key input field', () => {
    render(<OnboardingWizard {...defaultProps} />)
    expect(screen.getByPlaceholderText('placeholder_api_key')).toBeInTheDocument()
  })

  it('navigates to step 2 when Next is clicked', () => {
    render(<OnboardingWizard {...defaultProps} />)

    fireEvent.click(screen.getByText('td_next'))

    expect(screen.getByText('onboarding_step2_title')).toBeInTheDocument()
  })

  it('navigates back to step 1 when Back is clicked', () => {
    render(<OnboardingWizard {...defaultProps} />)

    // Go to step 2
    fireEvent.click(screen.getByText('td_next'))
    // Go back to step 1
    fireEvent.click(screen.getByText('td_prev'))

    expect(screen.getByText('onboarding_step1_title')).toBeInTheDocument()
  })

  it('displays model selection in step 2', () => {
    render(<OnboardingWizard {...defaultProps} />)

    // Go to step 2
    fireEvent.click(screen.getByText('td_next'))

    expect(screen.getByText('sett_default_model')).toBeInTheDocument()
    expect(screen.getByText('sett_mapping_sonnet')).toBeInTheDocument()
    expect(screen.getByText('sett_mapping_haiku')).toBeInTheDocument()
    expect(screen.getByText('sett_mapping_opus')).toBeInTheDocument()
  })

  it('displays client installation options in step 3', () => {
    render(<OnboardingWizard {...defaultProps} />)

    // Go to step 3
    fireEvent.click(screen.getByText('td_next'))
    fireEvent.click(screen.getByText('td_next'))

    expect(screen.getByText('int_sys_title')).toBeInTheDocument()
    expect(screen.getByText('int_vscode_title')).toBeInTheDocument()
    expect(screen.getByText('int_claude_desktop_title')).toBeInTheDocument()
    expect(screen.getByText('int_codex_title')).toBeInTheDocument()
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

    // Find the X button (close button) by its aria-label
    const closeButton = screen.getByLabelText('aria_close')
    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalled()
  })
})
