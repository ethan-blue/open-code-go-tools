package proxy

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"
)

// responses handles OpenAI Responses API /v1/responses requests (for Codex).
func (s *Server) responses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
		return
	}
	target, err := s.runtimeTargetForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, MaxBodySize+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if int64(len(data)) > MaxBodySize {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Errorf("request body too large (max %d bytes)", MaxBodySize))
		return
	}
	var payload responsesRequest
	if err := json.Unmarshal(data, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(payload.Model) == "" {
		writeError(w, http.StatusBadRequest, errors.New("model is required"))
		return
	}

	// Convert Responses API input to Anthropic messages format. This also
	// reconstructs tool-call turns (function_call / function_call_output) so
	// multi-turn tool use survives the round-trip through the proxy.
	messages := responsesInputToMessages(payload.Input)

	// Prepend instructions as a system message if provided
	var system any
	if payload.Instructions != "" {
		system = payload.Instructions
	}

	if len(messages) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("input must contain at least one message"))
		return
	}

	payload.Model = target.profile.ResolveModel(payload.Model)
	start := time.Now()
	client := clientSourceFromRequest(r)

	// Route by the active provider's protocol — mirrors how messages.go picks
	// between /v1/messages and /v1/chat/completions. Codex always speaks the
	// Responses API on the wire, but the upstream may be:
	//   - openai-chat (default / seeded): translate via chat completions
	//   - anthropic: forward to /v1/messages, translate the response back
	//   - openai-responses: pass through to upstream /v1/responses verbatim
	protocol := targetProtocolForModel(target, payload.Model)
	switch protocol {
	case "anthropic":
		if payload.Stream {
			s.streamResponsesViaAnthropic(w, r, target, payload, messages, system, start, client)
		} else {
			s.forwardResponsesViaAnthropic(w, r, target, payload, messages, system, start, client)
		}
		return
	case "openai-responses":
		if payload.Stream {
			s.streamResponsesNative(w, r, target, payload, data, start, client)
		} else {
			s.forwardResponsesNative(w, r, target, payload, data, start, client)
		}
		return
	}

	if payload.Stream {
		s.streamResponses(w, r, target, payload, messages, system, start, client)
		return
	}

	s.forwardResponses(w, r, target, payload, messages, system, start, client)
}

// responsesInputToMessages converts a Responses-API `input` field into
// Anthropic messages. It accepts a bare string, or an array of input items:
// role/content messages (string or structured content blocks) plus the
// tool-call continuation items function_call and function_call_output, which
// are reconstructed as Anthropic tool_use / tool_result content blocks so the
// downstream converter can carry a multi-turn tool conversation upstream.
func responsesInputToMessages(input any) []anthropicMsg {
	var messages []anthropicMsg
	switch v := input.(type) {
	case string:
		messages = append(messages, anthropicMsg{Role: "user", Content: v})
	case []any:
		for _, item := range v {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			switch m["type"] {
			case "function_call":
				// Assistant turn that invoked a tool → tool_use block.
				callID, _ := m["call_id"].(string)
				name, _ := m["name"].(string)
				if callID == "" || name == "" {
					continue
				}
				var argsObj any
				if argStr, _ := m["arguments"].(string); argStr != "" {
					if json.Unmarshal([]byte(argStr), &argsObj) != nil {
						argsObj = map[string]any{}
					}
				} else {
					argsObj = map[string]any{}
				}
				messages = append(messages, anthropicMsg{
					Role: "assistant",
					Content: []any{map[string]any{
						"type":  "tool_use",
						"id":    callID,
						"name":  name,
						"input": argsObj,
					}},
				})
			case "function_call_output":
				// Tool result the client fed back → tool_result block.
				callID, _ := m["call_id"].(string)
				if callID == "" {
					continue
				}
				messages = append(messages, anthropicMsg{
					Role: "user",
					Content: []any{map[string]any{
						"type":        "tool_result",
						"tool_use_id": callID,
						"content":     responsesOutputText(m["output"]),
					}},
				})
			case "reasoning":
				// Assistant reasoning the client echoed back. Carry only the
				// human-readable summary as a thinking block; Codex's
				// encrypted_content is an OpenAI-format blob, not a valid
				// Anthropic signature, so it is intentionally dropped. On the
				// chat path this becomes reasoning_content; the anthropic path
				// strips signature-less thinking blocks (see buildAnthropicPayload).
				summary := responsesReasoningSummary(m)
				if summary == "" {
					continue
				}
				messages = append(messages, anthropicMsg{
					Role: "assistant",
					Content: []any{map[string]any{
						"type":     "thinking",
						"thinking": summary,
					}},
				})
			default:
				// Plain role/content message.
				role, _ := m["role"].(string)
				if role == "" {
					continue
				}
				if content, ok := m["content"].(string); ok {
					messages = append(messages, anthropicMsg{Role: role, Content: content})
				} else if contentArr, ok := m["content"].([]any); ok {
					var parts []string
					for _, block := range contentArr {
						if bm, ok := block.(map[string]any); ok {
							if text, ok := bm["text"].(string); ok {
								parts = append(parts, text)
							}
						}
					}
					if len(parts) > 0 {
						messages = append(messages, anthropicMsg{Role: role, Content: strings.Join(parts, "\n")})
					}
				}
			}
		}
	}
	return messages
}

