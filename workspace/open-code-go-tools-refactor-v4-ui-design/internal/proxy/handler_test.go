package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

// newHandlerTestServer builds a proxy Server backed by a mock upstream that
// invokes the provided handler for every request. The upstream is torn down
// automatically when the test finishes. It follows the same construction
// pattern used in proxy_test.go (New + httptest.NewServer).
func newHandlerTestServer(t *testing.T, upstreamHandler http.HandlerFunc) *Server {
	t.Helper()
	upstream := httptest.NewServer(upstreamHandler)
	t.Cleanup(upstream.Close)
	srv, err := New(config.Config{
		Listen:        "127.0.0.1:0",
		Upstream:      upstream.URL,
		ActiveProfile: "test",
		Profiles: map[string]config.Profile{
			"test": {APIKey: "test-key", DefaultModel: "test-model"},
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return srv
}

// openAIChatResponseJSON is a canonical, well-formed OpenAI Chat Completions
// response body used by mock upstreams in these tests.
const openAIChatResponseJSON = `{"id":"chatcmpl_test","model":"test-model","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`

// =====================
// chatCompletions tests
// =====================

func TestChatCompletionsBasic(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(openAIChatResponseJSON))
	})

	body := []byte(`{"model":"test-model","messages":[{"role":"user","content":"hello"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var result openAIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to parse response body: %v, body = %s", err, rr.Body.String())
	}
	if result.ID != "chatcmpl_test" {
		t.Fatalf("id = %q, want chatcmpl_test", result.ID)
	}
	if len(result.Choices) != 1 {
		t.Fatalf("expected 1 choice, got %d", len(result.Choices))
	}
	if result.Choices[0].Message.Content != "ok" {
		t.Fatalf("content = %q, want ok", result.Choices[0].Message.Content)
	}
	if result.Usage.PromptTokens != 3 || result.Usage.CompletionTokens != 2 {
		t.Fatalf("usage = %+v, want prompt=3 completion=2", result.Usage)
	}
}

func TestChatCompletionsMissingModel(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("upstream should not be called when model is missing")
	})

	body := []byte(`{"messages":[{"role":"user","content":"hello"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model, got %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "model is required") {
		t.Fatalf("expected 'model is required' in error body, got: %s", rr.Body.String())
	}
}

func TestChatCompletionsEmptyMessages(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("upstream should not be called when messages is empty")
	})

	body := []byte(`{"model":"test-model","messages":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty messages, got %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "messages must contain at least one message") {
		t.Fatalf("expected 'messages must contain at least one message' in error body, got: %s", rr.Body.String())
	}
}

func TestChatCompletionsWrongMethod(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("upstream should not be called for a GET request")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/chat/completions", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET, got %d", rr.Code)
	}
}

// =================
// responses tests
// =================

func TestResponsesStringInput(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(openAIChatResponseJSON))
	})

	body := []byte(`{"model":"test-model","input":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to parse response body: %v, body = %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("object = %q, want response", result.Object)
	}
	if result.ID == "" || !strings.HasPrefix(result.ID, "resp_") {
		t.Fatalf("id = %q, want resp_ prefix", result.ID)
	}
	if len(result.Output) != 1 {
		t.Fatalf("expected 1 output item, got %d", len(result.Output))
	}
	if result.Output[0].Type != "message" || result.Output[0].Role != "assistant" {
		t.Fatalf("output[0] = %+v, want type=message role=assistant", result.Output[0])
	}
	if len(result.Output[0].Content) != 1 || result.Output[0].Content[0].Type != "output_text" {
		t.Fatalf("output content = %+v, want single output_text block", result.Output[0].Content)
	}
	if result.Output[0].Content[0].Text != "ok" {
		t.Fatalf("output text = %q, want ok", result.Output[0].Content[0].Text)
	}
}

func TestResponsesArrayInput(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(openAIChatResponseJSON))
	})

	body := []byte(`{"model":"test-model","input":[{"role":"user","content":"hello"},{"role":"assistant","content":"hi there"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to parse response body: %v, body = %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("object = %q, want response", result.Object)
	}
}

func TestResponsesMissingModel(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("upstream should not be called when model is missing")
	})

	body := []byte(`{"input":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model, got %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "model is required") {
		t.Fatalf("expected 'model is required' in error body, got: %s", rr.Body.String())
	}
}

func TestResponsesEmptyInput(t *testing.T) {
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("upstream should not be called when input is empty")
	})

	body := []byte(`{"model":"test-model","input":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty input, got %d, body = %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "input must contain at least one message") {
		t.Fatalf("expected 'input must contain at least one message' in error body, got: %s", rr.Body.String())
	}
}

func TestResponsesInstructions(t *testing.T) {
	var captured openAIRequest
	srv := newHandlerTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(openAIChatResponseJSON))
	})

	body := []byte(`{"model":"test-model","instructions":"You are a helpful assistant","input":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// The instructions must be forwarded as the first (system) message.
	// Expected order: [system, user].
	if len(captured.Messages) < 2 {
		t.Fatalf("expected at least 2 messages (system + user), got %d", len(captured.Messages))
	}
	if captured.Messages[0].Role != "system" {
		t.Fatalf("first message role = %q, want system", captured.Messages[0].Role)
	}
	sysContent, ok := captured.Messages[0].Content.(string)
	if !ok || sysContent != "You are a helpful assistant" {
		t.Fatalf("system message content = %#v, want \"You are a helpful assistant\"", captured.Messages[0].Content)
	}
	// The original user input must still be present.
	if captured.Messages[1].Role != "user" {
		t.Fatalf("second message role = %q, want user", captured.Messages[1].Role)
	}
	if userContent, ok := captured.Messages[1].Content.(string); !ok || userContent != "hello" {
		t.Fatalf("user message content = %#v, want \"hello\"", captured.Messages[1].Content)
	}
}
