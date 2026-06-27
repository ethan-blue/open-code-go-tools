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

// standardOpenAIResponse is a realistic non-streaming OpenAI chat completion
// response returned by the mock upstream used across these tests.
const standardOpenAIResponse = `{"id":"test","model":"test-model","choices":[{"message":{"content":"Hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`

// newProxyTestServer spins up a mock upstream HTTP server delegating to the
// given handler, then returns a proxy.Server configured to forward to it.
// The mock upstream is cleaned up automatically when the test finishes.
func newProxyTestServer(t *testing.T, upstream http.Handler) *Server {
	t.Helper()
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)
	srv, err := New(config.Config{
		Listen:        "127.0.0.1:0",
		Upstream:      up.URL,
		ActiveProfile: "test",
		Profiles: map[string]config.Profile{
			"test": {APIKey: "test-key", DefaultModel: "test-model"},
		},
	})
	if err != nil {
		t.Fatalf("New server: %v", err)
	}
	return srv
}

// openAIMockUpstream returns a handler that responds to every request with the
// standard non-streaming OpenAI chat completion response.
func openAIMockUpstream(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(standardOpenAIResponse))
	})
}

// doJSONPost issues a POST with an application/json body through the proxy and
// returns the captured response recorder.
func doJSONPost(t *testing.T, srv *Server, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	return rr
}

// ===== /v1/chat/completions =====

func TestChatCompletionsBasic(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	body := []byte(`{"model":"test-model","messages":[{"role":"user","content":"hi"}]}`)
	rr := doJSONPost(t, srv, "/v1/chat/completions", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON response: %v, body = %s", err, rr.Body.String())
	}
	if result["id"] != "test" {
		t.Fatalf("id = %v, want \"test\"", result["id"])
	}
	if result["model"] != "test-model" {
		t.Fatalf("model = %v, want \"test-model\"", result["model"])
	}
	choices, ok := result["choices"].([]any)
	if !ok || len(choices) == 0 {
		t.Fatalf("expected non-empty choices array, got: %v", result["choices"])
	}
	usage, ok := result["usage"].(map[string]any)
	if !ok {
		t.Fatalf("expected usage object, got: %v", result["usage"])
	}
	if usage["total_tokens"] != float64(15) {
		t.Fatalf("total_tokens = %v, want 15", usage["total_tokens"])
	}
}

func TestChatCompletionsMissingModel(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	body := []byte(`{"messages":[{"role":"user","content":"hi"}]}`)
	rr := doJSONPost(t, srv, "/v1/chat/completions", body)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rr.Code, rr.Body.String())
	}
}

func TestChatCompletionsEmptyMessages(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	body := []byte(`{"model":"test-model","messages":[]}`)
	rr := doJSONPost(t, srv, "/v1/chat/completions", body)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rr.Code, rr.Body.String())
	}
}

func TestChatCompletionsStreaming(t *testing.T) {
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "data: {\"id\":\"test\",\"model\":\"test-model\",\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		fmt.Fprintf(w, "data: [DONE]\n\n")
	})
	srv := newProxyTestServer(t, upstream)

	body := []byte(`{"model":"test-model","stream":true,"messages":[{"role":"user","content":"hi"}]}`)
	rr := doJSONPost(t, srv, "/v1/chat/completions", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}

	respBody := rr.Body.String()
	if !strings.Contains(respBody, "data:") {
		t.Fatalf("expected SSE \"data:\" lines in response, got: %s", respBody)
	}
	if !strings.Contains(respBody, "data: [DONE]") {
		t.Fatalf("expected \"data: [DONE]\" sentinel in stream, got: %s", respBody)
	}
	if !strings.Contains(respBody, `"delta"`) {
		t.Fatalf("expected streamed delta payload in response, got: %s", respBody)
	}
}

// ===== /v1/responses =====

func TestResponsesStringInput(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	body := []byte(`{"model":"test-model","input":"Hello, world!"}`)
	rr := doJSONPost(t, srv, "/v1/responses", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}

	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON response: %v, body = %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("object = %q, want \"response\"", result.Object)
	}
	if result.Model != "test-model" {
		t.Fatalf("model = %q, want \"test-model\"", result.Model)
	}
	if len(result.Output) == 0 || len(result.Output[0].Content) == 0 {
		t.Fatalf("expected output content blocks, got: %+v", result.Output)
	}
	if got := result.Output[0].Content[0].Text; got != "Hello" {
		t.Fatalf("output text = %q, want \"Hello\"", got)
	}
	if result.Usage.InputTokens != 10 || result.Usage.OutputTokens != 5 {
		t.Fatalf("usage = %+v, want input=10 output=5", result.Usage)
	}
}

func TestResponsesArrayInput(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	body := []byte(`{"model":"test-model","input":[{"role":"user","content":"hi there"}]}`)
	rr := doJSONPost(t, srv, "/v1/responses", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}

	var result responsesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid JSON response: %v, body = %s", err, rr.Body.String())
	}
	if result.Object != "response" {
		t.Fatalf("object = %q, want \"response\"", result.Object)
	}
	if len(result.Output) == 0 || result.Output[0].Content[0].Text != "Hello" {
		t.Fatalf("expected converted output with text \"Hello\", got: %+v", result.Output)
	}
}

func TestResponsesMissingModel(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	body := []byte(`{"input":"hi"}`)
	rr := doJSONPost(t, srv, "/v1/responses", body)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rr.Code, rr.Body.String())
	}
}

func TestResponsesEmptyInput(t *testing.T) {
	srv := newProxyTestServer(t, openAIMockUpstream(t))

	// An empty array yields zero converted messages, triggering validation.
	body := []byte(`{"model":"test-model","input":[]}`)
	rr := doJSONPost(t, srv, "/v1/responses", body)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rr.Code, rr.Body.String())
	}
}