// responsesOutputText normalizes a function_call_output `output` field, which
// may be a plain string or an array of content blocks, into a single string.
func responsesOutputText(output any) string {
	switch o := output.(type) {
	case string:
		return o
	case []any:
		var parts []string
		for _, block := range o {
			if bm, ok := block.(map[string]any); ok {
				if text, ok := bm["text"].(string); ok {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

// responsesReasoningSummary extracts human-readable summary text from a
// Responses `reasoning` item. The summary may be a plain string, an array of
// {type:"summary_text", text:...} blocks, or absent (encrypted-only), in which
// case it returns "".
func responsesReasoningSummary(item map[string]any) string {
	switch s := item["summary"].(type) {
	case string:
		return strings.TrimSpace(s)
	case []any:
		var parts []string
		for _, block := range s {
			if bm, ok := block.(map[string]any); ok {
				if text, ok := bm["text"].(string); ok && text != "" {
					parts = append(parts, text)
				}
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	}
	// Some clients place summary text directly on a `text` field.
	if text, ok := item["text"].(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

// stripUnsignedThinkingBlocks removes thinking content blocks that carry no
// signature from each message's content. Anthropic rejects thinking blocks
// without a valid signature, and reasoning we reconstruct from a Codex
// Responses continuation has none (the encrypted blob is not Anthropic-valid).
// The chat path keeps these blocks (converted to reasoning_content); only the
// anthropic path must strip them before forwarding to /v1/messages.
func stripUnsignedThinkingBlocks(messages []anthropicMsg) {
	for i := range messages {
		blocks, ok := messages[i].Content.([]any)
		if !ok {
			continue
		}
		kept := blocks[:0]
		for _, block := range blocks {
			if bm, ok := block.(map[string]any); ok && bm["type"] == "thinking" {
				if sig, _ := bm["signature"].(string); sig == "" {
					continue // drop signature-less thinking block
				}
			}
			kept = append(kept, block)
		}
		messages[i].Content = kept
	}
}

// forwardResponses handles non-streaming Responses API requests.
// It forwards to the upstream via chat completions (or Anthropic messages for
// native profiles) and converts the result to Responses API format.
func (s *Server) forwardResponses(w http.ResponseWriter, r *http.Request, target requestTarget, payload responsesRequest, messages []anthropicMsg, system any, start time.Time, client string) {
	s.wg.Add(1)
	defer s.wg.Done()

	model := payload.Model

	// Check circuit breaker
	if s.isModelCircuitTripped(model) {
		log.Printf("[CircuitBreaker] Model %q is tripped, rejecting new request", model)
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}

	// Build anthropicRequest for forwarding (chat path shares the same payload
	// shape as the anthropic path; anthropicToOpenAI translates it downstream).
	anthReq := buildAnthropicPayload(model, payload, messages, system, false)

	const maxRetries = 5
	var lastErr error
	var lastStatus int
	var lastBody []byte

	// Fallback chain (model-level failover) + account failover, mirroring
	// forwardAnthropicMessages / forwardChatCompletions.
	candidates := s.buildCandidateModels(model, target.profile)

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if len(candidates) > 1 {
			idx := attempt / 2
			if idx >= len(candidates) {
				idx = len(candidates) - 1
			}
			model = candidates[idx]
		}
		accountID := s.pickAccount(&target)
		// Sanitize image content for non-vision models
		if !supportsVisionInput(model) {
			sanitizeContentBlocksForNonVision(anthReq.Messages)
		}

		chatReq := anthropicToOpenAI(anthReq)
		chatReq.Model = model
		chatReq.ParallelToolCalls = payload.ParallelToolCalls

		body, err := json.Marshal(chatReq)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(body), target)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		applyAnthropicAuth(req, target.profile)

		reqStart := time.Now()
		resp, err := s.doUpstream(req, target.timeoutSeconds)
		duration := time.Since(reqStart)

		if err != nil {
			s.recordModelFailure(model)
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			lastErr = err
			lastStatus = proxyErrorStatus(err)
			log.Printf("[Retry] Responses request to model %q failed (attempt %d/%d): %v", model, attempt+1, maxRetries+1, err)

			if attempt < maxRetries {
				backoff := time.Duration(500*(1<<attempt)) * time.Millisecond
				time.Sleep(backoff)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, time.Since(start), model, "responses", tokenUsage{Client: client}, err.Error())
			break
		}

		if resp.StatusCode >= 400 {
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			s.recordModelFailure(model)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}

			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) &&
					len(target.accounts) > 1 && attempt < maxRetries {
					log.Printf("[Failover] Account %q got %d, rotating to next account (attempt %d/%d)", accountID, resp.StatusCode, attempt+1, maxRetries+1)
					continue
				}
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
				return
			}

			log.Printf("[Retry] Responses model %q returned %d (attempt %d/%d): %s", model, resp.StatusCode, attempt+1, maxRetries+1, errText)
			if attempt < maxRetries {
				// 429 with a multi-account pool: fail over immediately.
				if resp.StatusCode == http.StatusTooManyRequests && len(target.accounts) > 1 {
					continue
				}
				backoff := time.Duration(500*(1<<attempt)) * time.Millisecond
				time.Sleep(backoff)
				continue
			}

			lastErr = fmt.Errorf("upstream model %s returned status %d after %d retries: %s", model, resp.StatusCode, maxRetries+1, errText)
			lastStatus = resp.StatusCode
			lastBody = respBody
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
			break
		}

		// Success — decode upstream OpenAI response and convert to Responses API format
		s.recordModelSuccess(model)
		s.noteAccountSuccess(target.name, accountID)
		var out openAIResponse
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			resp.Body.Close()
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses", tokenUsage{Client: client}, err.Error())
			writeError(w, http.StatusBadGateway, err)
			return
		}
		resp.Body.Close()

		// Convert to Responses API format
		var outputItems []responsesItem
		if len(out.Choices) > 0 {
			choice := out.Choices[0]
			// Text content message (only if there is text)
			if choice.Message.Content != "" {
				outputItems = append(outputItems, responsesItem{
					Type:   "message",
					ID:     fmt.Sprintf("msg_%s", generateID()),
					Role:   "assistant",
					Status: "completed",
					Content: []responsesContent{
						{
							Type:        "output_text",
							Text:        choice.Message.Content,
							Annotations: []any{},
						},
					},
				})
			}
			// Tool calls → function_call output items
			for _, call := range choice.Message.ToolCalls {
				outputItems = append(outputItems, responsesItem{
					Type:      "function_call",
					ID:        fmt.Sprintf("fc_%s", generateID()),
					Status:    "completed",
					CallID:    call.ID,
					Name:      call.Function.Name,
					Arguments: call.Function.Arguments,
				})
			}
		}
		if len(outputItems) == 0 {
			outputItems = []responsesItem{{
				Type:   "message",
				ID:     fmt.Sprintf("msg_%s", generateID()),
				Role:   "assistant",
				Status: "completed",
				Content: []responsesContent{
					{Type: "output_text", Text: "", Annotations: []any{}},
				},
			}}
		}

		responsesResp := responsesResponse{
			ID:     fmt.Sprintf("resp_%s", generateID()),
			Object: "response",
			Model:  model,
			Output: outputItems,
			Usage: responsesUsage{
				InputTokens:  out.Usage.PromptTokens,
				OutputTokens: out.Usage.CompletionTokens,
			},
		}

		usage := tokenUsage{
			Client:       client,
			InputTokens:  out.Usage.PromptTokens,
			OutputTokens: out.Usage.CompletionTokens,
		}
		if out.Usage.CacheReadInputTokens > 0 {
			usage.CacheReadTokens = out.Usage.CacheReadInputTokens
		}
		if out.Usage.CacheCreationInputTokens > 0 {
			usage.CacheCreationTokens = out.Usage.CacheCreationInputTokens
		}
		s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "responses", usage)
		writeJSON(w, http.StatusOK, responsesResp)
		return
	}

	// All retry attempts failed
	if lastErr != nil {
		if len(lastBody) > 0 {
			writeUpstreamError(w, lastStatus, lastBody)
		} else {
			writeError(w, lastStatus, lastErr)
		}
		return
	}
	writeError(w, http.StatusBadGateway, fmt.Errorf("all %d retry attempts failed", maxRetries+1))
}

// streamResponses handles streaming Responses API requests.
// It forwards to the upstream via chat completions (or Anthropic messages for
// native profiles) and converts the upstream SSE chunks to Responses API format.
func (s *Server) streamResponses(w http.ResponseWriter, r *http.Request, target requestTarget, payload responsesRequest, messages []anthropicMsg, system any, start time.Time, client string) {
	s.wg.Add(1)
	defer s.wg.Done()

	model := payload.Model

	if s.isModelCircuitTripped(model) {
		log.Printf("[CircuitBreaker] Model %q is tripped, rejecting new request", model)
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}

	// Build anthropicRequest for forwarding
	anthReq := buildAnthropicPayload(model, payload, messages, system, true)

	// Sanitize image content for non-vision models
	if !supportsVisionInput(model) {
		sanitizeContentBlocksForNonVision(anthReq.Messages)
	}

	chatReq := anthropicToOpenAI(anthReq)
	chatReq.Model = model
	chatReq.ParallelToolCalls = payload.ParallelToolCalls

	body, err := json.Marshal(chatReq)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	// Retry with account failover — safe here because nothing has been
	// written to the client until the upstream stream is established.
	const maxStreamRetries = 5
	var resp *http.Response
	for attempt := 0; ; attempt++ {
		accountID := s.pickAccount(&target)
		req, reqErr := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(body), target)
		if reqErr != nil {
			writeError(w, http.StatusInternalServerError, reqErr)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		prepareStreamingUpstreamRequest(req)
		applyAnthropicAuth(req, target.profile)

		resp, err = s.doUpstream(req, target.timeoutSeconds)
		if err != nil {
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			if attempt < maxStreamRetries {
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			duration := time.Since(start)
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, http.StatusBadGateway, duration, model, "responses (stream)", tokenUsage{Client: client}, err.Error())
			writeError(w, http.StatusBadGateway, err)
			return
		}

		if resp.StatusCode >= 400 {
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}
			retryable := resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests ||
				((resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && len(target.accounts) > 1)
			if retryable && attempt < maxStreamRetries {
				if len(target.accounts) <= 1 || resp.StatusCode >= 500 {
					time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				}
				log.Printf("[Retry] responses (stream) model %q returned %d (attempt %d/%d)", model, resp.StatusCode, attempt+1, maxStreamRetries+1)
				continue
			}
			duration := time.Since(start)
			writeUpstreamError(w, resp.StatusCode, respBody)
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "responses (stream)", tokenUsage{Client: client}, errText)
			return
		}
		s.noteAccountSuccess(target.name, accountID)
		break
	}
	defer resp.Body.Close()

	s.recordModelSuccess(model)

	// Build the initial response object for response.created event
	responseID := fmt.Sprintf("resp_%s", generateID())
	initialResp := responsesResponse{
		ID:     responseID,
		Object: "response",
		Model:  model,
		Output: []responsesItem{},
		Usage:  responsesUsage{},
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("streaming not supported"))
		return
	}

	// Emit response.created event
	writeSSEEvent(w, flusher, "response.created", map[string]any{
		"type":     "response.created",
		"response": initialResp,
	})

	// Track streaming state for text and tool calls
	var fullText strings.Builder
	var inputTokens, outputTokens int
	var textItemAdded bool
	var textItemID string
	var textOutputIndex uint32
	var nextOutputIndex uint32

	// Tool call state tracking (keyed by tool index from upstream)
	type toolCallState struct {
		callID      string
		name        string
		arguments   string
		itemID      string
		outputIndex uint32
		added       bool
		done        bool
	}
	toolStates := make(map[int]*toolCallState)

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	var lineBuf strings.Builder
	var inDataBlock bool

	ensureTextItemStarted := func() {
		if textItemAdded {
			return
		}
		textItemAdded = true
		textItemID = fmt.Sprintf("msg_%s", generateID())
		outputIdx := nextOutputIndex
		textOutputIndex = outputIdx
		nextOutputIndex++
		writeSSEEvent(w, flusher, "response.output_item.added", map[string]any{
			"type":         "response.output_item.added",
			"output_index": outputIdx,
			"item": map[string]any{
				"id":      textItemID,
				"type":    "message",
				"status":  "in_progress",
				"role":    "assistant",
				"content": []any{},
			},
		})
		writeSSEEvent(w, flusher, "response.content_part.added", map[string]any{
			"type":          "response.content_part.added",
			"item_id":       textItemID,
			"output_index":  outputIdx,
			"content_index": 0,
			"part":          map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
		})
	}

	flushTextItem := func() {
		if !textItemAdded {
			return
		}
		writeSSEEvent(w, flusher, "response.output_text.done", map[string]any{
			"type":          "response.output_text.done",
			"item_id":       textItemID,
			"output_index":  textOutputIndex,
			"content_index": 0,
			"text":          fullText.String(),
		})
		writeSSEEvent(w, flusher, "response.content_part.done", map[string]any{
			"type":          "response.content_part.done",
			"item_id":       textItemID,
			"output_index":  textOutputIndex,
			"content_index": 0,
			"part":          map[string]any{"type": "output_text", "text": fullText.String(), "annotations": []any{}},
		})
		writeSSEEvent(w, flusher, "response.output_item.done", map[string]any{
			"type":         "response.output_item.done",
			"output_index": textOutputIndex,
			"item": map[string]any{
				"id":      textItemID,
				"type":    "message",
				"status":  "completed",
				"role":    "assistant",
				"content": []any{map[string]any{"type": "output_text", "text": fullText.String(), "annotations": []any{}}},
			},
		})
	}

	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "data:") {
			dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if dataStr == "[DONE]" {
				break
			}
			lineBuf.Reset()
			lineBuf.WriteString(dataStr)
			inDataBlock = true
			continue
		}

		if line == "" && inDataBlock {
			inDataBlock = false
			var chunk openAIChunk
			if err := json.Unmarshal([]byte(lineBuf.String()), &chunk); err != nil {
				continue
			}

			if chunk.Usage.PromptTokens > 0 {
				inputTokens = chunk.Usage.PromptTokens
			}
			if chunk.Usage.CompletionTokens > 0 {
				outputTokens = chunk.Usage.CompletionTokens
			}

			if len(chunk.Choices) > 0 {
				delta := chunk.Choices[0].Delta

				// Text content
				if delta.Content != "" {
					ensureTextItemStarted()
					fullText.WriteString(delta.Content)
					writeSSEEvent(w, flusher, "response.output_text.delta", map[string]any{
						"type":          "response.output_text.delta",
						"item_id":       textItemID,
						"output_index":  0,
						"content_index": 0,
						"delta":         delta.Content,
					})
				}

				// Tool calls
				for _, tc := range delta.ToolCalls {
					idx := 0
					if tc.Index != nil {
						idx = *tc.Index
					}
					state, exists := toolStates[idx]
					if !exists {
						state = &toolCallState{}
						toolStates[idx] = state
					}
					if tc.ID != "" {
						state.callID = tc.ID
					}
					if tc.Function.Name != "" {
						state.name = tc.Function.Name
					}
					if tc.Function.Arguments != "" {
						state.arguments += tc.Function.Arguments
					}

					// Emit output_item.added when we have both call_id and name
					if !state.added && state.callID != "" && state.name != "" {
						// Flush any pending text item first
						flushTextItem()
						state.added = true
						state.outputIndex = nextOutputIndex
						nextOutputIndex++
						state.itemID = fmt.Sprintf("fc_%s", generateID())
						writeSSEEvent(w, flusher, "response.output_item.added", map[string]any{
							"type":         "response.output_item.added",
							"output_index": state.outputIndex,
							"item": map[string]any{
								"id":      state.itemID,
								"type":    "function_call",
								"status":  "in_progress",
								"call_id": state.callID,
								"name":    state.name,
							},
						})
						// Emit any arguments accumulated so far
						if state.arguments != "" {
							writeSSEEvent(w, flusher, "response.function_call_arguments.delta", map[string]any{
								"type":         "response.function_call_arguments.delta",
								"item_id":      state.itemID,
								"output_index": state.outputIndex,
								"delta":        state.arguments,
							})
						}
					} else if state.added && tc.Function.Arguments != "" {
						writeSSEEvent(w, flusher, "response.function_call_arguments.delta", map[string]any{
							"type":         "response.function_call_arguments.delta",
							"item_id":      state.itemID,
							"output_index": state.outputIndex,
							"delta":        tc.Function.Arguments,
						})
					}
				}
			}
			continue
		}

		// Non-data lines (comments, empty lines) — skip
	}

	// Finalize: flush text item if still open
	flushTextItem()

	// Finalize: close all tool call items
	for _, idx := range sortedKeys(toolStates) {
		state := toolStates[idx]
		if state.done {
			continue
		}
		state.done = true
		if !state.added {
			// Tool call never got enough info — skip
			continue
		}
		writeSSEEvent(w, flusher, "response.function_call_arguments.done", map[string]any{
			"type":         "response.function_call_arguments.done",
			"item_id":      state.itemID,
			"output_index": state.outputIndex,
			"arguments":    state.arguments,
		})
		writeSSEEvent(w, flusher, "response.output_item.done", map[string]any{
			"type":         "response.output_item.done",
			"output_index": state.outputIndex,
			"item": map[string]any{
				"id":        state.itemID,
				"type":      "function_call",
				"status":    "completed",
				"call_id":   state.callID,
				"name":      state.name,
				"arguments": state.arguments,
			},
		})
	}

	if outputTokens == 0 {
		outputTokens = estimateTokensFromText(fullText.String())
	}

	// Build the final completed response with all output items
	var finalOutput []responsesItem
	if fullText.Len() > 0 {
		finalOutput = append(finalOutput, responsesItem{
			Type:   "message",
			ID:     textItemID,
			Role:   "assistant",
			Status: "completed",
			Content: []responsesContent{
				{Type: "output_text", Text: fullText.String(), Annotations: []any{}},
			},
		})
	}
	for _, idx := range sortedKeys(toolStates) {
		state := toolStates[idx]
		if state.added {
			finalOutput = append(finalOutput, responsesItem{
				Type:      "function_call",
				ID:        state.itemID,
				Status:    "completed",
				CallID:    state.callID,
				Name:      state.name,
				Arguments: state.arguments,
			})
		}
	}
	if len(finalOutput) == 0 {
		finalOutput = []responsesItem{{
			Type: "message", ID: fmt.Sprintf("msg_%s", generateID()),
			Role: "assistant", Status: "completed",
			Content: []responsesContent{{Type: "output_text", Text: "", Annotations: []any{}}},
		}}
	}

	completedResp := responsesResponse{
		ID:     responseID,
		Object: "response",
		Model:  model,
		Output: finalOutput,
		Usage:  responsesUsage{InputTokens: inputTokens, OutputTokens: outputTokens},
	}

	// Emit response.completed event
	writeSSEEvent(w, flusher, "response.completed", map[string]any{
		"type":     "response.completed",
		"response": completedResp,
	})

	duration := time.Since(start)
	usage := tokenUsage{
		Client:       client,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
	}
	s.addHistoryEntryWithUsage(r.Method, r.URL.Path, http.StatusOK, duration, model, "responses (stream)", usage)
}

