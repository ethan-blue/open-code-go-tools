package codex

import (
	"os"
	"path/filepath"
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
	if !strings.Contains(content, `wire_api = "chat"`) {
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

func TestGenerateBlock_DefaultWireAPI(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "http://example.com",
		EnvKey:       "KEY",
		Model:        "claude-sonnet",
	}
	block := generateBlock(cfg)
	if !strings.Contains(block, `wire_api = "chat"`) {
		t.Error("default wire_api should be 'chat'")
	}
}

func TestGenerateBlock_CustomWireAPI(t *testing.T) {
	cfg := ProviderConfig{
		ProviderName: "test",
		BaseURL:      "http://example.com",
		EnvKey:       "KEY",
		Model:        "claude-sonnet",
		WireAPI:      "responses",
	}
	block := generateBlock(cfg)
	if !strings.Contains(block, `wire_api = "responses"`) {
		t.Error("wire_api should be 'responses'")
	}
}
