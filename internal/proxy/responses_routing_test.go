package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

// newResponsesRoutingServer builds a Server whose active Codex-line provider
// uses the given protocol, pointing at the given upstream. ensureStore() is
// triggered first (it seeds a default-codex provider via sync.Once); we then
// retarget that seeded provider to the test upstream + protocol, so
// runtimeTargetForRequest resolves to it.
func newResponsesRoutingServer(t *testing.T, upstreamURL, protocol string) *Server {
	t.Helper()
	srv, err := New(config.Config{
		Listen:   "127.0.0.1:0",
		Upstream: upstreamURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	// configDir must be non-empty so runtimeTargetForRequest consults the store.
	srv.configDir = t.TempDir()
	store := srv.ensureStore()
	// Retarget the seeded default-codex provider to the test upstream/protocol.
	seeds := store.List()
	for _, p := range seeds {
		if p.ID == "default-codex" {
			if err := store.Update(p.ID, providers.Provider{
				ID:           p.ID,
				Name:         p.Name,
				BaseURL:      upstreamURL,
				Enabled:      true,
				Line:         "codex",
				Protocol:     protocol,
				DefaultModel: "test-model",
				AuthMode:     config.AuthModeBearer,
			}); err != nil {
				t.Fatal(err)
			}
			return srv
		}
	}
	t.Fatal("default-codex provider was not seeded; cannot retarget for test")
	return nil
}

// TestResponsesRoutesToChatCompletionsByDefault verifies that a Codex
// /v1/responses request to an openai-chat (default) provider is forwarded to
// the upstream as /v1/chat/completions, with the response converted back to
// Responses-API format. This is the legacy behaviour, preserved unchanged.
func TestResponsesRoutesToChatCompletionsByDefault(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("openai-chat upstream path = %q, want /v1/chat/completions", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"x","model":"test-model","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer upstream.Close()

	srv := newResponsesRoutingServer(t, upstream.URL, "openai-chat")

	body := []byte(`{"model":"test-model","input":"hi"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode responses body: %v, body: %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("expected object %q, got %q", "response", result.Object)
	}
	if result.Usage.TotalTokens != 2 {
		t.Fatalf("expected total_tokens 2, got %d (body: %s)", result.Usage.TotalTokens, rr.Body.String())
	}
}

// TestResponsesRoutesToMessagesForAnthropicProtocol verifies that when the
// active Codex provider is configured with the anthropic protocol, a
// /v1/responses request is forwarded upstream as /v1/messages (native Anthropic
// endpoint), and the Anthropic response is converted back to Responses-API
// format. This is the fix for "Codex 配置不生效" when the upstream is a
// native Claude endpoint.
func TestResponsesRoutesToMessagesForAnthropicProtocol(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("anthropic upstream path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"hello from claude"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":4}}`))
	}))
	defer upstream.Close()

	srv := newResponsesRoutingServer(t, upstream.URL, "anthropic")

	body := []byte(`{"model":"test-model","input":"hi"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode responses body: %v, body: %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("expected object %q, got %q", "response", result.Object)
	}
	if len(result.Output) == 0 || len(result.Output[0].Content) == 0 {
		t.Fatalf("expected non-empty output content, got: %s", rr.Body.String())
	}
	if got := result.Output[0].Content[0].Text; got != "hello from claude" {
		t.Fatalf("expected text %q, got %q", "hello from claude", got)
	}
	if result.Usage.InputTokens != 3 || result.Usage.OutputTokens != 4 {
		t.Fatalf("expected usage 3/4, got %d/%d", result.Usage.InputTokens, result.Usage.OutputTokens)
	}
}

// TestResponsesRoutesToResponsesForNativeProtocol verifies that when the active
// Codex provider is configured with the openai-responses protocol, a
// /v1/responses request is forwarded upstream verbatim to /v1/responses (native
// pass-through, no format conversion).
func TestResponsesRoutesToResponsesForNativeProtocol(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("native responses upstream path = %q, want /v1/responses", r.URL.Path)
		}
		// Echo back a minimal native Responses-API body verbatim.
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"resp_native","object":"response","model":"test-model","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"native"}]}],"usage":{"input_tokens":5,"output_tokens":6}}`))
	}))
	defer upstream.Close()

	srv := newResponsesRoutingServer(t, upstream.URL, "openai-responses")

	body := []byte(`{"model":"test-model","input":"hi"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	// Native pass-through returns the upstream body as-is, so the id should
	// match exactly (no ocgt-generated resp_ prefix).
	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode responses body: %v, body: %s", err, rr.Body.String())
	}
	if result.ID != "resp_native" {
		t.Fatalf("expected native id %q, got %q (body: %s)", "resp_native", result.ID, rr.Body.String())
	}
}

// TestResponsesAnthropicStreaming translates upstream Anthropic SSE events
// (content_block_delta with text_delta) into Responses-API SSE events
// (response.output_text.delta).
func TestResponsesAnthropicStreaming(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("anthropic stream upstream path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":2}}}\n\n")
		fmt.Fprintf(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n")
		fmt.Fprintf(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":1}}\n\n")
	}))
	defer upstream.Close()

	srv := newResponsesRoutingServer(t, upstream.URL, "anthropic")

	body := []byte(`{"model":"test-model","stream":true,"input":"hi"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}
	respBody := rr.Body.String()
	if !contains(respBody, "response.created") {
		t.Fatalf("expected response.created event, got: %s", respBody)
	}
	if !contains(respBody, "response.output_item.added") {
		t.Fatalf("expected response.output_item.added before text deltas, got: %s", respBody)
	}
	if !contains(respBody, "response.output_text.delta") {
		t.Fatalf("expected response.output_text.delta event, got: %s", respBody)
	}
	if !contains(respBody, "response.output_item.done") {
		t.Fatalf("expected response.output_item.done, got: %s", respBody)
	}
	if !contains(respBody, "response.completed") {
		t.Fatalf("expected response.completed event, got: %s", respBody)
	}
	if !contains(respBody, `"total_tokens":3`) {
		t.Fatalf("expected completed usage.total_tokens, got: %s", respBody)
	}
	if !contains(respBody, "Hi") {
		t.Fatalf("expected streamed text %q in response, got: %s", "Hi", respBody)
	}
}

func contains(s, substr string) bool {
	return bytes.Contains([]byte(s), []byte(substr))
}
