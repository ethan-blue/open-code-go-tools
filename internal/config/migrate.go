package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// MigrateLegacyConfig splits old config.json into config.json + profiles.json
// Called on first startup when profiles.json doesn't exist.
func MigrateLegacyConfig(oldPath string) error {
	if oldPath == "" {
		var err error
		oldPath, err = DefaultPath()
		if err != nil {
			return err
		}
	}

	// 1. Read old config.json
	data, err := os.ReadFile(oldPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No legacy config to migrate
		}
		return err
	}

	// 2. Parse as raw map to extract fields
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("failed to parse legacy config: %w", err)
	}

	// 3. Extract L1 fields → new Config
	cfg := &Config{
		Listen:                  "127.0.0.1:8787",
		Upstream:                "https://opencode.ai/zen/go",
		RequestTimeoutSeconds:   300,
		MaxThinkingBudgetTokens: 2048,
	}

	if v, ok := raw["listen"]; ok {
		json.Unmarshal(v, &cfg.Listen)
	}
	if v, ok := raw["upstream"]; ok {
		json.Unmarshal(v, &cfg.Upstream)
	}
	if v, ok := raw["request_timeout_seconds"]; ok {
		json.Unmarshal(v, &cfg.RequestTimeoutSeconds)
	}
	if v, ok := raw["max_thinking_budget_tokens"]; ok {
		json.Unmarshal(v, &cfg.MaxThinkingBudgetTokens)
	}
	if v, ok := raw["rate_limit_per_second"]; ok {
		json.Unmarshal(v, &cfg.RateLimitPerSecond)
	}
	if v, ok := raw["rate_limit_burst"]; ok {
		json.Unmarshal(v, &cfg.RateLimitBurst)
	}
	if v, ok := raw["rate_limit_per_minute"]; ok {
		json.Unmarshal(v, &cfg.RateLimitPerMinute)
	}
	if v, ok := raw["local_auth_token"]; ok {
		json.Unmarshal(v, &cfg.LocalAuthToken)
	}
	if v, ok := raw["max_concurrent_requests"]; ok {
		json.Unmarshal(v, &cfg.MaxConcurrentRequests)
	}
	if v, ok := raw["plugins"]; ok {
		json.Unmarshal(v, &cfg.Plugins)
	}

	// 4. Extract L2 fields → new ProfilesConfig
	profiles := DefaultProfiles()

	if v, ok := raw["active_profile"]; ok {
		json.Unmarshal(v, &profiles.ActiveProfile)
	}
	if v, ok := raw["profiles"]; ok {
		json.Unmarshal(v, &profiles.Profiles)
	}
	if v, ok := raw["claude_env"]; ok {
		json.Unmarshal(v, &profiles.ClaudeEnv)
	}

	// 5. Save both files
	if err := cfg.Save(""); err != nil {
		return fmt.Errorf("failed to save new config.json: %w", err)
	}
	if err := SaveProfiles(profiles, ""); err != nil {
		return fmt.Errorf("failed to save profiles.json: %w", err)
	}

	// 6. Rename old config.json → config.json.bak
	backupPath := oldPath + ".bak"
	if err := os.Rename(oldPath, backupPath); err != nil {
		// Non-fatal: log but don't fail
		fmt.Printf("warning: failed to backup legacy config: %v\n", err)
	}

	return nil
}

// NeedsMigration checks if profiles.json exists
func NeedsMigration() bool {
	path, err := ProfilesPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return os.IsNotExist(err)
}

// EnsureMigration runs migration if needed
func EnsureMigration() error {
	if !NeedsMigration() {
		return nil
	}
	return MigrateLegacyConfig("")
}
