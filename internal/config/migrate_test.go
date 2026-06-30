package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyConfig_PromotesQuotaToTopLevel(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)

	configPath := filepath.Join(dir, "config.json")
	// Legacy layout: quota fields buried inside a profile entry, no top-level
	// quota_cookie / quota_workspace_id yet.
	legacy := map[string]interface{}{
		"listen":          "127.0.0.1:9999",
		"upstream":        "https://custom.upstream.com",
		"active_profile":  "myprofile",
		"quota_cookie":    "",
		"quota_workspace": "",
		"profiles": map[string]interface{}{
			"myprofile": map[string]interface{}{
				"api_key":             "sk-test",
				"default_model":       "deepseek-v4-pro",
				"quota_cookie":        "cookie-abc",
				"quota_workspace_id":  "ws-123",
			},
		},
	}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(configPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := MigrateLegacyConfig(configPath); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	migrated, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]interface{}
	if err := json.Unmarshal(migrated, &got); err != nil {
		t.Fatalf("failed to parse migrated config: %v", err)
	}

	if got["quota_cookie"] != "cookie-abc" {
		t.Errorf("expected quota_cookie promoted to 'cookie-abc', got %v", got["quota_cookie"])
	}
	if got["quota_workspace_id"] != "ws-123" {
		t.Errorf("expected quota_workspace_id promoted to 'ws-123', got %v", got["quota_workspace_id"])
	}
}

func TestMigrateLegacyConfig_Idempotent(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)

	configPath := filepath.Join(dir, "config.json")
	// Already-migrated layout: quota at top level, no profiles.
	already := `{
	  "listen": "127.0.0.1:9999",
	  "upstream": "https://custom.upstream.com",
	  "quota_cookie": "cookie-abc",
	  "quota_workspace_id": "ws-123"
	}`
	if err := os.WriteFile(configPath, []byte(already), 0o600); err != nil {
		t.Fatal(err)
	}

	before, _ := os.ReadFile(configPath)
	if err := MigrateLegacyConfig(configPath); err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	after, _ := os.ReadFile(configPath)

	// Re-marshalling may reorder keys, so compare parsed values not bytes.
	var b, a map[string]interface{}
	json.Unmarshal(before, &b)
	json.Unmarshal(after, &a)
	if a["quota_cookie"] != b["quota_cookie"] || a["quota_workspace_id"] != b["quota_workspace_id"] {
		t.Errorf("idempotent migration changed quota fields: before=%v after=%v", b, a)
	}
}

func TestMigrateLegacyConfig_NoFile(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")

	// No file → no error
	if err := MigrateLegacyConfig(configPath); err != nil {
		t.Fatalf("expected no error for missing file, got: %v", err)
	}
}

func TestMigrateLegacyConfig_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	os.WriteFile(configPath, []byte("not json"), 0o600)

	err := MigrateLegacyConfig(configPath)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestNeedsMigration(t *testing.T) {
	// Should return a bool without panic regardless of home state.
	_ = NeedsMigration()
}

func TestEnsureMigration_Idempotent(t *testing.T) {
	// EnsureMigration should be safe to call multiple times.
	if err := EnsureMigration(); err != nil {
		t.Fatalf("EnsureMigration failed: %v", err)
	}
	if err := EnsureMigration(); err != nil {
		t.Fatalf("EnsureMigration failed on second call: %v", err)
	}
}
