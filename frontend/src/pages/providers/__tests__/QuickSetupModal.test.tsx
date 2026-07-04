import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickSetupModal, parsePastedKeys } from '../QuickSetupModal'
import { apiFetch } from '@/lib/wails'
import type { Provider } from '@/lib/types'

const toastMock = vi.fn()

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))
vi.mock('@/lib/wails', () => ({
  apiFetch: vi.fn(),
}))

// Users paste keys from password managers / notes in messy formats; the
// parser must accept one-per-line AND comma/semicolon lists, and silently
// drop duplicates so an account never appears twice in the rotation pool.
describe('parsePastedKeys', () => {
  it('splits on newlines, commas and semicolons, trimming whitespace', () => {
    expect(parsePastedKeys('sk-a\n sk-b ,sk-c;sk-d\n')).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-d'])
  })

  it('deduplicates and drops empty segments', () => {
    expect(parsePastedKeys('sk-a\n\nsk-a,,sk-b')).toEqual(['sk-a', 'sk-b'])
  })
})

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p1', name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go', apiKey: '',
    models: [], priority: 0, enabled: true, health: 'unknown', requestCount: 0,
    errorCount: 0, avgLatency: 0, createdAt: 1, line: 'claude', protocol: 'openai-chat',
    rateLimitPerSecond: 0, rateLimitBurst: 0,
    ...overrides,
  } as Provider
}

describe('QuickSetupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiFetch).mockResolvedValue({})
  })

  // The whole point of quick setup is zero-config rotation: pasting N keys
  // must land as N accounts on the ACTIVE provider of the current line.
  it('replaces the active provider account pool with pasted keys', async () => {
    const onDone = vi.fn()
    render(
      <QuickSetupModal
        line="claude"
        providers={[makeProvider({ id: 'inactive', enabled: false }), makeProvider({ id: 'active', enabled: true })]}
        onClose={() => {}}
        onDone={onDone}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sk-one\nsk-two' } })
    fireEvent.click(screen.getByRole('button', { name: /prov_quick_setup_apply/ }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith('/ocgt/api/providers/active', expect.objectContaining({ method: 'PUT' }))
    const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string)
    expect(body.accounts).toHaveLength(2)
    expect(body.accounts.map((a: { apiKey: string }) => a.apiKey)).toEqual(['sk-one', 'sk-two'])
    expect(body.enabled).toBe(true)
  })

  // A brand-new install has no provider on the line yet — quick setup must
  // still work end-to-end by creating the OpenCode Go provider itself.
  it('creates an OpenCode Go provider when the line has none', async () => {
    render(<QuickSetupModal line="codex" providers={[]} onClose={() => {}} onDone={() => {}} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sk-only' } })
    fireEvent.click(screen.getByRole('button', { name: /prov_quick_setup_apply/ }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith('/ocgt/api/providers', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string)
    expect(body.line).toBe('codex')
    expect(body.protocol).toBe('openai-responses')
    expect(body.accounts).toHaveLength(1)
  })

  // Empty input must never fire a request that would wipe an existing pool.
  it('refuses to apply with no keys', () => {
    render(<QuickSetupModal line="claude" providers={[makeProvider({})]} onClose={() => {}} onDone={() => {}} />)
    const apply = screen.getByRole('button', { name: /prov_quick_setup_apply/ })
    expect(apply).toBeDisabled()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
