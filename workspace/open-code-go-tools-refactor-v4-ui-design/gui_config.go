package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

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

// SetAuthEnabled enables or disables local auth token protection.
// When enabled, generates a random token if none exists and persists it.
// When disabled, clears the token from config.
func (a *App) SetAuthEnabled(enabled bool) string {
	path, err := config.DefaultPath()
	if err != nil {
		return "resolve path error: " + err.Error()
	}
	cfg, err := config.Load(path)
	if err != nil {
		return "load error: " + err.Error()
	}
	if enabled {
		if cfg.LocalAuthToken == "" {
			buf := make([]byte, 24)
			if _, err := rand.Read(buf); err != nil {
				return "failed to generate token: " + err.Error()
			}
			cfg.LocalAuthToken = hex.EncodeToString(buf)
		}
	} else {
		cfg.LocalAuthToken = ""
	}
	if err := cfg.Save(path); err != nil {
		return "save error: " + err.Error()
	}
	// Update live server config if running
	if a.srv != nil {
		a.srv.UpdateAuthToken(cfg.LocalAuthToken)
	}
	return ""
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
	if a.IsCodexConfigured() {
		if errStr := a.SetupCodex(); errStr != "success" {
			errs = append(errs, "sync Codex error: "+errStr)
		}
	}
	if len(errs) > 0 {
		return strings.Join(errs, "; ")
	}
	return "success"
