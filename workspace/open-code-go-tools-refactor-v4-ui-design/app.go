package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/hub"
	"github.com/ethan-blue/open-code-go-tools/internal/preferences"
	"github.com/ethan-blue/open-code-go-tools/internal/proxy"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
	"github.com/ethan-blue/open-code-go-tools/internal/version"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx        context.Context
	srv        *proxy.Server
	cancelFunc context.CancelFunc
	actionCh   chan trayAction
	quitCh     chan struct{} // signals menu click listener goroutine to exit

	// Allows explicit quit actions to bypass the close-to-tray prompt.
	forceQuit     atomic.Bool
	setupTrayOnce sync.Once
	exitOnce      sync.Once
}

type trayAction int

const (
	trayActionShow trayAction = iota + 1
	trayActionHide
	trayActionSettings
	trayActionAbout
	trayActionQuit
)

// NewApp creates a new App struct instance
func NewApp() *App {
	return &App{actionCh: make(chan trayAction, 16), quitCh: make(chan struct{})}
}

//go:embed build/appicon.png
var appIconPng []byte

//go:embed build/windows/icon.ico
var appIconIco []byte

func (a *App) showMainWindow(center bool) {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowShow(a.ctx)
	if wailsruntime.WindowIsMinimised(a.ctx) {
		wailsruntime.WindowUnminimise(a.ctx)
	}
	if center {
		wailsruntime.WindowCenter(a.ctx)
	}
}

func (a *App) hideMainWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowMinimise(a.ctx)
	wailsruntime.WindowHide(a.ctx)
}

func (a *App) enqueueTrayAction(action trayAction) {
	select {
	case a.actionCh <- action:
	default:
		go func() { a.actionCh <- action }()
	}
}

func (a *App) actionLoop() {
	for action := range a.actionCh {
		switch action {
		case trayActionShow:
			a.showMainWindow(false)
		case trayActionHide:
			a.hideMainWindow()
		case trayActionSettings:
			a.showMainWindow(false)
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, "nav-to-settings")
			}
		case trayActionAbout:
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, "show-about-dialog")
			}
		case trayActionQuit:
			a.exitNow()
		}
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.actionLoop()

	// Start Go proxy server in the background!
	go func() {
		emitError := func(msg string) {
			log.Println("[GUI proxy]", msg)
			wailsruntime.EventsEmit(a.ctx, "proxy-error", msg)
		}

		// 1. Auto-init config if it doesn't exist
		defaultPath, err := config.DefaultPath()
		if err == nil {
			if _, err := os.Stat(defaultPath); os.IsNotExist(err) {
				_, _ = config.WriteExample("", false)
			}
		}

		// 2. Load config
		cfg, err := config.Load("")
		if err != nil {
			emitError("配置加载失败: " + err.Error())
			return
		}
		if strings.TrimSpace(cfg.LocalAuthToken) == "" {
			token, err := generateLocalAuthToken()
			if err != nil {
				emitError("认证令牌生成失败: " + err.Error())
				return
			}
			cfg.LocalAuthToken = token
			if err := cfg.Save(defaultPath); err != nil {
				emitError("认证令牌保存失败: " + err.Error())
				return
			}
		}

		// 3. Create server
		srv, err := proxy.New(cfg, &Assets)
		if err != nil {
			emitError("代理创建失败: " + err.Error())
			return
		}
		if prefs, err := preferences.Load(""); err == nil {
			srv.ConfigureHistoryLog(prefs.LogEnabled, prefs.LogDirectory, prefs.LogRetentionDays)
		} else {
			log.Println("[GUI proxy] preferences load error:", err)
		}
		srv.SetConfigPath(defaultPath)

		// ── 初始化 Hub 同步 ──
		homeDir, _ := os.UserHomeDir()
		dataDir := filepath.Join(homeDir, ".ocgt")

		// 创建同步计数器
		counters := hub.NewSyncCounters(dataDir)
		srv.SetHubCounters(counters)

		// 读取 Hub 配置
		hubPrefs, hubErr := preferences.Load("")
		if hubErr == nil && hubPrefs.HubEnabled {
			// 读取密钥（独立文件，不写入 preferences.json）
			hubSecret := hubPrefs.HubSecret
			if hubSecret == "" {
				secretPath := filepath.Join(dataDir, "hub-secret")
				if secretData, err := os.ReadFile(secretPath); err == nil {
					hubSecret = strings.TrimSpace(string(secretData))
				}
			}

			// 无远程 Hub URL 时启动内嵌 Hub 服务器
			if hubPrefs.HubURL == "" {
				if hubSecret == "" {
					secretPath := filepath.Join(dataDir, "hub-secret")
					if secretData, err := os.ReadFile(secretPath); err == nil {
						hubSecret = strings.TrimSpace(string(secretData))
					}
				}

				hubSrv, err := hub.NewHubServer(hub.ServerOption{
					Port:    hub.DefaultHubPort,
					Host:    "0.0.0.0",
					Secret:  hubSecret,
					DataDir: dataDir,
				})
				if err == nil {
					go func() {
						if err := hubSrv.Start(); err != nil {
							log.Println("[hub] 内嵌 Hub 停止:", err)
							return
						}
						log.Println("[hub] 内嵌 Hub 启动于", hubSrv.Addr())
					}()
				}
			} else {
				// 有远程 Hub URL，创建并启动同步客户端
				hubClient, err := hub.NewClient(hub.Config{
					Enabled:         hubPrefs.HubEnabled,
					HubURL:          hubPrefs.HubURL,
					Secret:          hubSecret,
					DeviceName:      hubPrefs.HubDeviceName,
					PushIntervalSec: hubPrefs.HubPushIntervalSec,
				}, counters, version.Version, dataDir)
				if err == nil {
					hubClient.Start()
					srv.SetHubClient(hubClient)
				}
			}
		}

		a.srv = srv
		if errStr := a.SyncConfiguredIntegrations(); errStr != "success" {
			log.Println("[GUI proxy] integration resync error:", errStr)
		}

		// 4. Listen and Serve with cancellation context
		proxyCtx, cancel := context.WithCancel(context.Background())
		a.cancelFunc = cancel

		log.Println("[GUI proxy] starting background proxy server on http://" + cfg.Listen)
		if err := srv.ListenAndServe(proxyCtx); err != nil {
			emitError("代理停止: " + err.Error())
		}
	}()
}

func generateLocalAuthToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// domReady is called when the frontend DOM is fully loaded and ready.
func (a *App) domReady(ctx context.Context) {
	a.ctx = ctx
	// Force the main window to be shown, unminimized, centered and focused on startup
	a.showMainWindow(true)

	// Initialize the system tray after the Wails WebView2 is fully loaded.
	// A short delay prevents Windows message pump race conditions on startup.
	// Note: setupSystray uses systray.Run() which manages its own dedicated
	// OS thread — no LockOSThread needed here.
	go func() {
		time.Sleep(500 * time.Millisecond)
		a.setupSystray()
	}()
}

// shutdown is called when the app closes
func (a *App) shutdown(ctx context.Context) {
	// Signal menu click listener goroutine to exit
	close(a.quitCh)
	// Quit systray if supported
	a.quitSystray()
	if a.cancelFunc != nil {
		log.Println("[GUI proxy] shutting down background proxy server...")
		a.cancelFunc()
	}
}

// GetListenAddress returns the actual proxy listen address dynamically
// GetLocalToken returns the local auth token for API requests.
func (a *App) GetLocalToken() string {
	if a.srv == nil {
		return ""
	}
	return a.srv.LocalToken()
}

func (a *App) GetListenAddress() string {
	if a.srv != nil {
		return a.srv.ListenAddress()
	}
	// Try loading config to get the address if server is not fully initialized yet
	cfg, err := config.Load("")
	if err == nil && cfg.Listen != "" {
		return cfg.Listen
	}
	return "127.0.0.1:8787" // default fallback
}

func (a *App) localProxyAuthToken() string {
	if token := a.GetLocalToken(); token != "" {
		return token
	}
	cfg, err := config.Load("")
	if err == nil {
		return cfg.LocalAuthToken
	}
	return ""
}

// SaveProfileConfig saves API key, model aliases, proxy, timeout, thinking, and quota settings.
func (a *App) SaveProfileConfig(profileName, apiKey, defaultModel, sonnetAlias, haikuAlias, opusAlias, timeoutSeconds, thinkingBudgetTokens, listenAddr, upstream, rateLimitPerSecond, rateLimitBurst, rateLimitPerMinute, claudeEnvJSON, quotaCookie, quotaWorkspaceID string) string {
	// 1. Resolve path
	path, err := config.DefaultPath()
	if err != nil {
		return "resolve path error: " + err.Error()
	}

	// 2. Load config
	cfg, err := config.Load(path)
	if err != nil {
		return "load error: " + err.Error()
	}

	// 3. Find and update profile
	p, ok := cfg.Profiles[profileName]
	if !ok {
		return "profile not found: " + profileName
	}

	if apiKey != "" && !isMaskedAPIKey(apiKey) {
		p.APIKey = apiKey
	}
	p.DefaultModel = defaultModel
	if p.ModelAliases == nil {
		p.ModelAliases = make(map[string]string)
	}
	p.ModelAliases["sonnet"] = sonnetAlias
	p.ModelAliases["haiku"] = haikuAlias
	p.ModelAliases["opus"] = opusAlias
	cfg.Profiles[profileName] = p
	if timeoutSeconds != "" {
		timeout, err := strconv.Atoi(timeoutSeconds)
		if err != nil {
			return "request timeout must be a number of seconds"
		}
		cfg.RequestTimeoutSeconds = timeout
	}
	if thinkingBudgetTokens != "" {
		budget, err := strconv.Atoi(thinkingBudgetTokens)
		if err != nil {
			return "thinking budget must be a number of tokens"
		}
		cfg.MaxThinkingBudgetTokens = budget
	}
	if strings.TrimSpace(listenAddr) != "" {
		cfg.Listen = strings.TrimSpace(listenAddr)
	}
	if strings.TrimSpace(upstream) != "" {
		cfg.Upstream = strings.TrimSpace(upstream)
	}
	if rateLimitPerSecond != "" {
		perSecond, err := strconv.Atoi(rateLimitPerSecond)
		if err != nil {
			return "rate limit per second must be a number"
		}
		if perSecond < 1 || perSecond > 10000 {
			return "rate limit per second must be between 1 and 10000"
		}
		cfg.RateLimitPerSecond = perSecond
	}
	if rateLimitBurst != "" {
		burst, err := strconv.Atoi(rateLimitBurst)
		if err != nil {
			return "rate limit burst must be a number"
		}
		if burst < 1 || burst > 100000 {
			return "rate limit burst must be between 1 and 100000"
		}
		cfg.RateLimitBurst = burst
	}
	if rateLimitPerMinute != "" {
		perMinute, err := strconv.Atoi(rateLimitPerMinute)
		if err != nil {
			return "rate limit per minute must be a number"
		}
		if perMinute < 0 || perMinute > 100000 {
			return "rate limit per minute must be between 0 and 100000"
		}
		cfg.RateLimitPerMinute = perMinute
	}
	if strings.TrimSpace(claudeEnvJSON) != "" {
		claudeEnv := map[string]string{}
		if err := json.Unmarshal([]byte(claudeEnvJSON), &claudeEnv); err != nil {
			return "Claude env template must be a JSON object with string values"
		}
		cfg.ClaudeEnv = claudeEnv
	}
	if strings.TrimSpace(quotaCookie) != "" {
		p.QuotaCookie = quotaCookie
	}
	if strings.TrimSpace(quotaWorkspaceID) != "" {
		p.QuotaWorkspaceID = quotaWorkspaceID
	}
	cfg.Profiles[profileName] = p
	if err := cfg.Validate(); err != nil {
		return "validation error: " + err.Error()
	}

	// 4. Save config
	if err := cfg.Save(path); err != nil {
		return "save error: " + err.Error()
	}

	// 5. Update server config in-memory if running
	if a.srv != nil {
		a.srv.ApplyConfig(cfg)
	}
	if errStr := a.SyncConfiguredIntegrations(); errStr != "success" {
		return errStr
	}

	return "success"
}

