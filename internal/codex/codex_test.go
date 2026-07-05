package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func tempCodexDir(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	return dir, configPath
}

func setHomeDir(t *testing.T, dir string) {
	t.Helper()
	oldHome := os.Getenv("HOME")
	oldUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", dir)
	os.Setenv("USERPROFILE", dir)
	t.Cleanup(func() {
		os.Setenv("HOME", oldHome)
		os.Setenv("USERPROFILE", oldUserProfile)
	})
}

func TestConfigPath(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)
	// Create the .codex dir within the temp home
	codexDir := filepath.Join(dir, ".codex")
	if err := os.MkdirAll(codexDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// ConfigPath uses os.UserHomeDir() + "/.codex/config.toml"
	// Since we set HOME, UserHomeDir should return our temp dir
	p, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Join(dir, ".codex", "config.toml")
	if !strings.HasSuffix(p, "config.toml") && !strings.Contains(p, ".codex") {
		t.Errorf("expected path to contain .codex/config.toml, got %s", p)
	}
	_ = expected
}

func TestIsConfigured_NotExist(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)
	configured, err := IsConfigured()
	if err != nil {
		t.Fatal(err)
	}
	if configured {
		t.Error("expected not configured")
	}
}

func TestWriteAndUndoConfig(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	cfg := ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		APIKey:       "test-key-12345",
		EnvKey:       "OCGT_CODEX_API_KEY",
		Model:        "claude-sonnet-4-5",
		WireAPI:      "chat",
	}

	written, err := WriteConfig(cfg)
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(written); err != nil {
		t.Fatalf("config file not created: %v", err)
	}

	// Check IsConfigured returns true
	configured, err := IsConfigured()
	if err != nil {
		t.Fatal(err)
	}
	if !configured {
		t.Error("expected configured after WriteConfig")
	}

	// Read and verify content
	data, err := os.ReadFile(written)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if !strings.Contains(content, beginMarker) {
		t.Error("missing begin marker")
	}
	if !strings.Contains(content, endMarker) {
		t.Error("missing end marker")
	}
	if !strings.Contains(content, `model_provider = "ocgt"`) {
		t.Error("missing model_provider")
	}
	if !strings.Contains(content, `model = "claude-sonnet-4-5"`) {
		t.Error("missing model")
	}
	if !strings.Contains(content, `base_url = "http://127.0.0.1:8787/v1"`) {
		t.Error("missing base_url with /v1 suffix")
	}
	if !strings.Contains(content, `env_key = "OCGT_CODEX_API_KEY"`) {
		t.Error("missing env_key")
	}
	// Legacy "chat" input must land as "responses" — Codex removed chat support.
	if !strings.Contains(content, `wire_api = "responses"`) {
		t.Error("missing wire_api")
	}

	// Undo
	if err := UndoConfig(); err != nil {
		t.Fatalf("UndoConfig failed: %v", err)
	}

	// Check IsConfigured returns false after undo
	configured, err = IsConfigured()
	if err != nil {
		t.Fatal(err)
	}
	if configured {
		t.Error("expected not configured after UndoConfig")
	}
}

func TestWriteConfig_MergePreservesExisting(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	// Write pre-existing content
	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	existing := "# pre-existing config\napproval_policy = \"on-request\"\n"
	if err := os.WriteFile(configPath, []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		APIKey:       "test-key",
		EnvKey:       "OCGT_CODEX_API_KEY",
		Model:        "claude-sonnet-4-5",
	}

	_, err = WriteConfig(cfg)
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	// Pre-existing content should survive
	if !strings.Contains(content, "approval_policy") {
		t.Error("pre-existing content lost")
	}
	// New content should be present
	if !strings.Contains(content, beginMarker) {
		t.Error("missing ocgt block")
	}
}

func TestWriteConfig_InsertsManagedBlockBeforeTables(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	existing := "approval_policy = \"on-request\"\n\n[windows]\nmodel = \"keep-this-table-key\"\n"
	if err := os.WriteFile(configPath, []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = WriteConfig(ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "local-token",
		Model:        "deepseek-v4-pro",
		WireAPI:      "responses",
	})
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if strings.Index(content, `model_provider = "ocgt"`) > strings.Index(content, "[windows]") {
		t.Fatalf("managed root keys were written inside a TOML table:\n%s", content)
	}
	if !strings.Contains(content, "[windows]\nmodel = \"keep-this-table-key\"") {
		t.Fatalf("table-scoped model key was removed:\n%s", content)
	}
}

