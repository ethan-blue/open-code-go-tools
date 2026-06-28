package config

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestExampleIsValid(t *testing.T) {
	cfg := Example()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("example config should be valid: %v", err)
	}
}

func TestResolveModel(t *testing.T) {
	profile := Profile{
		DefaultModel: "sonnet",
		ModelAliases: map[string]string{
			"sonnet": "claude-sonnet-4-6",
		},
	}
	if got := profile.ResolveModel(""); got != "claude-sonnet-4-6" {
		t.Fatalf("empty model should resolve through default alias, got %q", got)
	}
	if got := profile.ResolveModel("glm-5.1"); got != "glm-5.1" {
		t.Fatalf("full model names should pass through, got %q", got)
	}
}

func TestExampleIncludesAllDocumentedGoAliases(t *testing.T) {
	profile := Example().Profiles["opencode-go"]
	for alias, want := range map[string]string{
		"glm5":   "glm-5",
		"hy3":    "hy3-preview",
		"kimi25": "kimi-k2.5",
		"mimo25": "mimo-v2.5",
		"qwen35": "qwen3.5-plus",
	} {
		if got := profile.ResolveModel(alias); got != want {
			t.Fatalf("%s resolved to %q, want %q", alias, got, want)
		}
	}
}

func TestResolveClaudeCompatModel(t *testing.T) {
	profile := Profile{
		DefaultModel: "kimi-k2.6",
		ModelAliases: map[string]string{
			"opus":   "kimi-k2.6",
			"sonnet": "qwen3.6-plus",
			"haiku":  "deepseek-v4-flash",
		},
	}
	if got := profile.ResolveModel("claude-opus-4-7-r5"); got != "kimi-k2.6" {
		t.Fatalf("opus compat model resolved to %q", got)
	}
	if got := profile.ResolveModel("claude-3-opus-20240229"); got != "kimi-k2.6" {
		t.Fatalf("real claude-3-opus resolved to %q", got)
	}
	if got := profile.ResolveModel("claude-sonnet-4-6"); got != "qwen3.6-plus" {
		t.Fatalf("sonnet compat model resolved to %q", got)
	}
	if got := profile.ResolveModel("claude-3-5-sonnet-20241022"); got != "qwen3.6-plus" {
		t.Fatalf("real claude-3-5-sonnet resolved to %q", got)
	}
	if got := profile.ResolveModel("claude-haiku-4-5"); got != "deepseek-v4-flash" {
		t.Fatalf("haiku compat model resolved to %q", got)
	}
	if got := profile.ResolveModel("claude-3-5-haiku-20241022"); got != "deepseek-v4-flash" {
		t.Fatalf("real claude-3-5-haiku resolved to %q", got)
	}
}

func TestWarnIfNoAPIKey(t *testing.T) {
	cfg := Config{
		ActiveProfile: "test",
		Profiles: map[string]Profile{
			"test": {APIKeyEnv: "MISSING_KEY", DefaultModel: "kimi-k2.6"},
		},
	}
	warn := cfg.WarnIfNoAPIKey()
	if warn == "" {
		t.Fatal("expected warning when API key is missing")
	}
}

func TestWarnIfNoAPIKeyPresent(t *testing.T) {
	cfg := Config{
		ActiveProfile: "test",
		Profiles: map[string]Profile{
			"test": {APIKey: "sk-test-key", DefaultModel: "kimi-k2.6"},
		},
	}
	warn := cfg.WarnIfNoAPIKey()
	if warn != "" {
		t.Fatalf("expected no warning when API key is present, got %q", warn)
	}
}

func TestValidateEmptyProfiles(t *testing.T) {
	cfg := Config{Listen: "127.0.0.1:8787", Upstream: "https://opencode.ai/zen/go"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for empty profiles")
	}
}

func TestValidateInvalidUpstream(t *testing.T) {
	cfg := Config{
		Listen:        "127.0.0.1:8787",
		Upstream:      "not-a-url",
		ActiveProfile: "test",
		Profiles:      map[string]Profile{"test": {DefaultModel: "kimi-k2.6"}},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for invalid upstream")
	}
}

func TestValidateListenAddress(t *testing.T) {
	valid := []string{"127.0.0.1:8787", "localhost:8787", ":8787", "[::1]:8787"}
	for _, listen := range valid {
		if err := ValidateListenAddress(listen); err != nil {
			t.Fatalf("ValidateListenAddress(%q) returned error: %v", listen, err)
		}
	}

	invalid := []string{"", "127.0.0.1", "http://127.0.0.1:8787", "127.0.0.1:0", "127.0.0.1:70000", "bad host:8787"}
	for _, listen := range invalid {
		if err := ValidateListenAddress(listen); err == nil {
			t.Fatalf("ValidateListenAddress(%q) expected error", listen)
		}
	}
}

func TestRequestTimeoutDefault(t *testing.T) {
	cfg := Config{
		Listen:        "127.0.0.1:8787",
		Upstream:      "https://opencode.ai/zen/go",
		ActiveProfile: "test",
		Profiles:      map[string]Profile{"test": {DefaultModel: "kimi-k2.6"}},
	}
	cfg.applyDefaults()
	if cfg.RequestTimeoutSeconds != DefaultRequestTimeoutSeconds {
		t.Fatalf("expected default request timeout %d, got %d", DefaultRequestTimeoutSeconds, cfg.RequestTimeoutSeconds)
	}
	if got := cfg.RequestTimeout(); got != time.Duration(DefaultRequestTimeoutSeconds)*time.Second {
		t.Fatalf("unexpected request timeout duration: %v", got)
	}
}

