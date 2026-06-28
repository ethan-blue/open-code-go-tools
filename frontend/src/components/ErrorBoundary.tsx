import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '@/i18n'

interface ClassProps {
  children: ReactNode
  fallback?: ReactNode
  title: string
  message: string
  retry: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/** Inner class component — React requires class for componentDidCatch */
class ErrorBoundaryInner extends Component<ClassProps, State> {
  constructor(props: ClassProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '40vh', gap: 16, padding: 32, textAlign: 'center'
        }}>
          <div style={{ fontSize: 48, opacity: 0.3 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-0)' }}>
            {this.props.title}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 400 }}>
            {this.state.error?.message || this.props.message}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: '8px 24px', fontSize: 13, fontWeight: 500,
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer'
            }}
          >
            {this.props.retry}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

/** Public wrapper — uses useI18n for translated error strings */
export function ErrorBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { t } = useI18n()
  return (
    <ErrorBoundaryInner
      title={t('err_something_wrong')}
      message={t('err_unexpected')}
      retry={t('err_try_again')}
      fallback={fallback}
    >
      {children}
    </ErrorBoundaryInner>
  )
}