func (a *App) SyncConfiguredIntegrations() string {
	var errs []string
	if a.IsSystemEnvConfigured() {
		if errStr := a.InstallClaudeUserEnv(); errStr != "success" {
			errs = append(errs, "sync CLI error: "+errStr)
		}
	}
	if a.IsClaudeDesktopConfigured() {
		if errStr := a.SetupClaudeDesktop(); errStr != "success" {
			errs = append(errs, "sync Claude Code settings error: "+errStr)
		}
	}
	if a.IsVSCodeConfigured() {
		if errStr := a.InstallVSCodeEnv(); errStr != "success" {
			errs = append(errs, "sync VS Code error: "+errStr)
		}
	}
	if a.IsClaudeDesktopAppConfigured() {
		if errStr := a.SetupClaudeDesktopApp(); errStr != "success" {
			errs = append(errs, "sync Claude Desktop app error: "+errStr)
		}
	}
	if len(errs) > 0 {
		return strings.Join(errs, "; ")
	}
	return "success"
}

func (a *App) RepairAllConfigurations() string {
	var errs []string
	repairVSCode := a.IsVSCodeConfigured()
	repairClaudeDesktopApp := a.IsClaudeDesktopAppConfigured()
	if errStr := a.InstallClaudeUserEnv(); errStr != "success" {
		errs = append(errs, "repair CLI error: "+errStr)
	}
	if repairVSCode {
		if errStr := a.InstallVSCodeEnv(); errStr != "success" {
			errs = append(errs, "repair VS Code error: "+errStr)
		}
	}
	if repairClaudeDesktopApp {
		if errStr := a.SetupClaudeDesktopApp(); errStr != "success" {
			errs = append(errs, "repair Claude Desktop app error: "+errStr)
		}
	}
	if len(errs) > 0 {
		return strings.Join(errs, "; ")
	}
	return "success"
}

// InstallClaudeUserEnv persists Claude Code environment variables for new shells.
func (a *App) InstallClaudeUserEnv() string {

	env := a.claudeCodeEnvForClient("claude-code-cli")

	if err := unsetUserEnvironmentBatch(legacyClaudeEnvNames()); err != nil {
		return "unset environment batch error: " + err.Error()
	}
	if err := setUserEnvironmentBatch(env); err != nil {
		return "set environment batch error: " + err.Error()
	}

	if err := syncClaudeSettings(env); err != nil {

		return "sync Claude settings error: " + err.Error()

	}

	return "success"

}

// SetupClaudeDesktop writes the ocgt proxy env vars into ~/.claude/settings.json

// so the Claude Code Desktop app picks them up automatically.

// This does NOT modify Windows user environment variables — only the settings file.

func (a *App) SetupClaudeDesktop() string {

	env := a.claudeCodeEnvForClient("claude-app")

	if err := syncClaudeSettings(env); err != nil {

		return "sync Claude settings error: " + err.Error()

	}

	return "success"

}

func (a *App) IsClaudeDesktopConfigured() bool {
	return a.isClaudeSettingsConfiguredForClient("claude-app")
}

func (a *App) ClearClaudeDesktop() string {
	if err := clearClaudeSettings(); err != nil {
		return "clear Claude settings error: " + err.Error()
	}
	return "success"
}
func claudeCustomHeaders(profile, client string) string {
	if client != "" {
		return "X-Ocgt-Profile: " + profile + ", X-Ocgt-Client: " + client
	}
	return "X-Ocgt-Profile: " + profile
}

