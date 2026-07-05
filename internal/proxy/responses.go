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

	// Convert Responses API input to Anthropic messages format
	var messages []anthropicMsg
	switch v := payload.Input.(type) {
	case string:
		messages = append(messages, anthropicMsg{Role: "user", Content: v})
	case []any:
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				role, _ := m["role"].(string)
				// Handle both simple string content and structured content blocks
				if content, ok := m["content"].(string); ok && role != "" {
					messages = append(messages, anthropicMsg{Role: role, Content: content})
				} else if contentArr, ok := m["content"].([]any); ok && role != "" {
					// Flatten content blocks into a single text string
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

	// Build anthropicRequest for forwarding
	anthReq := anthropicRequest{
		Model:    model,
		Messages: messages,
		System:   system,
		Stream:   false,
	}
	if payload.Temperature != nil {
		anthReq.Temperature = payload.Temperature
	}
	if payload.MaxOutputTokens > 0 {
		anthReq.MaxTokens = payload.MaxOutputTokens
	}

	// Convert Responses API tools to Anthropic tools format
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
		text := ""
		if len(out.Choices) > 0 {
			text = out.Choices[0].Message.Content
		}

		responsesResp := responsesResponse{
			ID:     fmt.Sprintf("resp_%s", generateID()),
			Object: "response",
			Model:  model,
			Output: []responsesItem{
				{
					Type: "message",
					Role: "assistant",
					Content: []responsesContent{
						{
							Type: "output_text",
							Text: text,
						},
					},
				},
			},
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
	anthReq := anthropicRequest{
		Model:    model,
		Messages: messages,
		System:   system,
		Stream:   true,
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

	// Sanitize image content for non-vision models
	if !supportsVisionInput(model) {
		sanitizeContentBlocksForNonVision(anthReq.Messages)
	}

	chatReq := anthropicToOpenAI(anthReq)
	chatReq.Model = model

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
	itemID := fmt.Sprintf("msg_%s", generateID())
	emitResponsesTextStart(w, flusher, itemID)

	// Parse upstream OpenAI SSE and convert to Responses API format
	var fullText strings.Builder
	var inputTokens, outputTokens int

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	var lineBuf strings.Builder
	var inDataBlock bool

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
			// Process accumulated data line
			inDataBlock = false
			var chunk openAIChunk
			if err := json.Unmarshal([]byte(lineBuf.String()), &chunk); err != nil {
				continue
			}

			// Extract usage from the final chunk if present
			if chunk.Usage.PromptTokens > 0 {
				inputTokens = chunk.Usage.PromptTokens
			}
			if chunk.Usage.CompletionTokens > 0 {
				outputTokens = chunk.Usage.CompletionTokens
			}

			if len(chunk.Choices) > 0 {
				delta := chunk.Choices[0].Delta

				// Stream text content as response.output_text.delta
				if delta.Content != "" {
					fullText.WriteString(delta.Content)
					writeSSEEvent(w, flusher, "response.output_text.delta", map[string]any{
						"type":          "response.output_text.delta",
						"item_id":       itemID,
						"output_index":  0,
						"content_index": 0,
						"delta":         delta.Content,
					})
				}
			}
			continue
		}

		// Non-data lines (comments, empty lines) — skip
	}

	// If we didn't get usage from the stream, estimate output tokens from text
	if outputTokens == 0 {
		outputTokens = estimateTokensFromText(fullText.String())
	}

	// Build the final completed response
	completedResp := responsesResponse{
		ID:     responseID,
		Object: "response",
		Model:  model,
		Output: []responsesItem{
			{
				Type: "message",
				Role: "assistant",
				Content: []responsesContent{
					{
						Type: "output_text",
						Text: fullText.String(),
					},
				},
			},
		},
		Usage: responsesUsage{
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
		},
	}

	emitResponsesTextDone(w, flusher, itemID, fullText.String())

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
	itemID := fmt.Sprintf("msg_%s", generateID())
	emitResponsesTextStart(w, flusher, itemID)

	// Parse upstream Anthropic SSE and translate to Responses-API events.
	var fullText strings.Builder
	var inputTokens, outputTokens int
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
			case "content_block_delta":
				if delta, ok := ev["delta"].(map[string]any); ok {
					if dt, _ := delta["type"].(string); dt == "text_delta" {
						if t, _ := delta["text"].(string); t != "" {
							fullText.WriteString(t)
							writeSSEEvent(w, flusher, "response.output_text.delta", map[string]any{
								"type":          "response.output_text.delta",
								"item_id":       itemID,
								"output_index":  0,
								"content_index": 0,
								"delta":         t,
							})
						}
					}
				}
			case "message_delta":
				if u, ok := ev["usage"].(map[string]any); ok {
					outputTokens = intFromJSONNumber(u["output_tokens"])
				}
			}
			continue
		}
	}

	if outputTokens == 0 {
		outputTokens = estimateTokensFromText(fullText.String())
	}

	completedResp := responsesResponse{
		ID:     responseID,
		Object: "response",
		Model:  model,
		Output: []responsesItem{{Type: "message", Role: "assistant", Content: []responsesContent{{Type: "output_text", Text: fullText.String()}}}},
		Usage:  responsesUsage{InputTokens: inputTokens, OutputTokens: outputTokens},
	}
	emitResponsesTextDone(w, flusher, itemID, fullText.String())
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
	return anthReq
}

