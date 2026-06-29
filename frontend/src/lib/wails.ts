// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WailsApp = {
  [method: string]: (...args: any[]) => Promise<any>
}

function getWailsApp(): WailsApp | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any)?.go?.main?.App ?? null
}

export async function callWails<T = string>(method: string, ...args: any[]): Promise<T> {
  const app = getWailsApp()
  if (!app || typeof app[method] !== 'function') {
    throw new Error(`Wails binding not available: ${method}`)
  }
  return app[method](...args) as Promise<T>
}

export function isWails(): boolean {
  return getWailsApp() !== null
}

let API_BASE = 'http://127.0.0.1:8787'
let AUTH_TOKEN = ''

export function setApiBase(url: string) { API_BASE = url }
export function setAuthToken(token: string) { AUTH_TOKEN = token }
export function getApiBase(): string { return API_BASE }

export async function apiFetch<T = any>(path: string, options?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    }
    if (AUTH_TOKEN) headers['X-Ocgt-Local-Token'] = AUTH_TOKEN
    const resp = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const text = await resp.text()
    return (text ? JSON.parse(text) : null) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function apiGet<T = any>(path: string): Promise<T> {
  return apiFetch<T>(path)
}

/** Like apiFetch but returns the raw Response (for streaming). Caller must check resp.ok. */
export async function apiFetchRaw(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (AUTH_TOKEN) headers['X-Ocgt-Local-Token'] = AUTH_TOKEN
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

export const wails = {
  GetListenAddress: () => callWails<string>('GetListenAddress'),
  GetLocalToken: () => callWails<string>('GetLocalToken'),
  FetchQuota: () => callWails<Record<string, any>>('FetchQuota'),
  FetchUpstreamModels: () => callWails<Record<string, any>>('FetchUpstreamModels'),
  TestUpstreamConnection: (upstream: string, apiKey: string) => callWails<Record<string, any>>('TestUpstreamConnection', upstream, apiKey),
  GetPreferences: () => callWails<Record<string, string>>('GetPreferences'),
  SavePreferences: (closeBehavior: string) => callWails<string>('SavePreferences', closeBehavior),
  SavePlugins: (pluginsJSON: string) => callWails<string>('SavePlugins', pluginsJSON),
  SaveUIPreferences: (theme: string, language: string, accentHue: number, lastView: string, compactShell: string, expandedIntegrationsJSON: string) =>
    callWails<string>('SaveUIPreferences', theme, language, accentHue, lastView, compactShell, expandedIntegrationsJSON),
  SaveLogPreferences: (enabled: boolean, dir: string, retention: number) =>
    callWails<string>('SaveLogPreferences', enabled, dir, retention),
  OpenConfigLocation: () => callWails<string>('OpenConfigLocation'),
  OpenLogLocation: () => callWails<string>('OpenLogLocation'),
  SaveProfileConfig: (...args: string[]) => callWails<string>('SaveProfileConfig', ...args),
  InstallClaudeUserEnv: () => callWails<string>('InstallClaudeUserEnv'),
  ClearSystemEnv: () => callWails<string>('ClearSystemEnv'),
  IsSystemEnvConfigured: () => callWails<boolean>('IsSystemEnvConfigured'),
  InstallVSCodeEnv: () => callWails<string>('InstallVSCodeEnv'),
  RemoveVSCodeEnv: () => callWails<string>('RemoveVSCodeEnv'),
  IsVSCodeConfigured: () => callWails<boolean>('IsVSCodeConfigured'),
  SetupClaudeDesktop: () => callWails<string>('SetupClaudeDesktop'),
  ClearClaudeDesktop: () => callWails<string>('ClearClaudeDesktop'),
  IsClaudeDesktopConfigured: () => callWails<boolean>('IsClaudeDesktopConfigured'),
  SetupClaudeDesktopApp: () => callWails<string>('SetupClaudeDesktopApp'),
  ClearClaudeDesktopApp: () => callWails<string>('ClearClaudeDesktopApp'),
  IsClaudeDesktopAppConfigured: () => callWails<boolean>('IsClaudeDesktopAppConfigured'),
  SetupCodex: () => callWails<string>('SetupCodex'),
  ClearCodex: () => callWails<string>('ClearCodex'),
  IsCodexConfigured: () => callWails<boolean>('IsCodexConfigured'),
  LaunchClaudeTerminal: (shell: string, lang: string) => callWails<string>('LaunchClaudeTerminal', shell, lang),
  RepairAllConfigurations: () => callWails<string>('RepairAllConfigurations'),
  SyncConfiguredIntegrations: () => callWails<string>('SyncConfiguredIntegrations'),
  GetHubStatus: () => callWails<string>('GetHubStatus'),
  GetHubConfig: () => callWails<string>('GetHubConfig'),
  SaveHubConfig: (enabled: boolean, url: string, secret: string, deviceName: string, interval: number) =>
    callWails<string>('SaveHubConfig', enabled, url, secret, deviceName, interval),
  HideToTray: () => callWails<void>('HideToTray'),
  QuitApp: () => callWails<void>('QuitApp'),
  ShowAboutDialog: () => callWails<void>('ShowAboutDialog'),
  StartWindowDrag: () => callWails<void>('StartWindowDrag'),
  RequestClose: () => callWails<string>('RequestClose'),
  SetAuthEnabled: (enabled: boolean) => callWails<string>('SetAuthEnabled', enabled),
}
