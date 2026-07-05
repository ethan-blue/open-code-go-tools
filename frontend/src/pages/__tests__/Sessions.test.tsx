import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Sessions from '../Sessions'
import { apiGet } from '@/lib/wails'

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
  isWails: vi.fn(() => false),
  wails: {},
}))

// Build a session with N assistant messages, each with distinct text so we can
// count how many detail rows actually mounted. This reproduces the scenario
// that stalled the page: a long session whose detail panel rendered every
// message on each re-render.
function buildLongSession(messageCount: number) {
  const events = Array.from({ length: messageCount }, (_, i) => ({
    type: 'assistant',
    timestamp: '2026-01-01T00:00:00Z',
    message: { text: `msg-${i}`, usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  return {
    sessionId: 'long-session',
    model: 'claude-sonnet',
    startTime: '2026-01-01T00:00:00Z',
    lastTime: '2026-01-01T01:00:00Z',
    totalTokens: 100,
    inputTokens: 50,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    messageCount,
    events,
  }
}

describe('Sessions detail rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      // List endpoint
      if (path.startsWith('/ocgt/api/sessions?') && !path.includes('id=')) {
        return { sessions: [buildLongSession(120)], total: 1 }
      }
      // Detail endpoint
      if (path.includes('id=long-session')) {
        return { sessions: [buildLongSession(120)] }
      }
      return { sessions: [] }
    })
  })

  it('renders only an initial batch of detail messages and offers "load more"', async () => {
    render(<Sessions />)

    // Wait for the session list row to appear, then open it.
    await waitFor(() => {
      expect(screen.getByText('long-session')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('long-session'))

    // The first 50 messages should be mounted...
    await waitFor(() => {
      expect(screen.getByText('msg-0')).toBeInTheDocument()
      expect(screen.getByText('msg-49')).toBeInTheDocument()
    })
    // ...but NOT message 50 (index past the initial cap)...
    expect(screen.queryByText('msg-50')).not.toBeInTheDocument()
    // ...and a "load more" control must be present.
    expect(screen.getByText('sessions_show_more')).toBeInTheDocument()
  })

  it('caps expanded model chart rows and groups the tail', async () => {
    const manyModels = Array.from({ length: 40 }, (_, i) => ({
      ...buildLongSession(1),
      sessionId: `session-${i}`,
      model: `model-${String(i).padStart(2, '0')}`,
      totalTokens: 1000 - i,
    }))
    vi.mocked(apiGet).mockResolvedValue({ sessions: manyModels, total: manyModels.length })

    const { container } = render(<Sessions />)

    await waitFor(() => expect(screen.getByText('session-0')).toBeInTheDocument())
    fireEvent.click(screen.getByText('sessions_model_chart'))

    const legend = Array.from(container.querySelectorAll('.sess-legend-nm')).map((el) => el.textContent)
    expect(legend).toContain('model-00')
    expect(legend).toContain('sessions_other_models')
    expect(legend).not.toContain('model-39')
    expect(legend).toHaveLength(24)

    fireEvent.click(screen.getByText('sessions_model_chart'))
    expect(container.querySelectorAll('.sess-legend-nm')).toHaveLength(0)
  })

  it('shows the Codex source for Codex sessions', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path.startsWith('/ocgt/api/sessions?') && !path.includes('id=')) {
        return { sessions: [{ ...buildLongSession(1), sessionId: 'codex-s1', source: 'codex', model: 'deepseek-v4-pro' }], total: 1 }
      }
      if (path.includes('id=codex-s1')) {
        return { sessions: [{ ...buildLongSession(1), sessionId: 'codex-s1', source: 'codex', model: 'deepseek-v4-pro' }] }
      }
      return { sessions: [] }
    })

    render(<Sessions />)

    await waitFor(() => expect(screen.getByText('codex-s1')).toBeInTheDocument())
    expect(screen.getByText('sessions_source_codex')).toBeInTheDocument()
    fireEvent.click(screen.getByText('codex-s1'))
    await waitFor(() => expect(screen.getAllByText('sessions_source_codex').length).toBeGreaterThan(1))
  })
})