func (a *App) claudeCodeEnv() map[string]string {
	return a.claudeCodeEnvForClient("")
}

func (a *App) claudeCodeEnvForClient(client string) map[string]string {
	listenAddr := a.GetListenAddress()
	activeProfile := "opencode-go"
	thinkingBudget := config.DefaultMaxThinkingBudgetTokens
	var activeProf config.Profile
	claudeEnv := map[string]string{}

	path, err := config.DefaultPath()
	if err == nil {
		cfg, err := config.Load(path)
		if err == nil {
			activeProfile = cfg.ActiveProfile
			thinkingBudget = cfg.ThinkingBudgetTokens()
			if p, ok := cfg.Profiles[activeProfile]; ok {
				activeProf = p
			}
			for key, value := range cfg.ClaudeEnv {
				claudeEnv[key] = value
			}
		}
	}

	if len(claudeEnv) == 0 {
		claudeEnv = config.DefaultClaudeEnv(activeProf)
	}
	env := map[string]string{}
	for key, value := range claudeEnv {
		env[key] = value
	}
	env["ANTHROPIC_BASE_URL"] = "http://" + listenAddr
	env["ANTHROPIC_CUSTOM_HEADERS"] = claudeCustomHeaders(activeProfile, client)
	env["OCGT_PROFILE"] = activeProfile

	if token := a.localProxyAuthToken(); token != "" {
		env["ANTHROPIC_AUTH_TOKEN"] = token
		delete(env, "ANTHROPIC_API_KEY")
	} else {
		env["ANTHROPIC_API_KEY"] = "ocgt-local-proxy"
	}
	applyClaudeThinkingEnv(env, thinkingBudget)
	return env
}

// sanitizeEnvValue validates that a value is safe to pass as an environment variable.
// It only allows alphanumeric characters, dash, underscore, dot, colon, slash, and space.
func sanitizeEnvValue(value, name string) error {
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.' || r == ':' || r == '/' || r == ' ':
		default:
			return fmt.Errorf("invalid character %q in %s", r, name)
		}
	}
	return nil
}