// forwardResponsesViaAnthropic routes a Codex Responses-API request to an
// anthropic-protocol upstream via /v1/messages, then converts the Anthropic
// response back into Responses-API format for the Codex client.
func (s *Server) forwardResponsesViaAnthropic(w http.ResponseWriter, r *http.Request, target requestTarget, payload responsesRequest, messages []anthropicMsg, system any, start time.Time, client string) {
	s.wg.Add(1)
	defer s.wg.Done()

	model := payload.Model
	if s.isModelCircuitTripped(model) {
		log.Printf("[CircuitBreaker] Model %q is tripped, rejecting new request", model)
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}

	anthReq := buildAnthropicPayload(model, payload, messages, system, false)
	stripUnsignedThinkingBlocks(anthReq.Messages)
	candidates := s.buildCandidateModels(model, target.profile)
	const maxRetries = 5
	var lastErr error
	var lastStatus int
	var lastBody []byte

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if len(candidates) > 1 {
			idx := attempt / 2
			if idx >= len(candidates) {
				idx = len(candidates) - 1
			}
			model = candidates[idx]
			anthReq.Model = model
		}
		accountID := s.pickAccount(&target)
		if !supportsVisionInput(model) {
			sanitizeContentBlocksForNonVision(anthReq.Messages)
		}
		// Anthropic requires max_tokens; supply a safe default if unset.
		if anthReq.MaxTokens <= 0 {
			anthReq.MaxTokens = 8192
		}
		if supportsAnthropicThinkingRequest(model) {
			// Codex's Responses-API reasoning has a different shape than the
			// Anthropic thinking payload; pass nil so boundedThinkingPayload
			// falls back to the provider-configured budget (passthrough when <=0).
			anthReq.Thinking = boundedThinkingPayload(nil, target.thinkingBudget)
		} else {
			anthReq.Thinking = nil
		}

		body, err := json.Marshal(anthReq)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/messages", bytes.NewReader(body), target)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		applyAnthropicAuth(req, target.profile)

		reqStart := time.Now()
		resp, err := s.doUpstream(req, target.timeoutSeconds)
		duration := time.Since(reqStart)

		if err != nil {
			s.recordModelFailure(model)
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			lastErr = err
			lastStatus = proxyErrorStatus(err)
			log.Printf("[Retry] Responses→anthropic model %q failed (attempt %d/%d): %v", model, attempt+1, maxRetries+1, err)
			if attempt < maxRetries {
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, time.Since(start), model, "responses", tokenUsage{Client: client}, err.Error())
			break
		}

		if resp.StatusCode >= 400 {
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			s.recordModelFailure(model)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}
			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) &&
					len(target.accounts) > 1 && attempt < maxRetries {
					continue
				}
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
				return
			}
			log.Printf("[Retry] Responses→anthropic model %q returned %d (attempt %d/%d): %s", model, resp.StatusCode, attempt+1, maxRetries+1, errText)
			if attempt < maxRetries {
				if resp.StatusCode == http.StatusTooManyRequests && len(target.accounts) > 1 {
					continue
				}
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			lastErr = fmt.Errorf("upstream model %s returned status %d after %d retries: %s", model, resp.StatusCode, maxRetries+1, errText)
			lastStatus = resp.StatusCode
			lastBody = respBody
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
			break
		}

		// Success — decode Anthropic response and convert to Responses API format.
		s.recordModelSuccess(model)
		s.noteAccountSuccess(target.name, accountID)
		data, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
		resp.Body.Close()
		responsesResp, usage := anthropicToResponses(data, model)

		_ = duration
		usage.Client = client
		s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses", usage)
		writeJSON(w, http.StatusOK, responsesResp)
		return
	}

	if lastErr != nil {
		if len(lastBody) > 0 {
			writeUpstreamError(w, lastStatus, lastBody)
		} else {
			writeError(w, lastStatus, lastErr)
		}
		return
	}
	writeError(w, http.StatusBadGateway, fmt.Errorf("all %d retry attempts failed", maxRetries+1))
}

