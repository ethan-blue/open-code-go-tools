import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import QuickConnect from '../QuickConnect'
import { apiGet, wails } from '@/lib/wails'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}))

vi.mock('@/lib/wails', () => ({
  apiGet: vi.fn(),
  wails: {
    IsSystemEnvConfigured: vi.fn(),
    IsVSCodeConfigured: vi.fn(),
    IsClaudeDesktopAppConfigured: vi.fn(),
    IsCodexConfigured: vi.fn(),
    GetLocalToken: vi.fn(),
    OpenConfigLocation: vi.fn(),
    InstallClaudeUserEnv: vi.fn(),
    InstallVSCodeEnv: vi.fn(),
    SetupCodex: vi.fn(),
    SetupClaudeDesktopApp: vi.fn(),
    ClearSystemEnv: vi.fn(),
    RemoveVSCodeEnv: vi.fn(),
    ClearCodex: vi.fn(),
    ClearClaudeDesktopApp: vi.fn(),
  },
}))

describe('QuickConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(wails.IsSystemEnvConfigured).mockResolvedValue(false)
    vi.mocked(wails.IsVSCodeConfigured).mockResolvedValue(false)
    vi.mocked(wails.IsClaudeDesktopAppConfigured).mockResolvedValue(false)
    vi.mocked(wails.IsCodexConfigured).mockResolvedValue(false)
    vi.mocked(wails.GetLocalToken).mockResolvedValue('')
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/ocgt/api/status') {
        return { providers: { claude: { api_key_configured: false, default_model: '' }, codex: { api_key_configured: false, default_model: '' } } }
      }
      if (path.startsWith('/ocgt/api/stats/summary')) {
        return { by_client: [] }
      }
      return {}
    })
  })

  it('blocks quick connect until provider key and model mapping are configured', async () => {
    render(<QuickConnect />)

    await waitFor(() => {
      expect(screen.getByText('status_api_key_not_configured')).toBeInTheDocument()
    })

    expect(screen.getByText('nav_providers')).toBeInTheDocument()
    expect(screen.queryByText('sett_s02_title')).not.toBeInTheDocument()
  })

  it('groups VS Code under Claude and switches Codex separately', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/ocgt/api/status') {
        return { providers: { claude: { api_key_configured: true, default_model: 'claude-3-5-sonnet' }, codex: { api_key_configured: true, default_model: 'gpt-5' } } }
      }
      if (path.startsWith('/ocgt/api/stats/summary')) {
        return { by_client: [] }
      }
      return {}
    })

    render(<QuickConnect />)

    await waitFor(() => {
      expect(screen.getByText('Claude Code / VS Code')).toBeInTheDocument()
    })

    expect(screen.queryByText('VS Code')).not.toBeInTheDocument()
    expect(screen.queryByText('Codex CLI')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))

    expect(screen.getByText('Codex CLI')).toBeInTheDocument()
  })
})
