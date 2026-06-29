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

	for attempt := 0; attempt <= maxRetries; attempt++ {
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
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)
			s.recordModelFailure(model)

			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, time.Since(start), model, "responses", tokenUsage{Client: client}, errText)
				return
			}

			log.Printf("[Retry] Responses model %q returned %d (attempt %d/%d): %s", model, resp.StatusCode, attempt+1, maxRetries+1, errText)
			if attempt < maxRetries {
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
	req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(body), target)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	prepareStreamingUpstreamRequest(req)
	applyAnthropicAuth(req, target.profile)

	resp, err := s.doUpstream(req, target.timeoutSeconds)
	if err != nil {
		duration := time.Since(start)
		s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, http.StatusBadGateway, duration, model, "responses (stream)", tokenUsage{Client: client}, err.Error())
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		duration := time.Since(start)
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
		errText := upstreamErrorSummary(resp.StatusCode, respBody)
		writeUpstreamError(w, resp.StatusCode, respBody)
		s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "responses (stream)", tokenUsage{Client: client}, errText)
		return
	}

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
						"type":  "response.output_text.delta",
						"delta": delta.Content,
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