// streamResponsesViaAnthropic streams a Codex Responses-API request through an
// anthropic-protocol upstream (/v1/messages SSE), translating Anthropic stream
// events into Responses-API SSE events.
func (s *Server) streamResponsesViaAnthropic(w http.ResponseWriter, r *http.Request, target requestTarget, payload responsesRequest, messages []anthropicMsg, system any, start time.Time, client string) {
	s.wg.Add(1)
	defer s.wg.Done()

	model := payload.Model
	if s.isModelCircuitTripped(model) {
		log.Printf("[CircuitBreaker] Model %q is tripped, rejecting new request", model)
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}

	anthReq := buildAnthropicPayload(model, payload, messages, system, true)
	stripUnsignedThinkingBlocks(anthReq.Messages)
	if !supportsVisionInput(model) {
		sanitizeContentBlocksForNonVision(anthReq.Messages)
	}
	if anthReq.MaxTokens <= 0 {
		anthReq.MaxTokens = 8192
	}
	if supportsAnthropicThinkingRequest(model) {
		anthReq.Thinking = boundedThinkingPayload(nil, target.thinkingBudget)
	} else {
		anthReq.Thinking = nil
	}

	body, err := json.Marshal(anthReq)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	const maxStreamRetries = 5
	var resp *http.Response
	var accountID string
	for attempt := 0; ; attempt++ {
		accountID = s.pickAccount(&target)
		req, reqErr := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/messages", bytes.NewReader(body), target)
		if reqErr != nil {
			writeError(w, http.StatusInternalServerError, reqErr)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		prepareStreamingUpstreamRequest(req)
		applyAnthropicAuth(req, target.profile)

		resp, err = s.doUpstream(req, target.timeoutSeconds)
		if err != nil {
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			if attempt < maxStreamRetries {
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, http.StatusBadGateway, time.Since(start), model, "responses (stream)", tokenUsage{Client: client}, err.Error())
			writeError(w, http.StatusBadGateway, err)
			return
		}
		if resp.StatusCode >= 400 {
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}
			retryable := resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests ||
				((resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && len(target.accounts) > 1)
			if retryable && attempt < maxStreamRetries {
				if len(target.accounts) <= 1 || resp.StatusCode >= 500 {
					time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				}
				continue
			}
			writeUpstreamError(w, resp.StatusCode, respBody)
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses (stream)", tokenUsage{Client: client}, errText)
			return
		}
		s.noteAccountSuccess(target.name, accountID)
		break
	}
	defer resp.Body.Close()
	s.recordModelSuccess(model)

	responseID := fmt.Sprintf("resp_%s", generateID())
	initialResp := responsesResponse{ID: responseID, Object: "response", Model: model}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("streaming not supported"))
		return
	}

	writeSSEEvent(w, flusher, "response.created", map[string]any{
		"type":     "response.created",
		"response": initialResp,
	})

	// Track streaming state
	var fullText strings.Builder
	var inputTokens, outputTokens int
	var textItemAdded bool
	var textItemID string
	var textOutputIndex uint32
	var nextOutputIndex uint32

	// Tool use tracking for Anthropic streaming
	type anthropicToolState struct {
		id          string
		name        string
		inputJSON   strings.Builder
		itemID      string
		outputIndex uint32
		added       bool
		done        bool
	}
	toolStates := make(map[int]*anthropicToolState) // keyed by content_block index
	var currentBlockIndex int
	var currentBlockType string // "text" or "tool_use"

	ensureTextItemStarted := func() {
		if textItemAdded {
			return
		}
		textItemAdded = true
		textItemID = fmt.Sprintf("msg_%s", generateID())
		outputIdx := nextOutputIndex
		textOutputIndex = outputIdx
		nextOutputIndex++
		writeSSEEvent(w, flusher, "response.output_item.added", map[string]any{
			"type":         "response.output_item.added",
			"output_index": outputIdx,
			"item": map[string]any{
				"id": textItemID, "type": "message", "status": "in_progress",
				"role": "assistant", "content": []any{},
			},
		})
		writeSSEEvent(w, flusher, "response.content_part.added", map[string]any{
			"type": "response.content_part.added", "item_id": textItemID,
			"output_index": outputIdx, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
		})
	}

	flushTextItem := func() {
		if !textItemAdded {
			return
		}
		writeSSEEvent(w, flusher, "response.output_text.done", map[string]any{
			"type": "response.output_text.done", "item_id": textItemID,
			"output_index": textOutputIndex, "content_index": 0, "text": fullText.String(),
		})
		writeSSEEvent(w, flusher, "response.content_part.done", map[string]any{
			"type": "response.content_part.done", "item_id": textItemID,
			"output_index": textOutputIndex, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": fullText.String(), "annotations": []any{}},
		})
		writeSSEEvent(w, flusher, "response.output_item.done", map[string]any{
			"type": "response.output_item.done", "output_index": textOutputIndex,
			"item": map[string]any{
				"id": textItemID, "type": "message", "status": "completed", "role": "assistant",
				"content": []any{map[string]any{"type": "output_text", "text": fullText.String(), "annotations": []any{}}},
			},
		})
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	var lineBuf strings.Builder
	var inData bool
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			lineBuf.Reset()
			lineBuf.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			inData = true
			continue
		}
		if line == "" && inData {
			inData = false
			var ev map[string]any
			if json.Unmarshal([]byte(lineBuf.String()), &ev) != nil {
				continue
			}
			switch ev["type"] {
			case "message_start":
				if u, ok := ev["message"].(map[string]any); ok {
					if uu, ok := u["usage"].(map[string]any); ok {
						inputTokens = intFromJSONNumber(uu["input_tokens"])
					}
				}
			case "content_block_start":
				if cb, ok := ev["content_block"].(map[string]any); ok {
					idx := intFromJSONNumber(ev["index"])
					currentBlockIndex = idx
					currentBlockType, _ = cb["type"].(string)
					if currentBlockType == "tool_use" {
						toolID, _ := cb["id"].(string)
						toolName, _ := cb["name"].(string)
						state := &anthropicToolState{
							id:   toolID,
							name: toolName,
						}
						toolStates[idx] = state
					}
				}
			case "content_block_delta":
				if delta, ok := ev["delta"].(map[string]any); ok {
					dt, _ := delta["type"].(string)
					switch dt {
					case "text_delta":
						if t, _ := delta["text"].(string); t != "" {
							ensureTextItemStarted()
							fullText.WriteString(t)
							writeSSEEvent(w, flusher, "response.output_text.delta", map[string]any{
								"type": "response.output_text.delta", "item_id": textItemID,
								"output_index": 0, "content_index": 0, "delta": t,
							})
						}
					case "input_json_delta":
						if partial, _ := delta["partial_json"].(string); partial != "" {
							state, ok := toolStates[currentBlockIndex]
							if ok {
								state.inputJSON.WriteString(partial)
								if !state.added && state.id != "" && state.name != "" {
									flushTextItem()
									state.added = true
									state.outputIndex = nextOutputIndex
									nextOutputIndex++
									state.itemID = fmt.Sprintf("fc_%s", generateID())
									writeSSEEvent(w, flusher, "response.output_item.added", map[string]any{
										"type": "response.output_item.added", "output_index": state.outputIndex,
										"item": map[string]any{
											"id": state.itemID, "type": "function_call", "status": "in_progress",
											"call_id": state.id, "name": state.name,
										},
									})
								}
								if state.added {
									writeSSEEvent(w, flusher, "response.function_call_arguments.delta", map[string]any{
										"type":    "response.function_call_arguments.delta",
										"item_id": state.itemID, "output_index": state.outputIndex,
										"delta": partial,
									})
								}
							}
						}
					}
				}
			case "content_block_stop":
				state, ok := toolStates[currentBlockIndex]
				if ok && state.added && !state.done {
					state.done = true
					writeSSEEvent(w, flusher, "response.function_call_arguments.done", map[string]any{
						"type":    "response.function_call_arguments.done",
						"item_id": state.itemID, "output_index": state.outputIndex,
						"arguments": state.inputJSON.String(),
					})
					writeSSEEvent(w, flusher, "response.output_item.done", map[string]any{
						"type": "response.output_item.done", "output_index": state.outputIndex,
						"item": map[string]any{
							"id": state.itemID, "type": "function_call", "status": "completed",
							"call_id": state.id, "name": state.name,
							"arguments": state.inputJSON.String(),
						},
					})
				}
			case "message_delta":
				if u, ok := ev["usage"].(map[string]any); ok {
					outputTokens = intFromJSONNumber(u["output_tokens"])
				}
			}
			continue
		}
	}

	// Finalize
	flushTextItem()
	for _, idx := range sortedKeys(toolStates) {
		state := toolStates[idx]
		if state.added && !state.done {
			state.done = true
			writeSSEEvent(w, flusher, "response.function_call_arguments.done", map[string]any{
				"type":    "response.function_call_arguments.done",
				"item_id": state.itemID, "output_index": state.outputIndex,
				"arguments": state.inputJSON.String(),
			})
			writeSSEEvent(w, flusher, "response.output_item.done", map[string]any{
				"type": "response.output_item.done", "output_index": state.outputIndex,
				"item": map[string]any{
					"id": state.itemID, "type": "function_call", "status": "completed",
					"call_id": state.id, "name": state.name,
					"arguments": state.inputJSON.String(),
				},
			})
		}
	}

	if outputTokens == 0 {
		outputTokens = estimateTokensFromText(fullText.String())
	}

	// Build final output items
	var finalOutput []responsesItem
	if fullText.Len() > 0 {
		finalOutput = append(finalOutput, responsesItem{
			Type: "message", ID: textItemID, Role: "assistant", Status: "completed",
			Content: []responsesContent{{Type: "output_text", Text: fullText.String(), Annotations: []any{}}},
		})
	}
	for _, idx := range sortedKeys(toolStates) {
		state := toolStates[idx]
		if state.added {
			finalOutput = append(finalOutput, responsesItem{
				Type: "function_call", ID: state.itemID, Status: "completed",
				CallID: state.id, Name: state.name, Arguments: state.inputJSON.String(),
			})
		}
	}
	if len(finalOutput) == 0 {
		finalOutput = []responsesItem{{Type: "message", ID: fmt.Sprintf("msg_%s", generateID()),
			Role: "assistant", Status: "completed",
			Content: []responsesContent{{Type: "output_text", Text: "", Annotations: []any{}}},
		}}
	}

	completedResp := responsesResponse{
		ID: responseID, Object: "response", Model: model,
		Output: finalOutput,
		Usage:  responsesUsage{InputTokens: inputTokens, OutputTokens: outputTokens},
	}
	writeSSEEvent(w, flusher, "response.completed", map[string]any{
		"type":     "response.completed",
		"response": completedResp,
	})

	s.addHistoryEntryWithUsage(r.Method, r.URL.Path, http.StatusOK, time.Since(start), model, "responses (stream)", tokenUsage{
		Client: client, InputTokens: inputTokens, OutputTokens: outputTokens,
	})
}