func TestWriteConfig_RemovesStaleDuplicateOcgtTable(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	existing := `approval_policy = "on-request"

# ocgt-managed-begin — old marker
# ocgt-managed-begin
model_provider = "ocgt"
model = "old"

[model_providers.ocgt]
name = "ocgt"
base_url = "http://127.0.0.1:8787/v1"
experimental_bearer_token = "old"
wire_api = "responses"
# ocgt-managed-end

[model_providers.ocgt]
name = "ocgt"
base_url = "http://127.0.0.1:8787/v1"
experimental_bearer_token = "orphan"
wire_api = "responses"
# ocgt-managed-end

[desktop]
followUpQueueMode = "queue"
`
	if err := os.WriteFile(configPath, []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = WriteConfig(ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "new-token",
		Model:        "deepseek-v4-pro",
		WireAPI:      "responses",
	})
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if got := strings.Count(content, "[model_providers.ocgt]"); got != 1 {
		t.Fatalf("expected one ocgt provider table, got %d:\n%s", got, content)
	}
	if got := strings.Count(content, beginMarker); got != 1 {
		t.Fatalf("expected one managed block, got %d:\n%s", got, content)
	}
}

func TestWriteConfig_ReplacesExistingBlock(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}

	// First write
	cfg1 := ProviderConfig{
		ProviderName: "first",
		BaseURL:      "http://old.example.com",
		APIKey:       "old-key",
		EnvKey:       "OLD_KEY",
		Model:        "old-model",
	}
	_, err = WriteConfig(cfg1)
	if err != nil {
		t.Fatalf("first WriteConfig failed: %v", err)
	}

	// Second write with different config
	cfg2 := ProviderConfig{
		ProviderName: "second",
		BaseURL:      "http://new.example.com",
		APIKey:       "new-key",
		EnvKey:       "NEW_KEY",
		Model:        "new-model",
	}
	_, err = WriteConfig(cfg2)
	if err != nil {
		t.Fatalf("second WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	// Should only contain the new config, not the old one
	if strings.Contains(content, `model_provider = "first"`) {
		t.Error("old model_provider still present")
	}
	if strings.Contains(content, `old.example.com`) {
		t.Error("old base URL still present")
	}
	if !strings.Contains(content, `model_provider = "second"`) {
		t.Error("new model_provider missing")
	}
	if !strings.Contains(content, `new.example.com`) {
		t.Error("new base URL missing")
	}

	// Only one begin marker should exist
	if strings.Count(content, beginMarker) != 1 {
		t.Errorf("expected 1 begin marker, got %d", strings.Count(content, beginMarker))
	}
}

func TestWriteConfig_EmptyProviderName(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "",
		BaseURL:      "http://example.com",
		EnvKey:       "KEY",
	}
	_, err := WriteConfig(cfg)
	if err == nil {
		t.Error("expected error for empty ProviderName")
	}
}

func TestWriteConfig_EmptyBaseURL(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "",
		EnvKey:       "KEY",
	}
	_, err := WriteConfig(cfg)
	if err == nil {
		t.Error("expected error for empty BaseURL")
	}
}

func TestWriteConfig_EmptyEnvKey(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "http://example.com",
		EnvKey:       "",
	}
	_, err := WriteConfig(cfg)
	if err == nil {
		t.Error("expected error for empty EnvKey")
	}
}

func TestUndoConfig_NotConfigured(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	// Should not error when nothing is configured
	err := UndoConfig()
	if err != nil {
		t.Fatal(err)
	}
}

func TestUndoConfig_RestoresBackup(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}

	original := "# original user config\nsome_key = \"some_value\"\n"
	if err := os.WriteFile(configPath, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		EnvKey:       "OCGT_CODEX_API_KEY",
		Model:        "test-model",
	}
	_, err = WriteConfig(cfg)
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	// Undo should restore the original
	if err := UndoConfig(); err != nil {
		t.Fatalf("UndoConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	if !strings.Contains(content, "original user config") {
		t.Error("original config not restored")
	}
	if strings.Contains(content, beginMarker) {
		t.Error("ocgt block still present after undo")
	}
}

