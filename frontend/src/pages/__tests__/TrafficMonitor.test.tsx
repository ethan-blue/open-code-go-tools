import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TrafficMonitor from '../TrafficMonitor'
import { apiGet } from '@/lib/wails'

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
  it('renders backend cache_hit_rate as a percentage without multiplying it again', async () => {
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
          },
          by_client: [],
        }
      }
      if (path.startsWith('/ocgt/api/stats/trend')) {
        return { daily: [], granularity: 'daily' }
      }
      if (path.startsWith('/ocgt/api/stats/models')) {
        return { models: [] }
      }
      if (path.startsWith('/ocgt/api/history')) {
        return []
      }
      return {}
    })

    render(<TrafficMonitor />)

    await waitFor(() => expect(screen.getByText('12.3%')).toBeInTheDocument())
    expect(screen.queryByText('1230.0%')).not.toBeInTheDocument()
  })
})