// forwardResponsesNative passes a Codex Responses-API request straight through
// to an upstream that speaks the Responses API natively (openai-responses
// protocol). No format conversion is needed in either direction.
func (s *Server) forwardResponsesNative(w http.ResponseWriter, r *http.Request, target requestTarget, payload responsesRequest, original []byte, start time.Time, client string) {
	s.wg.Add(1)
	defer s.wg.Done()

	model := payload.Model
	if s.isModelCircuitTripped(model) {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}

	// Override the model in the original body with the resolved value, leaving
	// every other Responses-API field (tools, instructions, include, ...)
	// byte-for-byte intact for a true pass-through.
	raw := map[string]any{}
	if err := json.Unmarshal(original, &raw); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	raw["model"] = model
	body, err := json.Marshal(raw)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	const maxRetries = 5
	var lastErr error
	var lastStatus int
	var lastBody []byte
	candidates := s.buildCandidateModels(model, target.profile)

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if len(candidates) > 1 {
			idx := attempt / 2
			if idx >= len(candidates) {
				idx = len(candidates) - 1
			}
			model = candidates[idx]
			raw["model"] = model
			body, _ = json.Marshal(raw)
		}
		accountID := s.pickAccount(&target)
		req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/responses", bytes.NewReader(body), target)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		applyAnthropicAuth(req, target.profile)

		reqStart := time.Now()
		resp, err := s.doUpstream(req, target.timeoutSeconds)
		duration := time.Since(reqStart)

		if err != nil {
			s.recordModelFailure(model)
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			lastErr = err
			lastStatus = proxyErrorStatus(err)
			if attempt < maxRetries {
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, time.Since(start), model, "responses", tokenUsage{Client: client}, err.Error())
			break
		}

		if resp.StatusCode >= 400 {
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			s.recordModelFailure(model)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}
			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) &&
					len(target.accounts) > 1 && attempt < maxRetries {
					continue
				}
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
				return
			}
			if attempt < maxRetries {
				if resp.StatusCode == http.StatusTooManyRequests && len(target.accounts) > 1 {
					continue
				}
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			lastErr = fmt.Errorf("upstream model %s returned status %d after %d retries: %s", model, resp.StatusCode, maxRetries+1, errText)
			lastStatus = resp.StatusCode
			lastBody = respBody
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
			break
		}

		// Success — pass the upstream Responses body straight through.
		s.recordModelSuccess(model)
		s.noteAccountSuccess(target.name, accountID)
		copyHeaders(w.Header(), resp.Header)
		stripHopByHopHeaders(w.Header())
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, MaxBodySize))
		resp.Body.Close()
		s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "responses", tokenUsage{Client: client})
		return
	}

	if lastErr != nil {
		if len(lastBody) > 0 {
			writeUpstreamError(w, lastStatus, lastBody)
		} else {
			writeError(w, lastStatus, lastErr)
		}
		return
	}
	writeError(w, http.StatusBadGateway, fmt.Errorf("all %d retry attempts failed", maxRetries+1))
}