// LaunchClaudeTerminal spawns a new terminal window preconfigured with the Claude Code proxy environment
func (a *App) LaunchClaudeTerminal(shell string, lang string) string {
	listenAddr := a.GetListenAddress()
	activeProfile := "opencode-go"
	defaultModel := "kimi-k2.6"
	thinkingBudget := config.DefaultMaxThinkingBudgetTokens

	// Try loading from config to get the latest
	path, err := config.DefaultPath()
	if err == nil {
		cfg, err := config.Load(path)
		if err == nil {
			activeProfile = cfg.ActiveProfile
			thinkingBudget = cfg.ThinkingBudgetTokens()
			if p, ok := cfg.Profiles[activeProfile]; ok {
				if p.DefaultModel != "" {
					defaultModel = p.DefaultModel
				}
			}
		}
	}

	// Validate inputs to prevent command injection
	if err := sanitizeEnvValue(activeProfile, "profile name"); err != nil {
		return "invalid profile name: " + err.Error()
	}
	if err := sanitizeEnvValue(defaultModel, "model name"); err != nil {
		return "invalid model name: " + err.Error()
	}
	thinkingEnv := map[string]string{}
	applyClaudeThinkingEnv(thinkingEnv, thinkingBudget)
	thinkingTokenValue := thinkingEnv["MAX_THINKING_TOKENS"]
	disableThinking := thinkingEnv["CLAUDE_CODE_DISABLE_THINKING"] == "1"
	localAuthToken := a.localProxyAuthToken()

	baseURL := "http://" + listenAddr

	// Localized greeting strings
	welcomeTitle := "[ocgt] Claude Code proxy terminal successfully launched!"
	proxyLabel := "Current Proxy: "
	modelLabel := "Current Model: "
	actionHint := "Please type 'claude' below to start coding:"
	if lang == "zh" {
		welcomeTitle = "[ocgt] Claude Code 代理终端已成功拉起！"
		proxyLabel = "当前代理: "
		modelLabel = "当前模型: "
		actionHint = "请在下方直接输入: claude"
	}

	// Sanitize ALL dynamic values before any shell interpolation
	if err := sanitizeEnvValue(listenAddr, "listen address"); err != nil {
		return "invalid listen address: " + err.Error()
	}
	if err := sanitizeEnvValue(thinkingTokenValue, "thinking token value"); err != nil {
		return "invalid thinking token: " + err.Error()
	}
	if localAuthToken != "" {
		if err := sanitizeEnvValue(localAuthToken, "local auth token"); err != nil {
			return "invalid local auth token: " + err.Error()
		}
	}

	switch runtime.GOOS {
	case "windows":
		// SECURITY: Env vars are passed via cmd.Env (child process inherits them).
		// Shell scripts reference $env:VAR (PowerShell) or %VAR% (CMD) instead of
		// interpolating values into strings — prevents command injection.
		envMap := a.claudeCodeEnvForClient("claude-code-cli")
		envMap["OCGT_DEFAULT_MODEL"] = defaultModel
		env := make([]string, 0, len(envMap)+1)
		for key, value := range envMap {
			env = append(env, fmt.Sprintf("%s=%s", key, value))
		}
		if disableThinking {
			env = append(env, "CLAUDE_CODE_DISABLE_THINKING=1")
		}

		if shell == "cmd" {
			scriptFile, err := os.CreateTemp("", "ocgt-claude-*.cmd")
			if err != nil {
				return "create cmd script error: " + err.Error()
			}
			script := "@echo off\r\n" +
				"echo =========================================================\r\n" +
				"echo  " + welcomeTitle + "\r\n" +
				"echo  " + proxyLabel + "%ANTHROPIC_BASE_URL%\r\n" +
				"echo  " + modelLabel + "%OCGT_DEFAULT_MODEL% (proxy fallback)\r\n" +
				"echo  " + actionHint + "\r\n" +
				"echo =========================================================\r\n" +
				"echo.\r\n" +
				"del \"%~f0\" >nul 2>nul\r\n"
			if _, err := scriptFile.WriteString(script); err != nil {
				_ = scriptFile.Close()
				_ = os.Remove(scriptFile.Name())
				return "write cmd script error: " + err.Error()
			}
			if err := scriptFile.Close(); err != nil {
				_ = os.Remove(scriptFile.Name())
				return "close cmd script error: " + err.Error()
			}
			cmd := exec.Command("cmd.exe", "/c", "start", "", "cmd.exe", "/k", scriptFile.Name())
			cmd.Env = mergedClaudeProcessEnv(env, disableThinking)
			if err := cmd.Run(); err != nil {
				_ = os.Remove(scriptFile.Name())
				return "launch cmd error: " + err.Error()
			}
		} else {
			scriptFile, err := os.CreateTemp("", "ocgt-claude-*.ps1")
			if err != nil {
				return "create powershell script error: " + err.Error()
			}
			psScript := "Remove-Item Env:ANTHROPIC_MODEL -ErrorAction SilentlyContinue\r\n" +
				powershellThinkingDisableScript(disableThinking) + "\r\n" +
				"Clear-Host\r\n" +
				"Write-Host '=========================================================' -ForegroundColor Cyan\r\n" +
				"Write-Host ('  " + welcomeTitle + "') -ForegroundColor Green\r\n" +
				"Write-Host ('  " + proxyLabel + "' + $env:ANTHROPIC_BASE_URL) -ForegroundColor Gray\r\n" +
				"Write-Host ('  " + modelLabel + "' + $env:OCGT_DEFAULT_MODEL + ' (proxy fallback)') -ForegroundColor Gray\r\n" +
				"Write-Host ('  " + actionHint + "') -ForegroundColor Green\r\n" +
				"Write-Host '=========================================================' -ForegroundColor Cyan\r\n" +
				"Write-Host ''\r\n" +
				"Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n"
			if _, err := scriptFile.WriteString("\xef\xbb\xbf" + psScript); err != nil {
				_ = scriptFile.Close()
				_ = os.Remove(scriptFile.Name())
				return "write powershell script error: " + err.Error()
			}
			if err := scriptFile.Close(); err != nil {
				_ = os.Remove(scriptFile.Name())
				return "close powershell script error: " + err.Error()
			}
			cmd := exec.Command("cmd.exe", "/c", "start", "", "powershell.exe", "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile.Name())
			cmd.Env = mergedClaudeProcessEnv(env, disableThinking)
			if err := cmd.Run(); err != nil {
				_ = os.Remove(scriptFile.Name())
				return "launch powershell error: " + err.Error()
			}
		}
		return "success"
	case "darwin":
		// macOS: Terminal.app doesn't inherit our env, so use export commands
		// but with all dynamic values validated above
		authScript := "unset ANTHROPIC_AUTH_TOKEN && "
		apiKeyScript := "export ANTHROPIC_API_KEY='ocgt-local-proxy' && "
		if localAuthToken != "" {
			authScript = fmt.Sprintf("export ANTHROPIC_AUTH_TOKEN='%s' && ", localAuthToken)
			apiKeyScript = "unset ANTHROPIC_API_KEY && "
		}
		script := fmt.Sprintf(
			`tell application "Terminal" to do script "unset ANTHROPIC_MODEL && export ANTHROPIC_BASE_URL='%s' && %s%sexport ANTHROPIC_CUSTOM_HEADERS='X-Ocgt-Profile: %s' && export MAX_THINKING_TOKENS='%s' && export OCGT_DEFAULT_MODEL='%s' && %sclear && echo '=========================================================' && echo ' %s' && echo ' %s$ANTHROPIC_BASE_URL' && echo ' %s$OCGT_DEFAULT_MODEL (proxy fallback)' && echo ' %s' && echo '=========================================================' && echo ''"`,
			baseURL, apiKeyScript, authScript, activeProfile+", X-Ocgt-Client: claude-code-cli", thinkingTokenValue, defaultModel, shellThinkingDisableScript(disableThinking),
			welcomeTitle, proxyLabel, modelLabel, actionHint)
		cmd := exec.Command("osascript", "-e", script)
		if err := cmd.Run(); err != nil {
			return "launch terminal error: " + err.Error()
		}
		return "success"
	default:
		return "unsupported operating system for automatic terminal launch"
	}
}

func unsetUserEnvironment(name string) error {
	return unsetUserEnvironmentBatch([]string{name})
}

func unsetUserEnvironmentBatch(names []string) error {
	for _, name := range names {
		if err := os.Unsetenv(name); err != nil {
			return err
		}
	}
	switch runtime.GOOS {
	case "windows":
		return unsetWindowsUserEnvironmentBatch(names)
	case "darwin":
		return nil
	default:
		return nil
	}
}

func legacyClaudeEnvNames() []string {
	return []string{
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_CUSTOM_HEADERS",
		"OCGT_PROFILE",
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
		"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
		"ANTHROPIC_DEFAULT_SONNET_MODEL",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL",
		"ANTHROPIC_DEFAULT_OPUS_MODEL",
		"ANTHROPIC_MODEL",
		"ANTHROPIC_SMALL_FAST_MODEL",
		"CLAUDE_CODE_SUBAGENT_MODEL",
		"API_TIMEOUT_MS",
		"CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
		"CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
		"CLAUDE_CODE_DISABLE_THINKING",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
		"DISABLE_NON_ESSENTIAL_MODEL_CALLS",
		"CLAUDE_CODE_ATTRIBUTION_HEADER",
		"CLAUDE_CODE_MAX_OUTPUT_TOKENS",
		"ENABLE_TOOL_SEARCH",
		"MAX_MCP_OUTPUT_TOKENS",
		"MCP_TIMEOUT",
		"MCP_TOOL_TIMEOUT",
	}
}

func applyClaudeThinkingEnv(env map[string]string, budgetTokens int) {
	if budgetTokens < 0 {
		env["MAX_THINKING_TOKENS"] = "0"
		env["CLAUDE_CODE_DISABLE_THINKING"] = "1"
		return
	}
	if budgetTokens == 0 {
		budgetTokens = config.DefaultMaxThinkingBudgetTokens
	}
	env["MAX_THINKING_TOKENS"] = strconv.Itoa(budgetTokens)
}

func mergedClaudeProcessEnv(overrides []string, disableThinking bool) []string {
	drop := map[string]bool{
		"ANTHROPIC_AUTH_TOKEN":         true,
		"ANTHROPIC_BASE_URL":           true,
		"ANTHROPIC_API_KEY":            true,
		"ANTHROPIC_CUSTOM_HEADERS":     true,
		"ANTHROPIC_MODEL":              true,
		"MAX_THINKING_TOKENS":          true,
		"CLAUDE_CODE_DISABLE_THINKING": !disableThinking,
	}
	out := make([]string, 0, len(os.Environ())+len(overrides))
	for _, item := range os.Environ() {
		name, _, found := strings.Cut(item, "=")
		if found && drop[name] {
			continue
		}
		out = append(out, item)
	}
	return append(out, overrides...)
}

func powershellThinkingDisableScript(disabled bool) string {
	if disabled {
		return "$env:CLAUDE_CODE_DISABLE_THINKING='1'; "
	}
	return "Remove-Item Env:CLAUDE_CODE_DISABLE_THINKING -ErrorAction SilentlyContinue; "
}

func shellThinkingDisableScript(disabled bool) string {
	if disabled {
		return "export CLAUDE_CODE_DISABLE_THINKING='1' && "
	}
	return "unset CLAUDE_CODE_DISABLE_THINKING && "
}

// OpenConfigLocation opens the directory containing the config file
func (a *App) OpenConfigLocation() string {
	path, err := config.DefaultPath()
	if err != nil {
		return "resolve path error: " + err.Error()
	}
	dir := filepath.Dir(path)

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer.exe", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		return "unsupported operating system"
	}

	if err := cmd.Start(); err != nil {
		return "open error: " + err.Error()
	}
	return "success"
}

