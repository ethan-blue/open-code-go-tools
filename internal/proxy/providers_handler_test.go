package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

// newProviderTestServer builds a minimal Server pointed at the given upstream.
func newProviderTestServer(t *testing.T, upstreamURL string) *Server {
	t.Helper()
	srv, err := New(config.Config{
		Listen:   "127.0.0.1:0",
		Upstream: upstreamURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

// TestProviderTestEndpointChatProtocol verifies that a provider test request
// with the openai-chat protocol is forwarded to /v1/chat/completions and a 200
// upstream response yields success=true.
func TestProviderTestEndpointChatProtocol(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("openai-chat test upstream path = %q, want /v1/chat/completions", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x","choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	body := []byte(`{"baseUrl":"` + upstream.URL + `","apiKey":"sk-test","model":"test-model","protocol":"openai-chat"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.registerProvidersRoutes(http.NewServeMux())
	// Re-register onto a fresh mux that we then dispatch through — but the
	// handler is a method, so call it directly.
	srv.apiProviderTest(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Success bool `json:"success"`
		Status  int  `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if !result.Success {
		t.Fatalf("expected success=true, got: %s", rr.Body.String())
	}
}

func TestSeedDefaultProvidersBackfillsEmptyDefaultCodex(t *testing.T) {
	dir := t.TempDir()
	store := providers.NewStore(dir)
	if err := store.Create(providers.Provider{
		ID:      "default-codex",
		Name:    "OpenCode Go",
		BaseURL: "https://opencode.ai/zen/go",
		Enabled: true,
		Line:    "codex",
		// Old cold-start defaults had no model fields and used chat here.
		Protocol: "openai-chat",
	}); err != nil {
		t.Fatal(err)
	}

	srv, err := New(config.Config{Listen: "127.0.0.1:0", Upstream: "https://opencode.ai/zen/go"})
	if err != nil {
		t.Fatal(err)
	}
	srv.configDir = dir
	got := srv.ensureStore().List()
	var codexProvider *providers.Provider
	for i := range got {
		if got[i].ID == "default-codex" {
			codexProvider = &got[i]
			break
		}
	}
	if codexProvider == nil {
		t.Fatal("default-codex missing")
	}
	if codexProvider.DefaultModel == "" || len(codexProvider.Models) == 0 {
		t.Fatalf("default-codex was not backfilled: %#v", codexProvider)
	}
	if codexProvider.Protocol != "openai-responses" {
		t.Fatalf("default-codex protocol = %q, want openai-responses", codexProvider.Protocol)
	}
}

func TestProviderTestEndpointModelProtocolOverride(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("model protocol override path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	body := []byte(`{"baseUrl":"` + upstream.URL + `","apiKey":"sk-test","model":"claude-native","protocol":"openai-chat","modelProtocols":{"claude-native":"anthropic"}}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if !result.Success {
		t.Fatalf("expected success=true, got: %s", rr.Body.String())
	}
}

func TestProviderTestEndpointUsesStoredModelProtocol(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("stored model protocol path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	if err := store.Create(providers.Provider{
		ID:             "p1",
		Name:           "Saved",
		BaseURL:        upstream.URL,
		APIKey:         "sk-test",
		Enabled:        true,
		Line:           "claude",
		Protocol:       "openai-chat",
		ModelProtocols: map[string]string{"claude-native": "messages"},
	}); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"providerId":"p1","baseUrl":"` + upstream.URL + `","apiKey":"sk-test","model":"claude-native","protocol":"openai-chat"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if !result.Success {
		t.Fatalf("expected stored model protocol to be used, got: %s", rr.Body.String())
	}
}

func TestProviderTestEndpointMatchesSavedProviderByBaseURL(t *testing.T) {
	const realKey = "sk-real-secret-1234"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("baseUrl matched protocol path = %q, want /v1/messages", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+realKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"missing api key"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	if err := store.Create(providers.Provider{
		ID:             "p1",
		Name:           "Saved",
		BaseURL:        strings.TrimPrefix(upstream.URL, "http://"),
		Accounts:       []providers.Account{{ID: "acc-primary", APIKey: realKey}},
		Enabled:        true,
		Line:           "claude",
		Protocol:       "openai-chat",
		ModelProtocols: map[string]string{"claude-native": "anthropic"},
	}); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"baseUrl":"` + upstream.URL + `/","apiKey":"` + providers.MaskAPIKey(realKey) + `","model":"claude-native","protocol":"openai-chat"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if !result.Success {
		t.Fatalf("expected baseUrl matched saved provider to be used, got: %s", rr.Body.String())
	}
}

// TestProviderTestEndpointAnthropicProtocol verifies the anthropic protocol
// routes the probe to /v1/messages.
func TestProviderTestEndpointAnthropicProtocol(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("anthropic test upstream path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	body := []byte(`{"baseUrl":"` + upstream.URL + `","apiKey":"sk-test","model":"claude-sonnet-4-5","protocol":"anthropic"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if !result.Success {
		t.Fatalf("expected success=true for anthropic, got: %s", rr.Body.String())
	}
}

// TestProviderTestEndpointUpstreamError verifies that a 4xx from the upstream
// is surfaced as success=false with the status and an error message, not a 5xx.
func TestProviderTestEndpointUpstreamError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	body := []byte(`{"baseUrl":"` + upstream.URL + `","apiKey":"bad-key","model":"test-model","protocol":"openai-chat"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	// The endpoint always returns 200 with success=false so the frontend can
	// render the error inline rather than treating it as a transport failure.
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 envelope, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Success bool   `json:"success"`
		Status  int    `json:"status"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if result.Success {
		t.Fatalf("expected success=false for 401 upstream, got: %s", rr.Body.String())
	}
	if result.Status != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", result.Status)
	}
	if result.Error == "" {
		t.Fatalf("expected non-empty error message, got: %s", rr.Body.String())
	}
}

func TestProviderTestEndpointUsesStoredKeyForSavedProvider(t *testing.T) {
	const realKey = "sk-real-secret-1234"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+realKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"missing api key"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x","choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	if err := store.Create(providers.Provider{
		ID:       "p1",
		Name:     "Saved",
		BaseURL:  upstream.URL,
		Enabled:  true,
		Line:     "claude",
		Protocol: "openai-chat",
		Accounts: []providers.Account{{
			ID:     "acc-primary",
			APIKey: realKey,
		}},
	}); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"providerId":"p1","baseUrl":"` + upstream.URL + `","apiKey":"` + providers.MaskAPIKey(realKey) + `","model":"test-model","protocol":"openai-chat"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	var result struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if !result.Success {
		t.Fatalf("expected stored key to be used, got: %s", rr.Body.String())
	}
}

// TestProviderTestEndpointMissingFields verifies that omitting baseUrl or model
// is rejected with 400 before any upstream call.
func TestProviderTestEndpointMissingFields(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("upstream should not be contacted when fields are missing")
	}))
	defer upstream.Close()

	srv := newProviderTestServer(t, upstream.URL)
	body := []byte(`{"apiKey":"sk-test","model":"test-model"}`)
	req := httptest.NewRequest(http.MethodPost, "/ocgt/api/providers/test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.apiProviderTest(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing baseUrl, got %d, body: %s", rr.Code, rr.Body.String())
	}
}
