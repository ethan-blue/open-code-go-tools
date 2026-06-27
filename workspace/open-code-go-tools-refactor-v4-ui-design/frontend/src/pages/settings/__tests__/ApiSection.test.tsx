import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiSection } from '../ApiSection'
import { DEFAULT_FORM, type FormState } from '../types'
import { wails } from '@/lib/wails'

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/wails', () => ({
  isWails: () => false,
  wails: {
    TestUpstreamConnection: vi.fn(),
    GetLocalToken: vi.fn().mockResolvedValue(''),
  },
  apiGet: vi.fn(),
  apiFetch: vi.fn(),
}))

function makeForm(overrides: Partial<FormState> = {}): FormState {
  return { ...DEFAULT_FORM, ...overrides }
}

describe('ApiSection', () => {
  const mockSet = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  const baseProps = {
    form: makeForm({ upstream: 'test.upstream', apiKey: 'test-key' }),
    set: mockSet,
    saved: DEFAULT_FORM,
  }

  it('renders the upstream input and API key input', () => {
    render(<ApiSection {...baseProps} />)
    expect(screen.getByPlaceholderText('api.anthropic.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument()
  })

  it('renders a Test Connection button that is clickable', async () => {
    vi.mocked(wails.TestUpstreamConnection).mockResolvedValue({ success: true, data: { models: [] } })
    render(<ApiSection {...baseProps} />)
    const btn = screen.getByText('sett_test_conn')
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(wails.TestUpstreamConnection).toHaveBeenCalledWith('test.upstream', 'test-key')
  })

  it('renders a Copy Token button', () => {
    render(<ApiSection {...baseProps} />)
    expect(screen.getByTitle('btn_copy')).toBeInTheDocument()
  })

  it('shows a success tag when TestUpstreamConnection returns success', async () => {
    vi.mocked(wails.TestUpstreamConnection).mockResolvedValue({
      success: true,
      data: { models: ['model-a', 'model-b'] },
    })
    render(<ApiSection {...baseProps} />)

    fireEvent.click(screen.getByText('sett_test_conn'))

    await waitFor(() => {
      const tag = screen.getByText(/sett_test_ok/)
      expect(tag).toBeInTheDocument()
      expect(tag).toHaveClass('green')
    })
  })

  it('shows an error tag when TestUpstreamConnection returns failure', async () => {
    vi.mocked(wails.TestUpstreamConnection).mockResolvedValue({
      success: false,
      error: 'Connection refused',
    })
    render(<ApiSection {...baseProps} />)

    fireEvent.click(screen.getByText('sett_test_conn'))

    await waitFor(() => {
      const tag = screen.getByText('Connection refused')
      expect(tag).toBeInTheDocument()
      expect(tag).toHaveClass('red')
    })
  })
})
