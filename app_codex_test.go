package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

func TestCodexCatalogModelIDsUsesConfiguredModels(t *testing.T) {
	got := codexCatalogModelIDs(nil, &providers.Provider{
		DefaultModel:  "deepseek-v4-pro",
		Models:        []string{"kimi-k2.6", "deepseek-v4-pro"},
		MessageModels: []string{"minimax-m2.7"},
		FallbackChain: []string{"qwen3.6-plus", "kimi-k2.6"},
		ModelAliases:  map[string]string{"opus": "glm-5"},
	}, "deepseek-v4-pro")

	want := []string{"deepseek-v4-pro", "kimi-k2.6", "minimax-m2.7", "qwen3.6-plus", "glm-5"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("codex catalog models = %#v, want %#v", got, want)
	}
}

func TestSetupCodexWritesDesktopCompatibleProviderAndCatalog(t *testing.T) {
	dir := t.TempDir()
	oldHome := os.Getenv("HOME")
	oldUserProfile := os.Getenv("USERPROFILE")
	oldConfig := os.Getenv("OCGT_CONFIG")
	t.Cleanup(func() {
		os.Setenv("HOME", oldHome)
		os.Setenv("USERPROFILE", oldUserProfile)
		os.Setenv("OCGT_CONFIG", oldConfig)
	})
	os.Setenv("HOME", dir)
	os.Setenv("USERPROFILE", dir)
	configPath := filepath.Join(dir, ".ocgt", "config.json")
	os.Setenv("OCGT_CONFIG", configPath)

	cfg := config.Example()
	if err := cfg.Save(configPath); err != nil {
		t.Fatal(err)
	}
	store := providers.NewStore(filepath.Dir(configPath))
	if err := store.Create(providers.Provider{
		ID:           "codex-provider",
		Name:         "OpenCode Go",
		BaseURL:      "https://opencode.ai/zen/go",
		Enabled:      true,
		Line:         "codex",
		Protocol:     "openai-responses",
		DefaultModel: "deepseek-v4-pro",
		Models:       []string{"kimi-k2.6"},
	}); err != nil {
		t.Fatal(err)
	}

	result := NewApp().SetupCodex()
	var payload struct {
		Status      string `json:"status"`
		ConfigPath  string `json:"configPath"`
		CatalogPath string `json:"catalogPath"`
		Model       string `json:"model"`
		ModelCount  int    `json:"modelCount"`
	}
	if err := json.Unmarshal([]byte(result), &payload); err != nil {
		t.Fatalf("SetupCodex returned %q, parse error: %v", result, err)
	}
	if payload.Status != "success" || payload.Model != "deepseek-v4-pro" || payload.ModelCount != 2 {
		t.Fatalf("unexpected setup result: %#v", payload)
	}
	data, err := os.ReadFile(payload.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{
		`model_provider = "custom"`,
		`model = "deepseek-v4-pro"`,
		`[model_providers.custom]`,
		`name = "ocgt"`,
		`model_catalog_json = `,
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("config missing %q:\n%s", want, content)
		}
	}
	if strings.Contains(content, `model_provider = "ocgt"`) || strings.Contains(content, `[model_providers.ocgt]`) {
		t.Fatalf("SetupCodex must remove the legacy ocgt provider id:\n%s", content)
	}
	if _, err := os.Stat(payload.CatalogPath); err != nil {
		t.Fatalf("catalog not written: %v", err)
	}
}
