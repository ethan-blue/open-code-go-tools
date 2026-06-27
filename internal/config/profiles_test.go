package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultProfiles(t *testing.T) {
	dp := DefaultProfiles()
	if dp.ActiveProfile != "default" {
		t.Errorf("expected active_profile 'default', got '%s'", dp.ActiveProfile)
	}
	if _, ok := dp.Profiles["default"]; !ok {
		t.Error("expected 'default' profile to exist")
	}
	if len(dp.Presets) != 4 {
		t.Errorf("expected 4 built-in presets, got %d", len(dp.Presets))
	}
}

func TestLoadProfiles_NonExistent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "profiles.json")

	cfg, err := LoadProfiles(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ActiveProfile != "default" {
		t.Errorf("expected default active_profile, got '%s'", cfg.ActiveProfile)
	}
}

func TestSaveAndLoadProfiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "profiles.json")

	original := &ProfilesConfig{
		ActiveProfile: "test",
		Profiles: map[string]Profile{
			"test": {
				APIKey:       "sk-test-123",
				DefaultModel: "kimi-k2.6",
				ModelAliases: map[string]string{"sonnet": "deepseek-v4-pro"},
			},
		},
		Presets: BuiltInPresets,
	}

	if err := SaveProfiles(original, path); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	loaded, err := LoadProfiles(path)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}

	if loaded.ActiveProfile != "test" {
		t.Errorf("expected active_profile 'test', got '%s'", loaded.ActiveProfile)
	}
	p, ok := loaded.Profiles["test"]
	if !ok {
		t.Fatal("expected 'test' profile to exist")
	}
	if p.APIKey != "sk-test-123" {
		t.Errorf("expected api_key 'sk-test-123', got '%s'", p.APIKey)
	}
	if p.ModelAliases["sonnet"] != "deepseek-v4-pro" {
		t.Errorf("expected model alias sonnet→deepseek-v4-pro")
	}
}

func TestLoadProfiles_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "profiles.json")
	os.WriteFile(path, []byte("not json"), 0o600)

	_, err := LoadProfiles(path)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestProfilesConfig_Profile(t *testing.T) {
	cfg := &ProfilesConfig{
		ActiveProfile: "active",
		Profiles: map[string]Profile{
			"default": {DefaultModel: "model-a"},
			"active":  {DefaultModel: "model-b"},
		},
	}

	// Active profile
	p, ok := cfg.Profile("")
	if !ok || p.DefaultModel != "model-b" {
		t.Errorf("expected active profile model-b, got %v", p.DefaultModel)
	}

	// Named profile
	p, ok = cfg.Profile("default")
	if !ok || p.DefaultModel != "model-a" {
		t.Errorf("expected default profile model-a, got %v", p.DefaultModel)
	}

	// Non-existent
	_, ok = cfg.Profile("missing")
	if ok {
		t.Error("expected false for missing profile")
	}
}

func TestProfilesConfig_ActiveProfileOrDefault(t *testing.T) {
	cfg := &ProfilesConfig{ActiveProfile: "custom"}
	if cfg.ActiveProfileOrDefault() != "custom" {
		t.Errorf("expected 'custom'")
	}

	cfg.ActiveProfile = ""
	if cfg.ActiveProfileOrDefault() != "default" {
		t.Errorf("expected 'default'")
	}
}

func TestProfilesConfig_ResolveModel(t *testing.T) {
	cfg := &ProfilesConfig{
		ActiveProfile: "default",
		Profiles: map[string]Profile{
			"default": {
				ModelAliases: map[string]string{"sonnet": "deepseek-v4-pro"},
			},
		},
	}

	// Resolved alias
	if resolved := cfg.ResolveModel("sonnet"); resolved != "deepseek-v4-pro" {
		t.Errorf("expected deepseek-v4-pro, got %s", resolved)
	}

	// Unknown model passes through
	if resolved := cfg.ResolveModel("gpt-4"); resolved != "gpt-4" {
		t.Errorf("expected gpt-4 passthrough, got %s", resolved)
	}
}

func TestBuiltInPresets(t *testing.T) {
	expected := []string{"default", "precise", "creative", "code"}
	for _, name := range expected {
		preset, ok := BuiltInPresets[name]
		if !ok {
			t.Errorf("missing preset: %s", name)
			continue
		}
		if preset.Name == "" {
			t.Errorf("preset %s has empty name", name)
		}
		if preset.DefaultModel == "" {
			t.Errorf("preset %s has empty default_model", name)
		}
	}
}

func TestSaveProfiles_CreatesDirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "dir", "profiles.json")

	cfg := DefaultProfiles()
	if err := SaveProfiles(cfg, path); err != nil {
		t.Fatalf("expected directory creation, got error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	var loaded ProfilesConfig
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("failed to parse saved JSON: %v", err)
	}
}
