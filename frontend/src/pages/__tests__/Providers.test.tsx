import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
          enabled: true,
          createdAt: 1,
          sortIndex: 0,
          line: 'claude',
          protocol: 'openai-chat',
          modelProtocols: { 'claude-3-5-sonnet': 'anthropic' },
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

    // The provider name renders in both the quick-switcher pill and the card row.
    expect((await screen.findAllByText('OpenCode Go')).length).toBeGreaterThanOrEqual(1)
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
    // Default Model field and the new sonnet-alias quick field both surface
    // the mapping — model aliases are first-class inputs again, not buried
    // in the JSON blob. Both are now dropdown triggers: the selected value is
    // rendered inside the trigger button text.
    // Both the Default Model and sonnet-alias dropdown triggers render the
    // mapped value as their trigger text.
    const sonnetValues = await screen.findAllByText('claude-3-5-sonnet')
    expect(sonnetValues.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByLabelText('prov_alias_sonnet')).toHaveTextContent('claude-3-5-sonnet')
    expect(screen.getByLabelText('prov_field_default_model')).toHaveTextContent('claude-3-5-sonnet')
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

  it('syncs real upstream models and saves selected message models', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/ocgt/api/providers/models?line=claude') {
        return { data: [{ id: 'deepseek-v4-pro', protocol: 'openai-chat' }] }
      }
      if (path !== '/ocgt/api/providers') return {}
      return {
        providers: [{
          id: 'p1',
          name: 'OpenCode Go',
          baseUrl: 'https://custom.upstream.com',
          apiKey: 'sk-test',
          accounts: [{ id: 'acc-primary', apiKey: 'sk-test' }],
          models: [],
          defaultModel: '',
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
          thinkingBudgetTokens: 0,
          modelAliases: {},
          headers: {},
          env: {},
        }],
      }
    })

    render(<Providers />)

    fireEvent.click(await screen.findByRole('button', { name: 'prov_card_edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'btn_sync_models' }))
    // Synced options live inside the fallback-chain dropdown panel; open it
    // first, then pick the model from the listbox.
    fireEvent.click(screen.getByLabelText('prov_field_fallback'))
    fireEvent.click((await screen.findAllByRole('option', { name: /deepseek-v4-pro/ }))[0])
    fireEvent.click(screen.getByRole('button', { name: 'prov_form_save' }))

    const [, options] = vi.mocked(apiFetch).mock.calls.find(([path]) => path === '/ocgt/api/providers/p1')!
    const body = JSON.parse(String(options?.body))
    expect(body.fallbackChain).toEqual(['deepseek-v4-pro'])
    expect(body.modelProtocols).toEqual({ 'deepseek-v4-pro': 'openai-chat' })
  })

  it('sends saved provider id and model protocol metadata when testing a model', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ success: true, latencyMs: 1 })

    render(<Providers />)

    fireEvent.click(await screen.findByRole('button', { name: 'prov_card_edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'btn_test_model' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/ocgt/api/providers/test', expect.anything(), 35000))
    const [, options] = vi.mocked(apiFetch).mock.calls.find(([path]) => path === '/ocgt/api/providers/test')!
    const body = JSON.parse(String(options?.body))
    expect(body.providerId).toBe('p1')
    expect(body.model).toBe('claude-3-5-sonnet')
    expect(body.protocol).toBe('openai-chat')
    expect(body.modelProtocols).toEqual({ 'claude-3-5-sonnet': 'anthropic' })
  })
})