func TestThinkingBudgetDefault(t *testing.T) {
	cfg := Config{
		Listen:        "127.0.0.1:8787",
		Upstream:      "https://opencode.ai/zen/go",
		ActiveProfile: "test",
		Profiles:      map[string]Profile{"test": {DefaultModel: "kimi-k2.6"}},
	}
	cfg.applyDefaults()
	if cfg.MaxThinkingBudgetTokens != DefaultMaxThinkingBudgetTokens {
		t.Fatalf("expected default thinking budget %d, got %d", DefaultMaxThinkingBudgetTokens, cfg.MaxThinkingBudgetTokens)
	}
	if got := cfg.ThinkingBudgetTokens(); got != DefaultMaxThinkingBudgetTokens {
		t.Fatalf("unexpected thinking budget: %d", got)
	}
}

func TestValidateInvalidRequestTimeout(t *testing.T) {
	cfg := Config{
		Listen:                "127.0.0.1:8787",
		Upstream:              "https://opencode.ai/zen/go",
		RequestTimeoutSeconds: 3601,
		ActiveProfile:         "test",
		Profiles:              map[string]Profile{"test": {DefaultModel: "kimi-k2.6"}},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for invalid request timeout")
	}
}

func TestValidateInvalidThinkingBudget(t *testing.T) {
	cfg := Config{
		Listen:                  "127.0.0.1:8787",
		Upstream:                "https://opencode.ai/zen/go",
		MaxThinkingBudgetTokens: 8193,
		ActiveProfile:           "test",
		Profiles:                map[string]Profile{"test": {DefaultModel: "kimi-k2.6"}},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for invalid thinking budget")
	}
}

func TestValidateMissingActiveProfile(t *testing.T) {
	cfg := Config{
		Listen:        "127.0.0.1:8787",
		Upstream:      "https://opencode.ai/zen/go",
		ActiveProfile: "missing",
		Profiles:      map[string]Profile{"test": {DefaultModel: "kimi-k2.6"}},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for missing active profile")
	}
}

func TestProfileFromEmptyName(t *testing.T) {
	cfg := Config{
		ActiveProfile: "default",
		Profiles: map[string]Profile{
			"default": {DefaultModel: "kimi-k2.6"},
		},
	}
	p, name, err := cfg.Profile("")
	if err != nil {
		t.Fatal(err)
	}
	if name != "default" {
		t.Fatalf("expected default profile, got %q", name)
	}
	if p.DefaultModel != "kimi-k2.6" {
		t.Fatalf("expected kimi-k2.6, got %q", p.DefaultModel)
	}
}

func TestProfileFromInvalidName(t *testing.T) {
	cfg := Config{
		ActiveProfile: "default",
		Profiles: map[string]Profile{
			"default": {DefaultModel: "kimi-k2.6"},
		},
	}
	_, _, err := cfg.Profile("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent profile")
	}
}

func TestAPIKeyValue(t *testing.T) {
	p := Profile{APIKey: "direct-key", APIKeyEnv: "SOME_ENV_VAR"}
	if got := p.APIKeyValue(); got != "direct-key" {
		t.Fatalf("expected direct-key, got %q", got)
	}
	p = Profile{APIKey: "", APIKeyEnv: ""}
	if got := p.APIKeyValue(); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestEffectiveAuthMode(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want string
	}{
		{"empty_defaults_to_bearer", "", DefaultAuthMode},
		{"bearer", "bearer", AuthModeBearer},
		{"x-api-key", "x-api-key", AuthModeAPIKey},
		{"both", "both", AuthModeBoth},
		{"uppercase_normalized", "X-API-KEY", AuthModeAPIKey},
		{"whitespace_trimmed", "  Both  ", AuthModeBoth},
		{"unknown_falls_back", "weird", DefaultAuthMode},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := Profile{AuthMode: tc.mode}
			if got := p.EffectiveAuthMode(); got != tc.want {
				t.Fatalf("EffectiveAuthMode() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSavePreservesUnknownFields(t *testing.T) {
	// Create a temporary file with unknown fields
	tmpFile := t.TempDir() + "/config.json"
	initial := `{
  "version": 1,
  "listen": "127.0.0.1:8787",
  "upstream": "https://example.com",
  "request_timeout_seconds": 300,
  "active_profile": "test",
  "profiles": {
    "test": {"api_key": "key1"}
  },
  "custom_field": "should be preserved",
  "another_custom": {"nested": true}
}`
	if err := os.WriteFile(tmpFile, []byte(initial), 0o600); err != nil {
		t.Fatal(err)
	}

	// Load and save the config
	cfg, err := Load(tmpFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.Save(tmpFile); err != nil {
		t.Fatal(err)
	}

	// Read the saved file and check that unknown fields are preserved
	data, err := os.ReadFile(tmpFile)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}

	if raw["custom_field"] != "should be preserved" {
		t.Fatalf("custom_field should be preserved, got %v", raw["custom_field"])
	}
	customObj, ok := raw["another_custom"].(map[string]any)
	if !ok {
		t.Fatalf("another_custom should be an object, got %T", raw["another_custom"])
	}
	if customObj["nested"] != true {
		t.Fatalf("another_custom.nested should be true, got %v", customObj["nested"])
	}

	// Verify known fields are also present
	if raw["listen"] != "127.0.0.1:8787" {
		t.Fatalf("listen should be preserved, got %v", raw["listen"])
	}
}
