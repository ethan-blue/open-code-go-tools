import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DesignFootprint from '../DesignFootprint'

// Mock the i18n hook
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
    setLang: vi.fn(),
  }),
}))

describe('DesignFootprint', () => {
  it('renders the design system footer', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('DESIGN SYSTEM')).toBeInTheDocument()
    expect(screen.getByText('Tokens, type and motion.')).toBeInTheDocument()
  })

  it('displays color swatches', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('ink-0')).toBeInTheDocument()
    expect(screen.getByText('ink-100')).toBeInTheDocument()
    expect(screen.getByText('ink-300')).toBeInTheDocument()
    expect(screen.getByText('ink-500')).toBeInTheDocument()
    expect(screen.getByText('ink-700')).toBeInTheDocument()
    expect(screen.getByText('ink-950')).toBeInTheDocument()
    expect(screen.getByText('link')).toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()
    expect(screen.getByText('warn')).toBeInTheDocument()
    expect(screen.getByText('danger')).toBeInTheDocument()
  })

  it('displays typography section', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('Typography')).toBeInTheDocument()
    expect(screen.getByText('Serif heading')).toBeInTheDocument()
  })

  it('displays spacing section', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('Spacing')).toBeInTheDocument()
  })

  it('displays radius section', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('Radius')).toBeInTheDocument()
  })

  it('displays elevation section', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('Elevation')).toBeInTheDocument()
  })

  it('displays the branding mark', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('ocgt')).toBeInTheDocument()
    expect(screen.getByText('v4')).toBeInTheDocument()
  })

  it('displays the footer text', () => {
    render(<DesignFootprint />)

    expect(screen.getByText('footer_text')).toBeInTheDocument()
    expect(screen.getByText('No hex codes in product code.')).toBeInTheDocument()
  })
})
