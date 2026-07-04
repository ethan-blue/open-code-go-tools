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
          // Post-v4.1 the backend migrates the legacy single key into a
          // one-account pool; the API always returns accounts alongside apiKey.
          accounts: [{ id: 'acc-primary', apiKey: 'sk-test' }],
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
    // With the i18n mock returning the key itself, the rendered title is the
    // prov_current_provider_title key (with {{line}} still in it).
    expect(screen.getByText(/prov_current_provider_title/)).toBeInTheDocument()
    expect(screen.queryByText('sidebar_profiles')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('prov_base_url')).not.toBeInTheDocument()

    // The edit button's label is the prov_card_edit key.
    fireEvent.click(await screen.findByRole('button', { name: 'prov_card_edit' }))

    expect(await screen.findByLabelText('prov_base_url')).toHaveValue('https://custom.upstream.com')
    // The single API Key field was replaced by the account pool (multi-account
    // rotation): the legacy key must surface as the pool's primary account so
    // existing configs keep editing the same credential.
    expect(await screen.findByLabelText('prov_pool_key')).toHaveValue('sk-test')
    // Default Model is a prov_field_default_model labelled field; value flows through.
    expect(await screen.findByDisplayValue('claude-3-5-sonnet')).toBeInTheDocument()
    // The advanced config now lives in an auto-generated JSON section.
    expect(screen.getByText(/prov_json_section/)).toBeInTheDocument()
  })

  it('preserves a valid protocol when switching line, resets when invalid', async () => {
    render(<Providers />)

    fireEvent.click(await screen.findByRole('button', { name: 'prov_card_edit' }))

    // The seeded provider uses openai-chat, which is valid for both lines.
    const protocolSelect = await screen.findByLabelText('prov_field_protocol')
    expect(protocolSelect).toHaveValue('openai-chat')

    // The page has two "Claude"/"Codex" segmented controls: the line filter at
    // the top and the in-editor line switch. The editor switch is the second
    // matching button for each name.
    const codexButtons = () => screen.getAllByRole('button', { name: 'Codex' })
    const claudeButtons = () => screen.getAllByRole('button', { name: 'Claude' })

    // Switch line Claude -> Codex in the editor: openai-chat is valid for codex.
    fireEvent.click(codexButtons()[1])
    expect(screen.getByLabelText('prov_field_protocol')).toHaveValue('openai-chat')

    // anthropic is only valid for claude. Pick it on Claude, then switch to
    // Codex: it must reset to the codex default (openai-responses).
    fireEvent.click(claudeButtons()[1])
    fireEvent.change(screen.getByLabelText('prov_field_protocol'), { target: { value: 'anthropic' } })
    expect(screen.getByLabelText('prov_field_protocol')).toHaveValue('anthropic')

    fireEvent.click(codexButtons()[1])
    expect(screen.getByLabelText('prov_field_protocol')).toHaveValue('openai-responses')
  })
})
