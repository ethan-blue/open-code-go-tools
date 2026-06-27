package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyConfig_SplitsCorrectly(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "config.json")

	// Create legacy config with mixed L1 + L2 fields
	legacy := map[string]interface{}{
		"listen":                    "127.0.0.1:9999",
		"upstream":                  "https://custom.upstream.com",
		"request_timeout_seconds":   600,
		"max_thinking_budget_tokens": 4096,
		"rate_limit_per_second":     50,
		"local_auth_token":          "token-abc",
		"active_profile":            "myprofile",
		"profiles": map[string]interface{}{
			"myprofile": map[string]interface{}{
				"api_key":       "sk-test",
				"default_model": "deepseek-v4-pro",
			},
		},
	}

	data, _ := json.MarshalIndent(legacy, "", "  ")
	os.WriteFile(oldPath, data, 0o600)

	// Run migration
	if err := MigrateLegacyConfig(oldPath); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	// Verify L1 config.json was created
	cfgPath := filepath.Join(dir, "config.json")
	cfgData, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("new config.json not created: %v", err)
	}

	var cfg Config
	if err := json.Unmarshal(cfgData, &cfg); err != nil {
		t.Fatalf("failed to parse new config.json: %v", err)
	}

	if cfg.Listen != "127.0.0.1:9999" {
		t.Errorf("expected listen '127.0.0.1:9999', got '%s'", cfg.Listen)
	}
	if cfg.Upstream != "https://custom.upstream.com" {
		t.Errorf("expected upstream, got '%s'", cfg.Upstream)
	}
	if cfg.RequestTimeoutSeconds != 600 {
		t.Errorf("expected timeout 600, got %d", cfg.RequestTimeoutSeconds)
	}

	// Verify L2 profiles.json was created
	profPath := filepath.Join(dir, "profiles.json")
	profData, err := os.ReadFile(profPath)
	if err != nil {
		t.Fatalf("profiles.json not created: %v", err)
	}

	var profiles ProfilesConfig
	if err := json.Unmarshal(profData, &profiles); err != nil {
		t.Fatalf("failed to parse profiles.json: %v", err)
	}

	if profiles.ActiveProfile != "myprofile" {
		t.Errorf("expected active_profile 'myprofile', got '%s'", profiles.ActiveProfile)
	}
	p, ok := profiles.Profiles["myprofile"]
	if !ok {
		t.Fatal("expected 'myprofile' profile to exist")
	}
	if p.APIKey != "sk-test" {
		t.Errorf("expected api_key 'sk-test', got '%s'", p.APIKey)
	}

	// Verify backup was created
	if _, err := os.Stat(oldPath + ".bak"); err != nil {
		t.Error("expected backup file to be created")
	}
}

func TestMigrateLegacyConfig_NoFile(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "config.json")

	// No file → no error
	if err := MigrateLegacyConfig(oldPath); err != nil {
		t.Fatalf("expected no error for missing file, got: %v", err)
	}
}

func TestMigrateLegacyConfig_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "config.json")
	os.WriteFile(oldPath, []byte("not json"), 0o600)

	err := MigrateLegacyConfig(oldPath)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestNeedsMigration_WhenNoProfiles(t *testing.T) {
	// This test depends on the home directory state, so we test the logic indirectly
	// by checking that NeedsMigration returns a bool without panic
	_ = NeedsMigration()
}

func TestEnsureMigration_Idempotent(t *testing.T) {
	// EnsureMigration should be safe to call multiple times
	// If no migration needed, it returns nil
	if err := EnsureMigration(); err != nil {
		t.Fatalf("EnsureMigration failed: %v", err)
	}
	// Call again — should be idempotent
	if err := EnsureMigration(); err != nil {
		t.Fatalf("EnsureMigration failed on second call: %v", err)
	}
}
