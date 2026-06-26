package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

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
