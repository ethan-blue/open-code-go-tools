import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Providers from '../Providers'
import { apiGet, apiFetch, isWails, wails } from '@/lib/wails'

const tMock = (key: string) => key
const toastMock = vi.fn()

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: tMock,
  }),
}))

vi.mock('@/hooks/toast', () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}))

vi.mock('@/lib/wails', () => ({
  apiGet: vi.fn(),
  apiFetch: vi.fn(),
  isWails: vi.fn(),
  wails: {
    FetchUpstreamModels: vi.fn(),
  },
}))

describe('Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isWails).mockReturnValue(false)
    vi.mocked(apiFetch).mockResolvedValue({})
    vi.mocked(wails.FetchUpstreamModels).mockResolvedValue({})
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path !== '/ocgt/api/providers') return {}
      return {
        providers: [{
          id: 'p1',
          name: 'OpenCode Go',
          baseUrl: 'https://custom.upstream.com',
          apiKey: 'sk-test',
          models: [],
          defaultModel: 'claude-3-5-sonnet',
          priority: 0,
          enabled: true,
          health: 'unknown',
          requestCount: 0,
          errorCount: 0,
          avgLatency: 0,
          createdAt: 1,
          sortIndex: 0,
          line: 'claude',
          protocol: 'openai-chat',
          rateLimitPerSecond: 0,
          rateLimitBurst: 0,
          requestTimeoutSeconds: 300,
          thinkingBudgetTokens: 2048,
          modelAliases: { sonnet: 'claude-3-5-sonnet' },
          headers: {},
          env: { ENABLE_TOOL_SEARCH: 'true' },
        }],
      }
    })
  })

  it('uses provider rows as the main config flow', async () => {
    render(<Providers />)

    expect(await screen.findByText('OpenCode Go')).toBeInTheDocument()
    expect(screen.getByText('Claude 当前供应商')).toBeInTheDocument()
    expect(screen.queryByText('sidebar_profiles')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('prov_base_url')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))

    expect(await screen.findByLabelText('prov_base_url')).toHaveValue('https://custom.upstream.com')
    expect(await screen.findByLabelText('prov_api_key_label')).toHaveValue('sk-test')
    expect(await screen.findByLabelText('Default Model')).toHaveValue('claude-3-5-sonnet')
    expect(screen.getByText('Env / Runtime')).toBeInTheDocument()
  })

  it('preserves a valid protocol when switching line, resets when invalid', async () => {
    render(<Providers />)

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))

    // The seeded provider uses openai-chat, which is valid for both lines.
    const protocolSelect = await screen.findByLabelText('Protocol')
    expect(protocolSelect).toHaveValue('openai-chat')

    // The page has two "Claude"/"Codex" segmented controls: the line filter at
    // the top and the in-editor line switch. The editor switch is the second
    // matching button for each name.
    const codexButtons = () => screen.getAllByRole('button', { name: 'Codex' })
    const claudeButtons = () => screen.getAllByRole('button', { name: 'Claude' })

    // Switch line Claude -> Codex in the editor: openai-chat is valid for codex.
    fireEvent.click(codexButtons()[1])
    expect(screen.getByLabelText('Protocol')).toHaveValue('openai-chat')

    // anthropic is only valid for claude. Pick it on Claude, then switch to
    // Codex: it must reset to the codex default (openai-responses).
    fireEvent.click(claudeButtons()[1])
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'anthropic' } })
    expect(screen.getByLabelText('Protocol')).toHaveValue('anthropic')

    fireEvent.click(codexButtons()[1])
    expect(screen.getByLabelText('Protocol')).toHaveValue('openai-responses')
  })
})
