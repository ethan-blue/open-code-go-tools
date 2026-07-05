import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TrafficMonitor from '../TrafficMonitor'
import { apiGet } from '@/lib/wails'
import { modelColor } from '@/lib/modelColors'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'en',
    setLang: vi.fn(),
  }),
}))

vi.mock('@/hooks/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/wails', () => ({
  apiGet: vi.fn(),
}))

describe('TrafficMonitor', () => {
  function mockTraffic(summaryPatch = {}, history: unknown[] = [], modelRows: unknown[] = []) {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path.startsWith('/ocgt/api/stats/summary')) {
        return {
          summary: {
            total_requests: 1,
            success_count: 1,
            success_rate: 100,
            avg_latency_ms: 42,
            total_tokens: 100,
            total_input_tokens: 60,
            total_output_tokens: 40,
            total_cache_read_tokens: 12,
            total_cache_create_tokens: 0,
            estimated_cost: 0.01,
            cache_hit_rate: 12.3,
            ...summaryPatch,
          },
          by_client: (summaryPatch as { by_client?: unknown[] }).by_client || [],
        }
      }
      if (path.startsWith('/ocgt/api/stats/trend')) {
        return { daily: [], granularity: 'daily' }
      }
      if (path.startsWith('/ocgt/api/stats/models')) {
        return { models: modelRows }
      }
      if (path.startsWith('/ocgt/api/history')) {
        return history
      }
      return {}
    })
  }

  it('renders backend cache_hit_rate as a percentage without multiplying it again', async () => {
    mockTraffic()
    render(<TrafficMonitor />)

    await waitFor(() => expect(screen.getByText('12.3%')).toBeInTheDocument())
    expect(screen.queryByText('1230.0%')).not.toBeInTheDocument()
  })

  it('renders client source distribution as fixed grid rows, not the generic table layout', async () => {
    mockTraffic({
      by_client: [{
        name: 'VS Code Claude extension with a very long source name',
        requests: 1234,
        pct: 100,
        p50_latency_ms: 120,
        p95_latency_ms: 340,
      }],
    })

    const { container } = render(<TrafficMonitor />)

    await waitFor(() => expect(screen.getByText('VS Code Claude extension with a very long source name')).toBeInTheDocument())
    expect(container.querySelector('.tm-client-grid')).toBeInTheDocument()
    expect(container.querySelector('.tm-client-table')).not.toBeInTheDocument()
  })

  it('opens request detail from the recent request arrow', async () => {
    const history = [{
      id: 'req-1',
      time: '2026-07-04T00:00:00Z',
      status: 500,
      duration: '120ms',
      model: 'claude-sonnet',
      route: 'messages',
      client: 'VS Code',
      input_tokens: 10,
      output_tokens: 2,
      error: 'upstream failed',
    }]
    mockTraffic({}, history)
    const detailSpy = vi.fn()
    window.addEventListener('nav-to-detail', detailSpy)

    const { container } = render(<TrafficMonitor />)

    await waitFor(() => expect(screen.getByText('ERR')).toBeInTheDocument())
    const navButton = container.querySelector('.tm-btn-nav') as HTMLButtonElement
    fireEvent.click(navButton)
    expect(detailSpy).toHaveBeenCalled()
    expect(detailSpy.mock.calls[0][0].detail.id).toBe('req-1')

    window.removeEventListener('nav-to-detail', detailSpy)
  })

  it('shows a token mix bar and keeps model colors aligned', async () => {
    const model = {
      name: 'deepseek-v4-pro',
      requests: 3,
      input_tokens: 60,
      output_tokens: 30,
      cache_tokens: 10,
      total_tokens: 100,
      pct: 100,
      cost_usd: 0.01,
      cache_hit_rate: 16.7,
    }
    mockTraffic({}, [], [model])

    const { container } = render(<TrafficMonitor />)

    await waitFor(() => expect(screen.getAllByText('deepseek-v4-pro').length).toBeGreaterThan(0))
    expect(container.querySelector('.tm-token-mix')).toBeInTheDocument()

    const expectedColor = modelColor(model.name)
    const donutSlice = Array.from(container.querySelectorAll('circle')).find((el) => el.getAttribute('stroke') === expectedColor)
    expect(donutSlice).toBeTruthy()

    const expectedStyle = document.createElement('span')
    expectedStyle.style.backgroundColor = expectedColor
    const dot = container.querySelector('.tm-model-dot') as HTMLElement
    expect(dot.style.backgroundColor).toBe(expectedStyle.style.backgroundColor)
  })
})
