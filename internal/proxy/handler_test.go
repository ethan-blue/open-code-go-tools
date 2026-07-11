package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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

// TestResponsesInputToMessagesToolContinuation verifies that a Responses-API
// input array carrying a prior tool call (function_call) and its result
// (function_call_output) is reconstructed as Anthropic tool_use / tool_result
// content blocks. This matters because Codex sends these items on the
// continuation turn; dropping them (the pre-fix behavior) silently breaks
// multi-turn tool use — the upstream never learns the tool's result.
func TestResponsesInputToMessagesToolContinuation(t *testing.T) {
	input := []any{
		map[string]any{"role": "user", "content": "what's the weather?"},
		map[string]any{
			"type":      "function_call",
			"call_id":   "call_abc",
			"name":      "get_weather",
			"arguments": `{"city":"Paris"}`,
		},
		map[string]any{
			"type":    "function_call_output",
			"call_id": "call_abc",
			"output":  "sunny, 21C",
		},
	}

	msgs := responsesInputToMessages(input)
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages, got %d: %#v", len(msgs), msgs)
	}

	// [0] plain user text
	if msgs[0].Role != "user" {
		t.Fatalf("msg[0] role = %q, want user", msgs[0].Role)
	}
	if s, _ := msgs[0].Content.(string); s != "what's the weather?" {
		t.Fatalf("msg[0] content = %#v", msgs[0].Content)
	}

	// [1] assistant tool_use reconstructed from function_call, with arguments
	// parsed into a structured object (not left as a JSON string).
	if msgs[1].Role != "assistant" {
		t.Fatalf("msg[1] role = %q, want assistant", msgs[1].Role)
	}
	blocks, ok := msgs[1].Content.([]any)
	if !ok || len(blocks) != 1 {
		t.Fatalf("msg[1] content is not a single block: %#v", msgs[1].Content)
	}
	tu, _ := blocks[0].(map[string]any)
	if tu["type"] != "tool_use" || tu["id"] != "call_abc" || tu["name"] != "get_weather" {
		t.Fatalf("msg[1] tool_use block wrong: %#v", tu)
	}
	inputObj, ok := tu["input"].(map[string]any)
	if !ok || inputObj["city"] != "Paris" {
		t.Fatalf("msg[1] tool_use input not parsed to object: %#v", tu["input"])
	}

	// [2] user tool_result reconstructed from function_call_output
	if msgs[2].Role != "user" {
		t.Fatalf("msg[2] role = %q, want user", msgs[2].Role)
	}
	rblocks, ok := msgs[2].Content.([]any)
	if !ok || len(rblocks) != 1 {
		t.Fatalf("msg[2] content is not a single block: %#v", msgs[2].Content)
	}
	tr, _ := rblocks[0].(map[string]any)
	if tr["type"] != "tool_result" || tr["tool_use_id"] != "call_abc" || tr["content"] != "sunny, 21C" {
		t.Fatalf("msg[2] tool_result block wrong: %#v", tr)
	}
}

// TestResponsesToolContinuationReachesUpstream is the end-to-end regression
// guard for the tool-continuation fix: it captures the chat-completions body
// the proxy sends upstream and asserts the tool result arrives as a role:tool
// message. Before the fix, function_call_output was dropped and this body
// contained no tool result at all.
func TestResponsesToolContinuationReachesUpstream(t *testing.T) {
	var gotBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_1","model":"qwen3.7-max","choices":[{"message":{"content":"It's sunny in Paris."},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max","input":[` +
		`{"role":"user","content":"what's the weather?"},` +
		`{"type":"function_call","call_id":"call_abc","name":"get_weather","arguments":"{\"city\":\"Paris\"}"},` +
		`{"type":"function_call_output","call_id":"call_abc","output":"sunny, 21C"}` +
		`]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}

	var upstreamReq struct {
		Messages []struct {
			Role       string `json:"role"`
			ToolCallID string `json:"tool_call_id"`
			Content    any    `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(gotBody, &upstreamReq); err != nil {
		t.Fatalf("failed to decode upstream body: %v, body: %s", err, gotBody)
	}

	var sawToolResult bool
	for _, m := range upstreamReq.Messages {
		if m.Role == "tool" && m.ToolCallID == "call_abc" {
			sawToolResult = true
			if s, _ := m.Content.(string); !strings.Contains(s, "sunny") {
				t.Fatalf("tool message content missing result: %#v", m.Content)
			}
		}
	}
	if !sawToolResult {
		t.Fatalf("upstream request dropped the tool result (role:tool message absent): %s", gotBody)
	}
}