func setUserEnvironment(name, value string) error {
	return setUserEnvironmentBatch(map[string]string{name: value})
}

func setUserEnvironmentBatch(env map[string]string) error {
	for k, v := range env {
		if err := os.Setenv(k, v); err != nil {
			return err
		}
	}
	switch runtime.GOOS {
	case "windows":
		return setWindowsUserEnvironmentBatch(env)
	case "darwin":
		return nil
	default:
		return nil
	}
}

// claudeSettingsPreserveFields lists top-level keys in ~/.claude/settings.json that
// must survive across tool switches.  Third-party tools like CC-Switch overwrite the
// entire file with only their "env" block, erasing permissions, plugins, etc.  When
// ocgt syncs settings it restores any missing preserve-fields from the last known-good
// backup.
var claudeSettingsPreserveFields = []string{
	"permissions",
	"model",
	"enabledPlugins",
	"statusLine",
	"allowedTools",
}

// syncClaudeSettings merges the given env vars into ~/.claude/settings.json.
// It preserves top-level fields like permissions, model, enabledPlugins, etc.
// NOTE: settings.json must be valid JSON (no comments). If it contains JSON
// comments, parsing will fail and the operation will abort safely.
func syncClaudeSettings(env map[string]string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")
	backupPath := filepath.Join(home, ".claude", "settings.json.ocgt-bak")

	settings := map[string]any{}
	if data, err := os.ReadFile(settingsPath); err == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &settings); err != nil {
			return err
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}

	// If a previous ocgt backup exists, restore any preserve-fields that are
	// missing from the current settings (e.g. CC-Switch wiped them).
	if backup, err := os.ReadFile(backupPath); err == nil && len(backup) > 0 {
		bakSettings := map[string]any{}
		if json.Unmarshal(backup, &bakSettings) == nil {
			for _, key := range claudeSettingsPreserveFields {
				if _, exists := settings[key]; !exists {
					if val, ok := bakSettings[key]; ok {
						settings[key] = val
					}
				}
			}
		}
	}

	envMap, _ := settings["env"].(map[string]any)
	if envMap == nil {
		envMap = map[string]any{}
	}
	for _, name := range legacyClaudeEnvNames() {
		delete(envMap, name)
	}

	for key, value := range env {
		envMap[key] = value
	}
	settings["env"] = envMap

	if err := os.MkdirAll(filepath.Dir(settingsPath), 0o700); err != nil {
		return err
	}
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(settingsPath, append(out, '\n'), 0o600); err != nil {
		return err
	}

	// Keep a backup of the full settings (including preserve-fields) so that a
	// future external overwrite can be repaired on the next sync.
	if err := os.WriteFile(backupPath, append(out, '\n'), 0o600); err != nil {
		log.Printf("ocgt: failed to write settings backup: %v", err)
	}

	return nil
}