// streamResponsesNative passes a streaming Codex Responses-API request straight
// through to an upstream that speaks the Responses API natively.
func (s *Server) streamResponsesNative(w http.ResponseWriter, r *http.Request, target requestTarget, payload responsesRequest, original []byte, start time.Time, client string) {
	s.wg.Add(1)
	defer s.wg.Done()

	model := payload.Model
	if s.isModelCircuitTripped(model) {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}

	raw := map[string]any{}
	if err := json.Unmarshal(original, &raw); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	raw["model"] = model
	body, err := json.Marshal(raw)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	const maxStreamRetries = 5
	var resp *http.Response
	var accountID string
	for attempt := 0; ; attempt++ {
		accountID = s.pickAccount(&target)
		req, reqErr := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/responses", bytes.NewReader(body), target)
		if reqErr != nil {
			writeError(w, http.StatusInternalServerError, reqErr)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		prepareStreamingUpstreamRequest(req)
		applyAnthropicAuth(req, target.profile)

		resp, err = s.doUpstream(req, target.timeoutSeconds)
		if err != nil {
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			if attempt < maxStreamRetries {
				time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, http.StatusBadGateway, time.Since(start), model, "responses (stream)", tokenUsage{Client: client}, err.Error())
			writeError(w, http.StatusBadGateway, err)
			return
		}
		if resp.StatusCode >= 400 {
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}
			retryable := resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests ||
				((resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && len(target.accounts) > 1)
			if retryable && attempt < maxStreamRetries {
				if len(target.accounts) <= 1 || resp.StatusCode >= 500 {
					time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
				}
				continue
			}
			writeUpstreamError(w, resp.StatusCode, respBody)
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses (stream)", tokenUsage{Client: client}, errText)
			return
		}
		s.noteAccountSuccess(target.name, accountID)
		break
	}
	defer resp.Body.Close()
	s.recordModelSuccess(model)

	// Pure pass-through: relay upstream SSE verbatim to the Codex client.
	copyHeaders(w.Header(), resp.Header)
	stripHopByHopHeaders(w.Header())
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		_, _ = fmt.Fprintln(w, line)
		if flusher != nil {
			flusher.Flush()
		}
	}
	s.addHistoryEntryWithUsage(r.Method, r.URL.Path, http.StatusOK, time.Since(start), model, "responses (stream)", tokenUsage{Client: client})
}

