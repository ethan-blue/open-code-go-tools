package proxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

func TestNormalizeRemoteModelsDoesNotAddConfiguredAliases(t *testing.T) {
	out := normalizeRemoteModels([]byte(`{"data":[{"id":"deepseek-v4-pro","protocol":"chat"}]}`))
	models := out["data"].([]map[string]any)
	if len(models) != 1 {
		t.Fatalf("expected only upstream models, got %#v", models)
	}
	if models[0]["id"] != "deepseek-v4-pro" {
		t.Fatalf("unexpected model id: %#v", models[0])
	}
	if models[0]["protocol"] != "openai-chat" {
		t.Fatalf("unexpected protocol: %#v", models[0])
	}
	if out["models"] == nil {
		t.Fatal("Codex-compatible models field is missing")
	}
}

func TestNormalizeRemoteModelsIncludesExtras(t *testing.T) {
	out := normalizeRemoteModels([]byte(`{"data":[{"id":"deepseek-v4-pro"}]}`), "custom-model", "deepseek-v4-pro")
	models := out["data"].([]map[string]any)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d: %#v", len(models), models)
	}
	ids := map[string]bool{}
	for _, m := range models {
		ids[m["id"].(string)] = true
	}
	if !ids["deepseek-v4-pro"] || !ids["custom-model"] {
		t.Fatalf("expected both upstream and extra model, got %#v", ids)
	}
}

func TestCodexModelsHandlerMergesProviderModels(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("upstream path = %q, want /v1/models", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"upstream-model"}]}`))
	}))
	defer upstream.Close()

	srv, err := New(config.Config{Listen: "127.0.0.1:0", Upstream: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	for _, p := range store.List() {
		if p.ID != "default-codex" {
			continue
		}
		if err := store.Update(p.ID, providers.Provider{
			ID:            p.ID,
			Name:          p.Name,
			BaseURL:       upstream.URL,
			Enabled:       true,
			Line:          "codex",
			Protocol:      "openai-chat",
			DefaultModel:  "my-default",
			Models:        []string{"custom-a", "custom-b"},
			FallbackChain: []string{"fallback-x"},
			MessageModels: []string{"message-y"},
			ModelAliases:  map[string]string{"short": "alias-z"},
			AuthMode:      config.AuthModeBearer,
		}); err != nil {
			t.Fatal(err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Data []struct {
			ID                       string `json:"id"`
			DefaultReasoningLevel    string `json:"default_reasoning_level"`
			SupportedReasoningLevels []struct {
				Level string `json:"level"`
				Name  string `json:"name"`
			} `json:"supported_reasoning_levels"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode: %v, body: %s", err, rr.Body.String())
	}
	ids := map[string]bool{}
	for _, m := range result.Data {
		ids[m.ID] = true
	}
	for _, want := range []string{"upstream-model", "my-default", "custom-a", "custom-b", "fallback-x", "message-y", "alias-z"} {
		if !ids[want] {
			t.Fatalf("missing model %q in %#v", want, ids)
		}
	}
	if len(result.Data) != 7 {
		t.Fatalf("expected 7 models, got %d: %#v", len(result.Data), result.Data)
	}
	for _, m := range result.Data {
		if m.DefaultReasoningLevel != "medium" {
			t.Fatalf("model %q default_reasoning_level = %q, want medium", m.ID, m.DefaultReasoningLevel)
		}
		if len(m.SupportedReasoningLevels) != 3 {
			t.Fatalf("model %q supported_reasoning_levels = %d, want 3", m.ID, len(m.SupportedReasoningLevels))
		}
	}
}

func TestCodexModelsHandlerFallsBackToConfiguredModels(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"models unavailable"}`))
	}))
	defer upstream.Close()

	srv, err := New(config.Config{Listen: "127.0.0.1:0", Upstream: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	for _, p := range store.List() {
		if p.ID != "default-codex" {
			continue
		}
		if err := store.Update(p.ID, providers.Provider{
			ID:           p.ID,
			Name:         p.Name,
			BaseURL:      upstream.URL,
			Enabled:      true,
			Line:         "codex",
			Protocol:     "openai-chat",
			DefaultModel: "deepseek-v4-pro",
			Models:       []string{"kimi-k2.6"},
			AuthMode:     config.AuthModeBearer,
		}); err != nil {
			t.Fatal(err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected configured-model fallback 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode: %v, body: %s", err, rr.Body.String())
	}
	ids := map[string]bool{}
	for _, m := range result.Data {
		ids[m.ID] = true
	}
	if !ids["deepseek-v4-pro"] || !ids["kimi-k2.6"] {
		t.Fatalf("fallback omitted configured models: %#v", ids)
	}
}

func TestFetchRealUpstreamModelsMergesCodexProviderModels(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("upstream path = %q, want /v1/models", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"upstream-model"}]}`))
	}))
	defer upstream.Close()

	srv, err := New(config.Config{Listen: "127.0.0.1:0", Upstream: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	for _, p := range store.List() {
		if p.ID != "default-codex" {
			continue
		}
		if err := store.Update(p.ID, providers.Provider{
			ID:           p.ID,
			Name:         p.Name,
			BaseURL:      upstream.URL,
			Enabled:      true,
			Line:         "codex",
			Protocol:     "openai-responses",
			DefaultModel: "deepseek-v4-pro",
			Models:       []string{"kimi-k2.6"},
			AuthMode:     config.AuthModeBearer,
		}); err != nil {
			t.Fatal(err)
		}
	}

	result, err := srv.FetchRealUpstreamModels(context.Background(), "codex")
	if err != nil {
		t.Fatalf("FetchRealUpstreamModels failed: %v", err)
	}
	models := result["data"].([]map[string]any)
	ids := map[string]bool{}
	for _, m := range models {
		ids[m["id"].(string)] = true
	}
	for _, want := range []string{"upstream-model", "deepseek-v4-pro", "kimi-k2.6"} {
		if !ids[want] {
			t.Fatalf("missing model %q in %#v", want, ids)
		}
	}
}

func TestTargetUsesMessagesEndpointModelProtocolOverride(t *testing.T) {
	target := requestTarget{
		protocol:       "openai-chat",
		modelProtocols: map[string]string{"claude-native": "anthropic"},
	}
	if !targetUsesMessagesEndpoint(target, "claude-native") {
		t.Fatal("model protocol override should route to Anthropic messages")
	}
	if targetUsesMessagesEndpoint(target, "deepseek-v4-pro") {
		t.Fatal("provider default openai-chat should not route to Anthropic messages")
	}
}

func TestOpenCodeGoResponsesDefaultRoutesToChatUpstream(t *testing.T) {
	target := requestTarget{
		upstream: "https://opencode.ai/zen/go",
		protocol: "openai-responses",
	}
	if got := targetProtocolForModel(target, "deepseek-v4-pro"); got != "openai-chat" {
		t.Fatalf("OpenCode Go provider default protocol = %q, want openai-chat", got)
	}
	target.modelProtocols = map[string]string{"native-response": "responses"}
	if got := targetProtocolForModel(target, "native-response"); got != "openai-chat" {
		t.Fatalf("OpenCode Go responses metadata protocol = %q, want openai-chat", got)
	}
	target.modelProtocols = map[string]string{"claude-native": "anthropic"}
	if got := targetProtocolForModel(target, "claude-native"); got != "anthropic" {
		t.Fatalf("OpenCode Go anthropic metadata protocol = %q, want anthropic", got)
	}
}
