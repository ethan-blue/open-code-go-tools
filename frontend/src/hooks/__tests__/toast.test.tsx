import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToastProvider, useToast } from '../toast'
import { I18nProvider } from '@/i18n'

// Mock the i18n module
vi.mock('@/i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

// Test component that uses the toast hook
function TestComponent() {
  const { toast } = useToast()
  return (
    <div>
      <button onClick={() => toast('Success message', 'success')}>Show Success</button>
      <button onClick={() => toast('Error message', 'error')}>Show Error</button>
      <button onClick={() => toast('Warning message', 'warning')}>Show Warning</button>
      <button onClick={() => toast('Info message', 'info')}>Show Info</button>
    </div>
  )
}

describe('Toast', () => {
  it('renders toast provider', () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    expect(screen.getByText('Show Success')).toBeInTheDocument()
    expect(screen.getByText('Show Error')).toBeInTheDocument()
    expect(screen.getByText('Show Warning')).toBeInTheDocument()
    expect(screen.getByText('Show Info')).toBeInTheDocument()
  })

  it('shows success toast when triggered', () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Success'))

    expect(screen.getByText('Success message')).toBeInTheDocument()
    expect(screen.getByText('toast_success')).toBeInTheDocument()
  })

  it('shows error toast when triggered', () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Error'))

    expect(screen.getByText('Error message')).toBeInTheDocument()
    expect(screen.getByText('toast_error')).toBeInTheDocument()
  })

  it('shows warning toast when triggered', () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Warning'))

    expect(screen.getByText('Warning message')).toBeInTheDocument()
    expect(screen.getByText('toast_notice')).toBeInTheDocument()
  })

  it('shows info toast when triggered', () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Info'))

    expect(screen.getByText('Info message')).toBeInTheDocument()
    expect(screen.getByText('toast_notice')).toBeInTheDocument()
  })

  it('dismisses toast when close button is clicked', () => {
    vi.useFakeTimers()

    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Success'))

    const closeButton = screen.getByLabelText('aria_close')
    fireEvent.click(closeButton)

    // Fast-forward time for dismiss animation (200ms)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Toast should be dismissed
    expect(screen.queryByText('Success message')).not.toBeInTheDocument()

    vi.useRealTimers()
  })

  it('auto-dismisses toast after timeout', async () => {
    vi.useFakeTimers()

    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Info'))

    expect(screen.getByText('Info message')).toBeInTheDocument()

    // Fast-forward time (3500ms timeout + 200ms dismiss animation)
    act(() => {
      vi.advanceTimersByTime(3700)
    })

    // Toast should be auto-dismissed
    expect(screen.queryByText('Info message')).not.toBeInTheDocument()

    vi.useRealTimers()
  })

  it('shows multiple toasts', () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Show Success'))
    fireEvent.click(screen.getByText('Show Error'))

    expect(screen.getByText('Success message')).toBeInTheDocument()
    expect(screen.getByText('Error message')).toBeInTheDocument()
  })
})