// buildAnthropicPayload constructs an anthropicRequest from a Codex Responses
// payload, shared by the anthropic-protocol forward and stream paths.
func buildAnthropicPayload(model string, payload responsesRequest, messages []anthropicMsg, system any, stream bool) anthropicRequest {
	anthReq := anthropicRequest{
		Model:    model,
		Messages: messages,
		System:   system,
		Stream:   stream,
	}
	if payload.Temperature != nil {
		anthReq.Temperature = payload.Temperature
	}
	if payload.MaxOutputTokens > 0 {
		anthReq.MaxTokens = payload.MaxOutputTokens
	}
	if len(payload.Tools) > 0 {
		for _, t := range payload.Tools {
			anthReq.Tools = append(anthReq.Tools, anthropicTool{
				Type:        "function",
				Name:        t.Name,
				Description: t.Description,
				InputSchema: t.Parameters,
			})
		}
	}
	// Map Responses tool_choice into Anthropic's intermediate shape. The chat
	// path re-translates this to OpenAI via convertToolChoice; the anthropic
	// path uses it directly. Fold an explicit parallel_tool_calls:false into
	// Anthropic's disable_parallel_tool_use so it survives on that path too.
	if tc := responsesToolChoiceToAnthropic(payload.ToolChoice); tc != nil {
		if payload.ParallelToolCalls != nil && !*payload.ParallelToolCalls {
			tc["disable_parallel_tool_use"] = true
		}
		anthReq.ToolChoice = tc
	} else if payload.ParallelToolCalls != nil && !*payload.ParallelToolCalls && len(anthReq.Tools) > 0 {
		anthReq.ToolChoice = map[string]any{"type": "auto", "disable_parallel_tool_use": true}
	}
	return anthReq
}