// clearClaudeSettings removes ocgt-specific env vars from ~/.claude/settings.json.
func clearClaudeSettings() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return err
	}
	envMap, _ := settings["env"].(map[string]any)
	if envMap == nil {
		return nil
	}
	for _, key := range []string{
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_CUSTOM_HEADERS",
		"OCGT_PROFILE",
		"ANTHROPIC_AUTH_TOKEN",
	} {
		delete(envMap, key)
	}
	if len(envMap) == 0 {
		delete(settings, "env")
	} else {
		settings["env"] = envMap
	}
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(settingsPath, append(out, '\n'), 0o600); err != nil {
		return err
	}
	return nil
}

// beforeClose is called when the user clicks the 'X' button.
// IMPORTANT: On Windows, calling wailsruntime.MessageDialog inside this callback
// is unreliable and causes deadlocks because the window is mid-close.
// Instead we always prevent the close here, then emit an event to the frontend
// which shows a premium custom HTML modal to let the user decide.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.forceQuit.Load() {
		return false
	}

	prefs, err := preferences.Load("")
	closeBehavior := preferences.DefaultCloseBehavior
	if err == nil {
		closeBehavior = prefs.CloseBehavior
	}

	switch closeBehavior {
	case "exit":
		a.forceQuit.Store(true)
		// Directly exit — no dialog needed
		return false
	case "minimize":
		// Silently hide to tray — no dialog needed
		go func() {
			time.Sleep(50 * time.Millisecond)
			a.enqueueTrayAction(trayActionHide)
		}()
		return true
	default: // "prompt"
		// Emit event to frontend so it can show its own custom HTML modal.
		// This avoids the Windows deadlock caused by OS dialogs inside OnBeforeClose.
		go func() {
			time.Sleep(50 * time.Millisecond)
			wailsruntime.EventsEmit(ctx, "show-close-dialog")
		}()
		return true // prevent OS close; frontend modal will call QuitApp or HideToTray
	}
}

// QuitApp exits the application cleanly. Called from the frontend close-dialog modal.
func (a *App) QuitApp() {
	a.exitNow()
}

func (a *App) exitNow() {
	a.exitOnce.Do(func() {
		a.forceQuit.Store(true)
		if a.ctx != nil {
			wailsruntime.Quit(a.ctx)
			// Hard fallback: if Wails doesn't shut down cleanly within 2 seconds,
			// force-exit to prevent a zombie process. Also clean up the systray
			// icon to avoid orphaned notification area icons on Windows.
			time.AfterFunc(2*time.Second, func() {
				log.Println("[exit] Wails did not shut down in time, forcing exit")
				a.quitSystray()
				os.Exit(0)
			})
			return
		}
		a.shutdown(context.Background())
		os.Exit(0)
	})
}

// HideToTray hides the main window to the system tray. Called from the frontend close-dialog modal.
func (a *App) HideToTray() {
	a.forceQuit.Store(false)
	a.enqueueTrayAction(trayActionHide)
}

// ShowAboutDialog shows an about info dialog. Emits an event to the frontend
// so the display runs safely on the Wails JS thread (avoids tray-thread deadlock).
func (a *App) ShowAboutDialog() {
	a.enqueueTrayAction(trayActionAbout)
}

// SavePreferences updates preferences like window close behavior.
func (a *App) SavePreferences(closeBehavior string) string {
	prefs, err := preferences.Load("")
	if err != nil {
		prefs = preferences.Preferences{}
	}
	prefs.CloseBehavior = closeBehavior
	if err := prefs.Save(""); err != nil {
		return "save error: " + err.Error()
	}
	if err := removeLegacyCloseBehaviorFromConfig(); err != nil {
		log.Println("[GUI preferences] legacy close_behavior cleanup error:", err)
	}
	return "success"
}

