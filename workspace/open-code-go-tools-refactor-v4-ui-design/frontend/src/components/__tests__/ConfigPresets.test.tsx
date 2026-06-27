import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ConfigPresets, PRESETS } from '../ConfigPresets'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('ConfigPresets', () => {
  const defaultProps = {
    onSelect: vi.fn(),
  }

  it('renders all 4 presets', () => {
    render(<ConfigPresets {...defaultProps} />)
    expect(screen.getByText('快速开始')).toBeInTheDocument()
    expect(screen.getByText('开发者')).toBeInTheDocument()
    expect(screen.getByText('写作')).toBeInTheDocument()
    expect(screen.getByText('研究')).toBeInTheDocument()
  })

  it('renders preset descriptions', () => {
    render(<ConfigPresets {...defaultProps} />)
    expect(screen.getByText('开箱即用，3 分钟搞定')).toBeInTheDocument()
    expect(screen.getByText('代码优化，编程专用')).toBeInTheDocument()
  })

  it('calls onSelect when preset is clicked', () => {
    const onSelect = vi.fn()
    render(<ConfigPresets onSelect={onSelect} />)

    fireEvent.click(screen.getByText('快速开始').closest('.preset-card')!)

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'quickstart' })
    )
  })

  it('highlights active preset', () => {
    render(<ConfigPresets {...defaultProps} currentPreset="developer" />)

    const devCard = screen.getByText('开发者').closest('.preset-card')
    expect(devCard).toHaveClass('active')
  })

  it('does not highlight inactive presets', () => {
    render(<ConfigPresets {...defaultProps} currentPreset="developer" />)

    const quickstartCard = screen.getByText('快速开始').closest('.preset-card')
    expect(quickstartCard).not.toHaveClass('active')
  })

  it('exports PRESETS constant with 4 items', () => {
    expect(PRESETS).toHaveLength(4)
    expect(PRESETS[0].id).toBe('quickstart')
    expect(PRESETS[1].id).toBe('developer')
    expect(PRESETS[2].id).toBe('writing')
    expect(PRESETS[3].id).toBe('research')
  })

  it('each preset has required fields', () => {
    PRESETS.forEach((preset) => {
      expect(preset.id).toBeTruthy()
      expect(preset.name).toBeTruthy()
      expect(preset.description).toBeTruthy()
      expect(preset.defaultModel).toBeTruthy()
      expect(preset.modelAliases).toBeDefined()
    })
  })
})