// responsesToolChoiceToAnthropic converts an OpenAI/Responses tool_choice into
// the Anthropic-style shape understood by convertToolChoice. It accepts:
//   - "auto"     -> {"type":"auto"}
//   - "none"     -> {"type":"none"}  (no tool call this turn)
//   - "required" -> {"type":"any"}   (must call some tool)
//   - {"type":"function","name":X} or {"type":"function","function":{"name":X}}
//     -> {"type":"tool","name":X}
//
// It returns nil when the choice is absent or unrecognized, leaving the
// upstream default in effect.
func responsesToolChoiceToAnthropic(choice any) map[string]any {
	switch v := choice.(type) {
	case string:
		switch v {
		case "auto":
			return map[string]any{"type": "auto"}
		case "none":
			return map[string]any{"type": "none"}
		case "required":
			return map[string]any{"type": "any"}
		}
	case map[string]any:
		if v["type"] == "function" {
			name, _ := v["name"].(string)
			if name == "" {
				if fn, ok := v["function"].(map[string]any); ok {
					name, _ = fn["name"].(string)
				}
			}
			if name != "" {
				return map[string]any{"type": "tool", "name": name}
			}
		}
	}
	return nil
}

// anthropicToResponses converts an Anthropic /v1/messages JSON response into a
// Responses-API response object plus a tokenUsage record.
func anthropicToResponses(data []byte, model string) (responsesResponse, tokenUsage) {
	var ar struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
		Usage struct {
			InputTokens              int `json:"input_tokens"`
			OutputTokens             int `json:"output_tokens"`
			CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int `json:"cache_read_input_tokens"`
		} `json:"usage"`
	}
	_ = json.Unmarshal(data, &ar)

	var text string
	var toolCallItems []responsesItem
	for _, block := range ar.Content {
		switch block.Type {
		case "text":
			if text == "" {
				text = block.Text
			} else {
				text += "\n" + block.Text
			}
		case "tool_use":
			toolCallItems = append(toolCallItems, responsesItem{
				Type:      "function_call",
				ID:        fmt.Sprintf("fc_%s", generateID()),
				Status:    "completed",
				CallID:    block.ID,
				Name:      block.Name,
				Arguments: string(block.Input),
			})
		}
	}

	var outputItems []responsesItem
	if text != "" || len(toolCallItems) == 0 {
		outputItems = append(outputItems, responsesItem{
			Type:   "message",
			ID:     fmt.Sprintf("msg_%s", generateID()),
			Role:   "assistant",
			Status: "completed",
			Content: []responsesContent{
				{Type: "output_text", Text: text, Annotations: []any{}},
			},
		})
	}
	outputItems = append(outputItems, toolCallItems...)

	resp := responsesResponse{
		ID:     fmt.Sprintf("resp_%s", generateID()),
		Object: "response",
		Model:  model,
		Output: outputItems,
		Usage: responsesUsage{
			InputTokens:  ar.Usage.InputTokens,
			OutputTokens: ar.Usage.OutputTokens,
		},
	}
	usage := tokenUsage{
		InputTokens:         ar.Usage.InputTokens,
		OutputTokens:        ar.Usage.OutputTokens,
		CacheCreationTokens: ar.Usage.CacheCreationInputTokens,
		CacheReadTokens:     ar.Usage.CacheReadInputTokens,
	}
	return resp, usage
}

// writeSSEEvent writes a single SSE event to the response writer.
func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, eventName string, data any) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("[SSE] Failed to marshal event %q: %v", eventName, err)
		return
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventName, jsonData)
	flusher.Flush()
}

// sortedKeys returns the integer keys of a map in ascending order. Tool-call
// state is keyed by the upstream index (arrival order); iterating a Go map is
// nondeterministic, so callers use this to emit output items in a stable,
// arrival-ordered sequence across requests.
func sortedKeys[V any](m map[int]V) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}

// generateID generates a random hex ID for Responses API.
func generateID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// estimateTokensFromText gives a rough token count estimate for a text string.
func estimateTokensFromText(text string) int {
	// Rough heuristic: ~4 characters per token for English text
	return (len(text) + 3) / 4
}
