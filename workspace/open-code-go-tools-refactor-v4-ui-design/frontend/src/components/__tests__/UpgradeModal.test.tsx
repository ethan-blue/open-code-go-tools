import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UpgradeModal } from '../UpgradeModal'

// Mock the i18n hook
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        upgrade_title: 'Update Available',
        upgrade_features: 'Feature 1,Feature 2,Feature 3',
        upgrade_later: 'Later',
        upgrade_download: 'Download',
        aria_close: 'Close',
      }
      return translations[key] || key
    },
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

describe('UpgradeModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    currentVersion: 'v2.2.0',
    newVersion: 'v2.3.0',
  }

  it('renders when open', () => {
    render(<UpgradeModal {...defaultProps} />)
    expect(screen.getByText('Update Available')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<UpgradeModal {...defaultProps} open={false} />)
    expect(screen.queryByText('Update Available')).not.toBeInTheDocument()
  })

  it('displays version numbers', () => {
    render(<UpgradeModal {...defaultProps} />)
    // Version numbers appear in multiple places (header + changelog)
    const versionElements = screen.getAllByText(/v2\.3\.0/)
    expect(versionElements.length).toBeGreaterThanOrEqual(1)
  })

  it('displays features list', () => {
    render(<UpgradeModal {...defaultProps} />)
    expect(screen.getByText('Feature 1')).toBeInTheDocument()
    expect(screen.getByText('Feature 2')).toBeInTheDocument()
    expect(screen.getByText('Feature 3')).toBeInTheDocument()
  })

  it('displays action buttons', () => {
    render(<UpgradeModal {...defaultProps} />)
    expect(screen.getByText('Later')).toBeInTheDocument()
    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  it('calls onClose when Later button is clicked', () => {
    const onClose = vi.fn()
    render(<UpgradeModal {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByText('Later'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Download button is clicked', () => {
    const onClose = vi.fn()
    render(<UpgradeModal {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByText('Download'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<UpgradeModal {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<UpgradeModal {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalled()
  })
})