func (a *App) SaveUIPreferences(theme, language string, accentHue int, lastView, compactShell, expandedIntegrationsJSON string) string {
	prefs, err := preferences.Load("")
	if err != nil {
		prefs = preferences.Preferences{}
	}
	if strings.TrimSpace(theme) != "" {
		prefs.Theme = theme
	}
	if strings.TrimSpace(language) != "" {
		prefs.Language = language
	}
	if accentHue >= 0 {
		prefs.AccentHue = accentHue
	}
	if strings.TrimSpace(lastView) != "" {
		prefs.LastView = lastView
	}
	if strings.TrimSpace(compactShell) != "" {
		prefs.CompactShell = compactShell
	}
	if strings.TrimSpace(expandedIntegrationsJSON) != "" {
		var expanded []string
		if err := json.Unmarshal([]byte(expandedIntegrationsJSON), &expanded); err != nil {
			return "validation error: expanded integrations must be a JSON array"
		}
		prefs.ExpandedIntegrations = expanded
	}
	if err := prefs.Save(""); err != nil {
		return "save error: " + err.Error()
	}
	return "success"
}

// GetPreferences returns GUI-only preferences. These are intentionally kept
// outside the proxy config so CLI/server config stays portable.
func (a *App) GetPreferences() map[string]string {
	prefs, err := preferences.Load("")
	if err != nil {
		log.Println("[GUI preferences] load error:", err)
		prefs = preferences.Preferences{
			CloseBehavior:        preferences.DefaultCloseBehavior,
			LogEnabled:           preferences.DefaultLogEnabled,
			LogRetentionDays:     preferences.DefaultLogRetentionDays,
			Theme:                preferences.DefaultTheme,
			Language:             preferences.DefaultLanguage,
			AccentHue:            preferences.DefaultAccentHue,
			LastView:             preferences.DefaultLastView,
			CompactShell:         preferences.DefaultCompactShell,
			ExpandedIntegrations: []string{},
		}
		if dir, dirErr := preferences.DefaultLogDirectory(); dirErr == nil {
			prefs.LogDirectory = dir
		}
	}
	expanded, _ := json.Marshal(prefs.ExpandedIntegrations)
	return map[string]string{
		"close_behavior":        prefs.CloseBehavior,
		"log_enabled":           strconv.FormatBool(prefs.LogEnabled),
		"log_directory":         prefs.LogDirectory,
		"log_retention_days":    strconv.Itoa(prefs.LogRetentionDays),
		"theme":                 prefs.Theme,
		"language":              prefs.Language,
		"accent_hue":            strconv.Itoa(prefs.AccentHue),
		"last_view":             prefs.LastView,
		"compact_shell":         prefs.CompactShell,
		"expanded_integrations": string(expanded),
	}
}

// FetchQuota queries OpenCode Go quota from the opencode.ai RPC endpoint.
// Called from the frontend via Wails binding. Returns JSON-serializable result.
// Credentials are resolved in this order: Profile config → env vars.
func (a *App) FetchQuota() map[string]any {
	cookie, workspaceID := a.resolveQuotaCredentials()
	data, err := quota.FetchOpenCodeGoQuota(cookie, workspaceID)
	if err != nil {
		return map[string]any{
			"success":       false,
			"provider_name": "opencode-go",
			"error":         err.Error(),
		}
	}

	// Also cache in the proxy server so /ocgt/api/quota returns it
	if a.srv != nil {
		a.srv.SetQuotaData(data)
	}

	return map[string]any{
		"success":       true,
		"provider_name": "opencode-go",
		"data":          data,
	}
}

// FetchUpstreamModels fetches the upstream model list through the proxy server
// (no CORS, carries the configured API key for the active profile).
// Returns {"success": true, "data": <normalized models>} or {"success": false, "error": "..."}.
func (a *App) FetchUpstreamModels() map[string]any {
	if a.srv == nil {
		return map[string]any{"success": false, "error": "proxy server not started"}
	}
	data, err := a.srv.FetchUpstreamModels(context.Background())
	if err != nil {
		return map[string]any{"success": false, "error": err.Error()}
	}
	return map[string]any{"success": true, "data": data}
}

// resolveQuotaCredentials resolves quota credentials from config or env vars.
// Priority: Profile.QuotaCookie/QuotaWorkspaceID → env vars.
func (a *App) resolveQuotaCredentials() (cookie, workspaceID string) {
	cookie = os.Getenv("OPENCODE_GO_AUTH_COOKIE")
	workspaceID = os.Getenv("OPENCODE_GO_WORKSPACE_ID")
	if cookie != "" && workspaceID != "" {
		return
	}

	path, err := config.DefaultPath()
	if err == nil {
		cfg, err := config.Load(path)
		if err == nil {
			if profile, _, err := cfg.Profile(""); err == nil {
				if cookie == "" && profile.QuotaCookie != "" {
					cookie = profile.QuotaCookie
				}
				if workspaceID == "" && profile.QuotaWorkspaceID != "" {
					workspaceID = profile.QuotaWorkspaceID
				}
			}
		}
	}
	return
}

func isMaskedAPIKey(key string) bool {
	return key == "****" || strings.Contains(key, "...")
}

func removeLegacyCloseBehaviorFromConfig() error {
	path, err := config.DefaultPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if _, ok := raw["close_behavior"]; !ok {
		return nil
	}
	delete(raw, "close_behavior")
	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(out, '\n'), 0o600)
}
