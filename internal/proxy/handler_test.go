package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

// ----- chatCompletions endpoint tests -----

func newChatTestServer(t *testing.T, upstreamURL string) *Server {
	t.Helper()
	srv, err := New(config.Config{
		Listen:        "127.0.0.1:0",
		Upstream:      upstreamURL,
		ActiveProfile: "test",
		Profiles: map[string]config.Profile{
			"test": {APIKey: "test-key", DefaultModel: "qwen3.7-max"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

// TestChatCompletionsBasic verifies that a valid chat completion request is
// forwarded to the upstream and the OpenAI-format response is returned as-is.
func TestChatCompletionsBasic(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("upstream path = %q, want /v1/chat/completions", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_1","model":"qwen3.7-max","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max","messages":[{"role":"user","content":"hi"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}

	var result openAIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v, body: %s", err, rr.Body.String())
	}
	if len(result.Choices) == 0 {
		t.Fatalf("expected at least one choice, got: %s", rr.Body.String())
	}
	if result.Choices[0].Message.Content != "ok" {
		t.Fatalf("expected content %q, got %q", "ok", result.Choices[0].Message.Content)
	}
}

// TestChatCompletionsMissingModel verifies that omitting the model field is
// rejected with 400 before the upstream is ever contacted.
func TestChatCompletionsMissingModel(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("upstream should not be contacted when model is missing")
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"messages":[{"role":"user","content":"hi"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model, got %d, body: %s", rr.Code, rr.Body.String())
	}
}

// TestChatCompletionsEmptyMessages verifies that a request with an empty
// messages array is rejected with 400.
func TestChatCompletionsEmptyMessages(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("upstream should not be contacted when messages is empty")
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max","messages":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty messages, got %d, body: %s", rr.Code, rr.Body.String())
	}
}

// TestChatCompletionsStreaming verifies that a streaming request returns an
// SSE response containing data: lines forwarded from the upstream.
func TestChatCompletionsStreaming(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "data: {\"id\":\"chatcmpl_1\",\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		fmt.Fprintf(w, "data: {\"id\":\"chatcmpl_1\",\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n")
		fmt.Fprintf(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max","stream":true,"messages":[{"role":"user","content":"hi"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for streaming, got %d, body: %s", rr.Code, rr.Body.String())
	}

	respBody := rr.Body.String()
	if !strings.Contains(respBody, "data: ") {
		t.Fatalf("expected SSE data: lines in streaming response, got: %s", respBody)
	}
	if !strings.Contains(respBody, "[DONE]") {
		t.Fatalf("expected [DONE] marker in streaming response, got: %s", respBody)
	}
}

// ----- responses endpoint tests -----

// TestResponsesStringInput verifies that a Responses API request with a plain
// string input produces a response in the responsesResponse format.
func TestResponsesStringInput(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_1","model":"qwen3.7-max","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max","input":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}

	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode responses response: %v, body: %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("expected object %q, got %q", "response", result.Object)
	}
	if len(result.Output) == 0 {
		t.Fatalf("expected non-empty output, got: %s", rr.Body.String())
	}
}

// TestResponsesMissingModel verifies that omitting the model field is rejected
// with 400.
func TestResponsesMissingModel(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("upstream should not be contacted when model is missing")
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"input":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model, got %d, body: %s", rr.Code, rr.Body.String())
	}
}

// TestResponsesEmptyInput verifies that a request with no input is rejected
// with 400.
func TestResponsesEmptyInput(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("upstream should not be contacted when input is empty")
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty input, got %d, body: %s", rr.Code, rr.Body.String())
	}
}

func TestProvidersDefaultToOpenCodeGo(t *testing.T) {
	cfg := config.Example()
	cfg.Listen = "127.0.0.1:0"
	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	srv.SetConfigPath(t.TempDir() + "/config.json")

	req := httptest.NewRequest(http.MethodGet, "/ocgt/api/providers", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var got struct {
		Providers []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Line    string `json:"line"`
			BaseURL string `json:"baseUrl"`
			Enabled bool   `json:"enabled"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Providers) != 2 {
		t.Fatalf("unexpected providers count: %+v", got.Providers)
	}
	if got.Providers[0].Name != "OpenCode Go" || got.Providers[1].Name != "OpenCode Go" {
		t.Fatalf("unexpected providers: %+v", got.Providers)
	}
	if got.Providers[0].Line == got.Providers[1].Line {
		t.Fatalf("expected separate claude/codex providers, got %+v", got.Providers)
	}
	if !got.Providers[0].Enabled || !got.Providers[1].Enabled {
		t.Fatalf("unexpected providers: %+v", got.Providers)
	}
}

// TestClientSourceDetectsCodexByPath verifies that requests to /v1/responses
// (the Codex-only endpoint) are attributed to "Codex (CLI / App)" so the
// QuickConnect card's 24h request counter reflects real Codex traffic instead
// of bucketing it as "Unknown".
func TestClientSourceDetectsCodexByPath(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	if got := clientSourceFromRequest(req); got != "Codex (CLI / App)" {
		t.Fatalf("clientSourceFromRequest(/v1/responses) = %q, want %q", got, "Codex (CLI / App)")
	}

	// Claude Code path must NOT be mis-attributed as Codex.
	reqClaude := httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	if got := clientSourceFromRequest(reqClaude); got == "Codex (CLI / App)" {
		t.Fatalf("clientSourceFromRequest(/v1/messages) wrongly returned Codex label")
	}

	// Explicit X-Ocgt-Client header still wins over the path heuristic.
	reqHeader := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	reqHeader.Header.Set("X-Ocgt-Client", "claude-code-cli")
	if got := clientSourceFromRequest(reqHeader); got == "Codex (CLI / App)" {
		t.Fatalf("X-Ocgt-Client header should override the /v1/responses path heuristic")
	}
}