func TestMaskKey(t *testing.T) {
	tests := []struct {
		key      string
		expected string
	}{
		{"short", "*****"},
		{"12345678", "********"},
		{"123456789", "123...6789"},
		{"sk-abcdefghijklmnop", "sk-...mnop"},
	}
	for _, tc := range tests {
		result := MaskKey(tc.key)
		if result != tc.expected {
			t.Errorf("MaskKey(%q) = %q, want %q", tc.key, result, tc.expected)
		}
	}
}

func TestNormalizeBaseURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"http://example.com", "http://example.com/v1"},
		{"http://example.com/", "http://example.com/v1"},
		{"http://example.com/v1", "http://example.com/v1"},
		{"http://example.com/v1/", "http://example.com/v1"},
		{"https://opencode.ai/zen/go", "https://opencode.ai/zen/go/v1"},
	}
	for _, tc := range tests {
		result := normalizeBaseURL(tc.input)
		if result != tc.expected {
			t.Errorf("normalizeBaseURL(%q) = %q, want %q", tc.input, result, tc.expected)
		}
	}
}

func TestRemoveExistingBlock(t *testing.T) {
	content := `# user stuff
some_key = "value"

# ocgt-managed-begin — do not edit between these markers
model_provider = "test"
# ocgt-managed-end

# more user stuff
another_key = "another_value"
`
	result := removeExistingBlock(content)
	if strings.Contains(result, beginMarker) {
		t.Error("block not removed")
	}
	if !strings.Contains(result, "# user stuff") {
		t.Error("user content lost")
	}
	if !strings.Contains(result, "another_key") {
		t.Error("trailing user content lost")
	}
}

// Modern Codex (CLI and desktop app) rejects wire_api="chat" on startup —
// "responses" is the only supported protocol, so it must be the default AND
// legacy "chat" values from old configs must be coerced.
func TestGenerateBlock_DefaultWireAPI(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "http://example.com",
		EnvKey:       "KEY",
		Model:        "claude-sonnet",
	}
	block := generateBlock(cfg)
	if !strings.Contains(block, `wire_api = "responses"`) {
		t.Error("default wire_api should be 'responses' (only value modern Codex accepts)")
	}
}

func TestGenerateBlock_CoercesLegacyChat(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "http://example.com",
		EnvKey:       "KEY",
		Model:        "claude-sonnet",
		WireAPI:      "chat",
	}
	block := generateBlock(cfg)
	if strings.Contains(block, `wire_api = "chat"`) {
		t.Error("legacy wire_api 'chat' must be coerced — Codex removed chat support and errors on startup")
	}
	if !strings.Contains(block, `wire_api = "responses"`) {
		t.Error("coerced wire_api should be 'responses'")
	}
}

// The desktop app never inherits shell env vars, so provider-scoped
// experimental_bearer_token is the GUI-compatible auth path. Codex forbids
// combining it with env_key, so Token must suppress the env_key line.
func TestGenerateBlock_TokenReplacesEnvKey(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "http://example.com",
		EnvKey:       "KEY_SHOULD_NOT_APPEAR",
		Token:        "local-proxy-token",
		Model:        "claude-sonnet",
	}
	block := generateBlock(cfg)
	if !strings.Contains(block, `experimental_bearer_token = "local-proxy-token"`) {
		t.Error("missing experimental_bearer_token")
	}
	if strings.Contains(block, "env_key") {
		t.Error("env_key must be omitted when Token is set — Codex rejects configs combining both")
	}
}

func TestWriteConfig_TokenOnlyIsValid(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	written, err := WriteConfig(ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "tok-123",
		Model:        "m",
	})
	if err != nil {
		t.Fatalf("WriteConfig with Token only should succeed: %v", err)
	}
	data, _ := os.ReadFile(written)
	if !strings.Contains(string(data), `experimental_bearer_token = "tok-123"`) {
		t.Error("token missing from written config")
	}
}

