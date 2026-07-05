import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../Dashboard'
import { apiGet, isWails, wails } from '@/lib/wails'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'zh',
  }),
}))

vi.mock('@/hooks/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}))

vi.mock('@/lib/wails', () => ({
  apiGet: vi.fn(),
  isWails: vi.fn(),
  wails: {
    FetchQuota: vi.fn(),
  },
}))

vi.mock('@/wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
}))

describe('Dashboard quota refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isWails).mockReturnValue(true)
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/ocgt/api/quota/status') return { configured: false }
      if (path === '/ocgt/api/status') {
        return {
          listen: '127.0.0.1:8787',
          upstream: 'https://opencode.ai/zen/go',
          default_model: '',
          uptime_seconds: 1,
          request_timeout_seconds: 300,
          api_key_configured: false,
          rate_limit_per_second: 0,
          rate_limit_burst: 0,
          rate_limit_per_minute: 0,
          providers: {},
        }
      }
      if (path === '/ocgt/api/stats/summary?days=1') {
        return {
          summary: {
            total_requests: 0,
            success_count: 0,
            success_rate: 100,
            avg_latency_ms: 0,
            p50_latency_ms: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_read_tokens: 0,
            total_cache_create_tokens: 0,
            total_tokens: 0,
            estimated_cost: 0,
            cache_hit_rate: 0,
          },
          by_client: [],
        }
      }
      if (path === '/ocgt/api/stats/trend?days=2') return { daily: [] }
      return {}
    })
  })

  it('does not fetch quota when no quota cookie is configured', async () => {
    render(<Dashboard />)

    expect(await screen.findByText('dash_quota_not_configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dash_quota_login/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dash_quota_configure/ })).toBeInTheDocument()
    await waitFor(() => expect(wails.FetchQuota).not.toHaveBeenCalled())
  })

  it('shows the quota refresh error instead of a generic empty state', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/ocgt/api/quota/status') return { configured: true }
      if (path === '/ocgt/api/status') {
        return {
          listen: '127.0.0.1:8787',
          upstream: 'https://opencode.ai/zen/go',
          default_model: '',
          uptime_seconds: 1,
          request_timeout_seconds: 300,
          api_key_configured: false,
          rate_limit_per_second: 0,
          rate_limit_burst: 0,
          rate_limit_per_minute: 0,
          providers: {},
        }
      }
      if (path === '/ocgt/api/stats/summary?days=1') {
        return {
          summary: {
            total_requests: 0,
            success_count: 0,
            success_rate: 100,
            avg_latency_ms: 0,
            p50_latency_ms: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_read_tokens: 0,
            total_cache_create_tokens: 0,
            total_tokens: 0,
            estimated_cost: 0,
            cache_hit_rate: 0,
          },
          by_client: [],
        }
      }
      if (path === '/ocgt/api/stats/trend?days=2') return { daily: [] }
      return {}
    })
    vi.mocked(wails.FetchQuota).mockResolvedValue({ success: false, error: 'failed to fetch quota - check your cookie' })

    render(<Dashboard />)

    expect(await screen.findByText('failed to fetch quota - check your cookie')).toBeInTheDocument()
  })
})
