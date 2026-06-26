package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

func (a *App) RepairAllConfigurations() string {
	var errs []string
	repairCLI := a.IsSystemEnvConfigured()
	repairVSCode := a.IsVSCodeConfigured()
	repairClaudeDesktopApp := a.IsClaudeDesktopAppConfigured()
	repairCodex := a.IsCodexConfigured()
	if repairCLI {
		if errStr := a.InstallClaudeUserEnv(); errStr != "success" {
			errs = append(errs, "repair CLI error: "+errStr)
		}
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
	if repairCodex {
		if errStr := a.SetupCodex(); errStr != "success" {
			errs = append(errs, "repair Codex error: "+errStr)
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