// anthropicToResponses converts an Anthropic /v1/messages JSON response into a
// Responses-API response object plus a tokenUsage record.
func anthropicToResponses(data []byte, model string) (responsesResponse, tokenUsage) {
	var ar struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
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
	for _, block := range ar.Content {
		if block.Type == "text" && block.Type != "" {
			if text == "" {
				text = block.Text
			} else {
				text += "\n" + block.Text
			}
		}
	}
	resp := responsesResponse{
		ID:     fmt.Sprintf("resp_%s", generateID()),
		Object: "response",
		Model:  model,
		Output: []responsesItem{{
			Type:    "message",
			Role:    "assistant",
			Content: []responsesContent{{Type: "output_text", Text: text}},
		}},
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

func emitResponsesTextStart(w http.ResponseWriter, flusher http.Flusher, itemID string) {
	item := map[string]any{"id": itemID, "type": "message", "status": "in_progress", "role": "assistant", "content": []any{}}
	writeSSEEvent(w, flusher, "response.output_item.added", map[string]any{
		"type":         "response.output_item.added",
		"output_index": 0,
		"item":         item,
	})
	writeSSEEvent(w, flusher, "response.content_part.added", map[string]any{
		"type":          "response.content_part.added",
		"item_id":       itemID,
		"output_index":  0,
		"content_index": 0,
		"part":          map[string]any{"type": "output_text", "text": "", "annotations": []any{}},
	})
}

func emitResponsesTextDone(w http.ResponseWriter, flusher http.Flusher, itemID, text string) {
	part := map[string]any{"type": "output_text", "text": text, "annotations": []any{}}
	item := map[string]any{"id": itemID, "type": "message", "status": "completed", "role": "assistant", "content": []any{part}}
	writeSSEEvent(w, flusher, "response.output_text.done", map[string]any{
		"type":          "response.output_text.done",
		"item_id":       itemID,
		"output_index":  0,
		"content_index": 0,
		"text":          text,
	})
	writeSSEEvent(w, flusher, "response.content_part.done", map[string]any{
		"type":          "response.content_part.done",
		"item_id":       itemID,
		"output_index":  0,
		"content_index": 0,
		"part":          part,
	})
	writeSSEEvent(w, flusher, "response.output_item.done", map[string]any{
		"type":         "response.output_item.done",
		"output_index": 0,
		"item":         item,
	})
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