func TestWriteConfig_IncludesModelCatalog(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	catalogPath, err := WriteModelCatalog([]string{"deepseek-v4-pro", "kimi-k2.6", "deepseek-v4-pro"})
	if err != nil {
		t.Fatalf("WriteModelCatalog failed: %v", err)
	}
	data, err := os.ReadFile(catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"slug": "deepseek-v4-pro"`) || strings.Count(string(data), `"slug":`) != 2 {
		t.Fatalf("catalog did not contain deduped models:\n%s", string(data))
	}
	var catalog modelCatalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatalf("catalog JSON did not parse: %v", err)
	}
	for _, model := range catalog.Models {
		base, _ := model["base_instructions"].(string)
		if strings.TrimSpace(base) == "" {
			t.Fatalf("catalog model %q missing base_instructions", model["slug"])
		}
		if _, ok := model["apply_patch_tool_type"]; ok {
			t.Fatalf("native Responses catalog must not advertise freeform apply_patch: %#v", model)
		}
		if _, ok := model["web_search_tool_type"]; ok {
			t.Fatalf("native Responses catalog must not advertise web_search tool type: %#v", model)
		}
		if got := model["default_reasoning_level"]; got != "medium" {
			t.Fatalf("catalog model %q default_reasoning_level = %v, want medium", model["slug"], got)
		}
		levels, ok := model["supported_reasoning_levels"].([]any)
		if !ok || len(levels) != 1 {
			t.Fatalf("catalog model %q reasoning levels = %#v, want one neutral level", model["slug"], model["supported_reasoning_levels"])
		}
		level, _ := levels[0].(map[string]any)
		if got := level["effort"]; got != "medium" {
			t.Fatalf("catalog model %q reasoning level = %v, want medium", model["slug"], got)
		}
		if model["id"] == "" || model["name"] == "" || model["type"] != "model" || model["default_service_tier"] != "default" {
			t.Fatalf("catalog model %q missing Codex picker metadata: %#v", model["slug"], model)
		}
	}

	written, err := WriteConfig(ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "tok-123",
		Model:        "deepseek-v4-pro",
		CatalogPath:  catalogPath,
	})
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}
	configData, err := os.ReadFile(written)
	if err != nil {
		t.Fatal(err)
	}
	content := string(configData)
	expectedCatalogLine := "model_catalog_json = " + strconv.Quote(catalogPath)
	if !strings.Contains(content, expectedCatalogLine) {
		t.Fatalf("model_catalog_json missing from config:\n%s", content)
	}
	if strings.Contains(content, `model_catalog_json = "ocgt-model-catalog.json"`) {
		t.Fatalf("model_catalog_json should use absolute catalog path for the desktop app, got:\n%s", content)
	}
}

func TestRemoveModelCatalogPreservesReferencedCatalog(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	catalogPath, err := WriteModelCatalog([]string{"deepseek-v4-pro"})
	if err != nil {
		t.Fatalf("WriteModelCatalog failed: %v", err)
	}
	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`model_catalog_json = "ocgt-model-catalog.json"`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := RemoveModelCatalog(); err != nil {
		t.Fatalf("RemoveModelCatalog failed: %v", err)
	}
	if _, err := os.Stat(catalogPath); err != nil {
		t.Fatalf("referenced catalog should remain, stat error: %v", err)
	}
}

func TestRemoveModelCatalogDeletesUnreferencedCatalog(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	catalogPath, err := WriteModelCatalog([]string{"deepseek-v4-pro"})
	if err != nil {
		t.Fatalf("WriteModelCatalog failed: %v", err)
	}
	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(`model = "gpt-5"`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := RemoveModelCatalog(); err != nil {
		t.Fatalf("RemoveModelCatalog failed: %v", err)
	}
	if _, err := os.Stat(catalogPath); !os.IsNotExist(err) {
		t.Fatalf("unreferenced catalog should be deleted, stat error: %v", err)
	}
}

// When the existing config.toml already has root-level model/model_provider
// keys (from Codex's own defaults), WriteConfig must strip them before
// appending the managed block — otherwise TOML has duplicate keys.
func TestWriteConfig_StripsDuplicateRootKeys(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}

	// Simulate a real Codex config.toml that already has model at root
	existing := `approval_policy = "on-request"
model = "gpt-5.4"
model_reasoning_effort = "high"

[features]
multi_agent = true
`
	if err := os.WriteFile(configPath, []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "test-token",
		Model:        "deepseek-v4-pro",
	}
	_, err = WriteConfig(cfg)
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	// The old root-level model must be gone — only the managed block's model should remain
	if strings.Count(content, `model = "gpt-5.4"`) != 0 {
		t.Error("pre-existing root model key was not stripped — will cause TOML duplicate-key error")
	}
	if strings.Count(content, `model = "deepseek-v4-pro"`) != 1 {
		t.Error("managed block model key missing or duplicated")
	}
	// Pre-existing non-conflicting keys must survive
	if !strings.Contains(content, `approval_policy = "on-request"`) {
		t.Error("pre-existing approval_policy lost")
	}
	if !strings.Contains(content, `multi_agent = true`) {
		t.Error("pre-existing features section lost")
	}
}

func TestWriteConfig_StripsSingleQuotedDuplicateRootKeys(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	catalogPath := filepath.Join(dir, ".codex", catalogName)
	existing := "model = 'gpt-5.4'\nmodel_provider = 'openai'\nmodel_catalog_json = 'old-catalog.json'\n\n[features]\njs_repl = false\n"
	if err := os.WriteFile(configPath, []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = WriteConfig(ProviderConfig{
		ProviderName: "ocgt",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "test-token",
		Model:        "deepseek-v4-pro",
		CatalogPath:  catalogPath,
	})
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, stale := range []string{"gpt-5.4", "model_provider = 'openai'", "old-catalog.json"} {
		if strings.Contains(content, stale) {
			t.Fatalf("stale root key survived: %q in\n%s", stale, content)
		}
	}
	expectedCatalogLine := "model_catalog_json = " + strconv.Quote(catalogPath)
	if !strings.Contains(content, expectedCatalogLine) {
		t.Fatalf("managed catalog pointer missing:\n%s", content)
	}
	if !strings.Contains(content, "js_repl = false") {
		t.Fatalf("unrelated table content was lost:\n%s", content)
	}
}

func TestWriteConfig_CustomProviderRemovesLegacyOCGTProvider(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	existing := `[model_providers.ocgt]
name = "ocgt"
base_url = "http://127.0.0.1:8787/v1"
`
	if err := os.WriteFile(configPath, []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = WriteConfig(ProviderConfig{
		ProviderName: "custom",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "test-token",
		Model:        "deepseek-v4-pro",
	})
	if err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if strings.Contains(content, "[model_providers.ocgt]") {
		t.Fatalf("legacy ocgt provider table survived:\n%s", content)
	}
	if !strings.Contains(content, `model_provider = "custom"`) || !strings.Contains(content, `[model_providers.custom]`) {
		t.Fatalf("custom provider missing:\n%s", content)
	}
}

func TestUndoConfigIgnoresStaleBackupWithoutManagedBlock(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	current := "model = \"gpt-5.5\"\n[features]\ngoals = true\n"
	if err := os.WriteFile(configPath, []byte(current), 0o600); err != nil {
		t.Fatal(err)
	}
	bp, err := backupPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bp, []byte("model = \"stale\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := UndoConfig(); err != nil {
		t.Fatalf("UndoConfig failed: %v", err)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != current {
		t.Fatalf("stale backup overwrote current config:\n%s", string(data))
	}
	if _, err := os.Stat(bp); !os.IsNotExist(err) {
		t.Fatalf("stale backup should be removed, stat error: %v", err)
	}
}

func TestWriteConfigRefreshesStaleBackupOnFreshInstall(t *testing.T) {
	dir := t.TempDir()
	setHomeDir(t, dir)

	configPath, err := ConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	current := "model = \"gpt-5.5\"\nmodel_reasoning_effort = \"xhigh\"\n"
	if err := os.WriteFile(configPath, []byte(current), 0o600); err != nil {
		t.Fatal(err)
	}
	bp, err := backupPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bp, []byte("model = \"stale\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := WriteConfig(ProviderConfig{
		ProviderName: "custom",
		BaseURL:      "http://127.0.0.1:8787",
		Token:        "tok",
		Model:        "kimi-k2.6",
	}); err != nil {
		t.Fatalf("WriteConfig failed: %v", err)
	}
	if err := UndoConfig(); err != nil {
		t.Fatalf("UndoConfig failed: %v", err)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != current {
		t.Fatalf("undo restored stale backup, got:\n%s", string(data))
	}
}