// TestResponsesToolChoiceMapping verifies the Responses→Anthropic tool_choice
// mapping that lets Codex control tool invocation. Without it, a client that
// says "you must call a tool" (required) or "don't call tools" (none) is
// silently ignored.
func TestResponsesToolChoiceMapping(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want map[string]any
	}{
		{"auto", "auto", map[string]any{"type": "auto"}},
		{"none", "none", map[string]any{"type": "none"}},
		{"required", "required", map[string]any{"type": "any"}},
		{"named function flat", map[string]any{"type": "function", "name": "get_weather"}, map[string]any{"type": "tool", "name": "get_weather"}},
		{"named function nested", map[string]any{"type": "function", "function": map[string]any{"name": "get_weather"}}, map[string]any{"type": "tool", "name": "get_weather"}},
		{"unknown string", "banana", nil},
		{"nil", nil, nil},
		{"function without name", map[string]any{"type": "function"}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := responsesToolChoiceToAnthropic(tc.in)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("want nil, got %#v", got)
				}
				return
			}
			for k, v := range tc.want {
				if got[k] != v {
					t.Fatalf("key %q = %#v, want %#v (full: %#v)", k, got[k], v, got)
				}
			}
		})
	}
}

// TestConvertToolChoiceNone verifies the chat-path leg of tool_choice="none":
// the Anthropic intermediate {type:none} must translate to OpenAI "none" so a
// generic OpenAI-compatible upstream also suppresses tool calls.
func TestConvertToolChoiceNone(t *testing.T) {
	allowed := map[string]bool{"get_weather": true}
	got := convertToolChoice(map[string]any{"type": "none"}, allowed)
	if got != "none" {
		t.Fatalf("convertToolChoice(none) = %#v, want \"none\"", got)
	}
}

// TestResponsesReasoningSummary verifies extraction of reasoning summary text
// from the several shapes Codex may send.
func TestResponsesReasoningSummary(t *testing.T) {
	cases := []struct {
		name string
		item map[string]any
		want string
	}{
		{"string summary", map[string]any{"summary": "  thought  "}, "thought"},
		{"array summary", map[string]any{"summary": []any{
			map[string]any{"type": "summary_text", "text": "step 1"},
			map[string]any{"type": "summary_text", "text": "step 2"},
		}}, "step 1\nstep 2"},
		{"text fallback", map[string]any{"text": "direct"}, "direct"},
		{"encrypted only", map[string]any{"encrypted_content": "opaque"}, ""},
		{"empty", map[string]any{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := responsesReasoningSummary(tc.item); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestStripUnsignedThinkingBlocks verifies that signature-less thinking blocks
// are removed (Anthropic rejects them) while signed thinking, and all other
// block types, survive.
func TestStripUnsignedThinkingBlocks(t *testing.T) {
	msgs := []anthropicMsg{
		{Role: "assistant", Content: []any{
			map[string]any{"type": "thinking", "thinking": "no sig"},                        // dropped
			map[string]any{"type": "thinking", "thinking": "signed", "signature": "abc123"}, // kept
			map[string]any{"type": "text", "text": "hello"},                                 // kept
		}},
		{Role: "user", Content: "plain string stays"}, // untouched (not a block array)
	}
	stripUnsignedThinkingBlocks(msgs)

	blocks, ok := msgs[0].Content.([]any)
	if !ok {
		t.Fatalf("msg[0] content type changed: %#v", msgs[0].Content)
	}
	if len(blocks) != 2 {
		t.Fatalf("expected 2 surviving blocks, got %d: %#v", len(blocks), blocks)
	}
	if b0, _ := blocks[0].(map[string]any); b0["signature"] != "abc123" {
		t.Fatalf("first surviving block should be the signed thinking: %#v", blocks[0])
	}
	if s, _ := msgs[1].Content.(string); s != "plain string stays" {
		t.Fatalf("string content should be untouched: %#v", msgs[1].Content)
	}
}

// TestResponsesToolChoiceReachesUpstream is the end-to-end guard: a Responses
// request with tool_choice="required" and parallel_tool_calls=false must reach
// the chat-completions upstream as tool_choice:"required" and
// parallel_tool_calls:false.
func TestResponsesToolChoiceReachesUpstream(t *testing.T) {
	var gotBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_1","model":"qwen3.7-max","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer upstream.Close()

	srv := newChatTestServer(t, upstream.URL)

	body := []byte(`{"model":"qwen3.7-max","input":"weather?",` +
		`"tool_choice":"required","parallel_tool_calls":false,` +
		`"tools":[{"type":"function","name":"get_weather","parameters":{"type":"object"}}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", rr.Code, rr.Body.String())
	}

	var upstreamReq struct {
		ToolChoice        any   `json:"tool_choice"`
		ParallelToolCalls *bool `json:"parallel_tool_calls"`
	}
	if err := json.Unmarshal(gotBody, &upstreamReq); err != nil {
		t.Fatalf("decode upstream body: %v, body: %s", err, gotBody)
	}
	if upstreamReq.ToolChoice != "required" {
		t.Fatalf("upstream tool_choice = %#v, want \"required\": %s", upstreamReq.ToolChoice, gotBody)
	}
	if upstreamReq.ParallelToolCalls == nil || *upstreamReq.ParallelToolCalls != false {
		t.Fatalf("upstream parallel_tool_calls = %#v, want false: %s", upstreamReq.ParallelToolCalls, gotBody)
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
