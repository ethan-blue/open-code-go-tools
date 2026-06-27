package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
)

func (s *Server) countTokens(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(io.LimitReader(r.Body, MaxBodySize+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if int64(len(data)) > MaxBodySize {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Errorf("request body too large (max %d bytes)", MaxBodySize))
		return
	}
	var payload anthropicRequest
	if err := json.Unmarshal(data, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	profile, _, err := s.profileFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(payload.Model) == "" {
		writeError(w, http.StatusBadRequest, errors.New("model is required"))
		return
	}
	payload.Model = profile.ResolveModel(payload.Model)
	if isClaudeDesktopRoute(r) {
		writeJSON(w, http.StatusOK, map[string]int{"input_tokens": estimateTokens(payload)})
		return
	}
	if profile.UsesMessagesEndpoint(payload.Model) {
		var raw map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		raw["model"] = payload.Model
		body, err := json.Marshal(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/messages/count_tokens", bytes.NewReader(body), profile)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		applyAnthropicAuth(req, profile)
		resp, err := s.clientSnapshot().Do(req)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]int{"input_tokens": estimateTokens(payload)})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			writeJSON(w, http.StatusOK, map[string]int{"input_tokens": estimateTokens(payload)})
			return
		}
		copyHeaders(w.Header(), resp.Header)
		stripHopByHopHeaders(w.Header())
		w.WriteHeader(resp.StatusCode)
		_, _ = copyResponse(w, resp.Body)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"input_tokens": estimateTokens(payload)})
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
		return
	}
	profile, _, err := s.profileFromRequest(r)
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
	var payload anthropicRequest
	if err := json.Unmarshal(data, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// Validate required fields before forwarding
	if strings.TrimSpace(payload.Model) == "" {
		writeError(w, http.StatusBadRequest, errors.New("model is required"))
		return
	}
	if len(payload.Messages) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("messages must contain at least one message"))
		return
	}
	if payload.MaxTokens < 0 {
		writeError(w, http.StatusBadRequest, errors.New("max_tokens must be a non-negative integer"))
		return
	}
	payload.Model = profile.ResolveModel(payload.Model)
	if profile.UsesMessagesEndpoint(payload.Model) {
		s.forwardAnthropicMessages(w, r, profile, payload, data)
		return
	}
	s.forwardChatCompletions(w, r, profile, payload)
}

func (s *Server) forwardAnthropicMessages(w http.ResponseWriter, r *http.Request, profile config.Profile, payload anthropicRequest, original []byte) {
	// Track in-flight streaming requests for graceful shutdown.
	s.wg.Add(1)
	defer s.wg.Done()

	client := clientSourceFromRequest(r)
	model := payload.Model
	const maxRetries = 5

	var lastErr error
	var lastStatus int
	var lastBody []byte

	// Check circuit breaker before starting retry loop
	if s.isModelCircuitTripped(model) {
		log.Printf("[CircuitBreaker] Model %q is tripped, rejecting new request", model)
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("model %q is temporarily unavailable (circuit breaker)", model))
		return
	}
	for attempt := 0; attempt <= maxRetries; attempt++ {
		var raw map[string]any
		if err := json.Unmarshal(original, &raw); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		raw["model"] = model

		// Sanitize image content for non-vision models
		if !supportsVisionInput(model) {
			if msgs, ok := raw["messages"].([]interface{}); ok {
				data, _ := json.Marshal(msgs)
				var anthropicMsgs []anthropicMsg
				json.Unmarshal(data, &anthropicMsgs)
				if sanitizeContentBlocksForNonVision(anthropicMsgs) {
					raw["messages"] = anthropicMsgs
				}
			}
		}

		if thinking, ok := raw["thinking"]; ok {
			if !supportsAnthropicThinkingRequest(model) {
				delete(raw, "thinking")
			} else {
				bounded := boundedThinkingPayload(thinking, s.thinkingBudgetTokens())
				if bounded == nil {
					delete(raw, "thinking")
				} else {
					raw["thinking"] = bounded
				}
			}
		}
		body, err := json.Marshal(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/messages", bytes.NewReader(body), profile)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if payload.Stream {
			prepareStreamingUpstreamRequest(req)
		}
		applyAnthropicAuth(req, profile)
		for _, key := range []string{"Anthropic-Beta"} {
			if val := r.Header.Get(key); val != "" {
				req.Header.Set(key, val)
			}
		}

		start := time.Now()
		resp, err := s.clientSnapshot().Do(req)
		duration := time.Since(start)

		if err != nil {
			s.recordModelFailure(model)
			lastErr = err
			lastStatus = proxyErrorStatus(err)
			log.Printf("[Retry] Request to model %q failed (attempt %d/%d): %v", model, attempt+1, maxRetries+1, err)

			if attempt < maxRetries {
				backoff := time.Duration(500*(1<<attempt)) * time.Millisecond
				log.Printf("[Retry] Backoff %v then retry %d/%d for model %s", backoff, attempt+2, maxRetries+1, model)
				time.Sleep(backoff)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, duration, model, "messages", tokenUsage{Client: client}, err.Error())
			break
		}

		log.Printf("upstream route=messages model=%s status=%d", model, resp.StatusCode)

		if resp.StatusCode >= 400 {
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)

			s.recordModelFailure(model)

			// Client error (except 429) → return immediately, no retry
			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "messages", tokenUsage{Client: client}, errText)
				return
			}

			// 5xx or 429 → log and retry
			log.Printf("[Retry] Model %q returned %d (attempt %d/%d): %s", model, resp.StatusCode, attempt+1, maxRetries+1, errText)

			if attempt < maxRetries {
				backoff := time.Duration(500*(1<<attempt)) * time.Millisecond
				log.Printf("[Retry] Backoff %v then retry %d/%d for model %s", backoff, attempt+2, maxRetries+1, model)
				time.Sleep(backoff)
				continue
			}

			// All retries exhausted
			lastErr = fmt.Errorf("upstream model %s returned status %d after %d retries: %s", model, resp.StatusCode, maxRetries+1, errText)
			lastStatus = resp.StatusCode
			lastBody = respBody
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, duration, model, "messages", tokenUsage{Client: client}, errText)
			break
		}

		// Success!
		s.recordModelSuccess(model)
		copyHeaders(w.Header(), resp.Header)
		stripHopByHopHeaders(w.Header())
		w.WriteHeader(resp.StatusCode)

		if payload.Stream {
			usage := extractUsageFromAnthropicStream(w, resp.Body)
			resp.Body.Close()
			s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "messages", tokenUsage{
				InputTokens:         usage.InputTokens,
				OutputTokens:        usage.OutputTokens,
				CacheCreationTokens: usage.CacheCreationTokens,
				CacheReadTokens:     usage.CacheReadTokens,
				Client:              client,
			})
		} else {
			data, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			var anthropicResp struct {
				Usage struct {
					InputTokens              int `json:"input_tokens"`
					OutputTokens             int `json:"output_tokens"`
					CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
					CacheReadInputTokens     int `json:"cache_read_input_tokens"`
				} `json:"usage"`
			}
			if json.Unmarshal(data, &anthropicResp) == nil {
				s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "messages", tokenUsage{
					InputTokens:         anthropicResp.Usage.InputTokens,
					OutputTokens:        anthropicResp.Usage.OutputTokens,
					CacheCreationTokens: anthropicResp.Usage.CacheCreationInputTokens,
					CacheReadTokens:     anthropicResp.Usage.CacheReadInputTokens,
					Client:              client,
				})
			} else {
				s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "messages", tokenUsage{Client: client})
			}
			_, _ = w.Write(data)
		}
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

// extractUsageFromAnthropicStream tees the upstream SSE response body,
// streams it to the client, and simultaneously parses usage statistics from
// message_start (input_tokens, cache fields) and message_delta (output_tokens).
func extractUsageFromAnthropicStream(w http.ResponseWriter, body io.Reader) tokenUsage {
	var (
		usage              tokenUsage
		lineBuf            strings.Builder
		capturing, inEvent bool
	)
	flusher, _ := w.(http.Flusher)

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		_, _ = w.Write([]byte(line + "\n"))
		if flusher != nil {
			flusher.Flush()
		}

		if inEvent {
			if strings.HasPrefix(line, "data:") {
				lineBuf.WriteString(strings.TrimPrefix(line, "data:"))
			} else if line == "" {
				if capturing {
					var payload map[string]any
					if json.Unmarshal([]byte(lineBuf.String()), &payload) == nil {
						// message_start: usage 在 message.usage 中（input_tokens / cache_*）
						if t, _ := payload["type"].(string); t == "message_start" {
							if msg, ok := payload["message"].(map[string]any); ok {
								if u, ok := msg["usage"].(map[string]any); ok {
									if v, ok := u["input_tokens"].(float64); ok {
										usage.InputTokens = int(v)
									}
									if v, ok := u["cache_creation_input_tokens"].(float64); ok {
										usage.CacheCreationTokens = int(v)
									}
									if v, ok := u["cache_read_input_tokens"].(float64); ok {
										usage.CacheReadTokens = int(v)
									}
								}
							}
						}
						// message_delta: usage 在顶层（output_tokens / 可能含 input_tokens）
						if u, ok := payload["usage"].(map[string]any); ok {
							if v, ok := u["input_tokens"].(float64); ok {
								usage.InputTokens = int(v)
							}
							if v, ok := u["output_tokens"].(float64); ok {
								usage.OutputTokens = int(v)
							}
						}
					}
					capturing = false
				}
				inEvent = false
				lineBuf.Reset()
			}
			continue
		}

		if strings.HasPrefix(line, "event: message_start") || strings.HasPrefix(line, "event: message_delta") {
			inEvent = true
			capturing = true
		}
	}
	return usage
}

func (s *Server) attachReasoningContent(messages []openAIMessage) {
	s.reasoningMu.Lock()
	defer s.reasoningMu.Unlock()
	for i := range messages {
		if messages[i].Role != "assistant" || messages[i].ReasoningContent != "" {
			continue
		}
		for _, call := range messages[i].ToolCalls {
			if reasoning := s.reasoningByTool[call.ID]; reasoning != "" {
				messages[i].ReasoningContent = reasoning
				break
			}
		}
	}
}

func (s *Server) cacheReasoningContent(resp openAIResponse) {
	s.reasoningMu.Lock()
	defer s.reasoningMu.Unlock()
	for _, choice := range resp.Choices {
		reasoning := reasoningText(choice.Message.ReasoningContent, choice.Message.ThinkingContent, choice.Message.Thinking, choice.Message.Reasoning, choice.Message.ReasoningDetails)
		if reasoning == "" {
			continue
		}
		for _, call := range choice.Message.ToolCalls {
			if call.ID != "" {
				s.setReasoning(call.ID, reasoning)
			}
		}
	}
}

func (s *Server) setReasoning(id, reasoning string) {
	if _, exists := s.reasoningByTool[id]; !exists {
		s.reasoningOrder = append(s.reasoningOrder, id)
	} else {
		// Move existing ID to the end (most recently used)
		for i, existingID := range s.reasoningOrder {
			if existingID == id {
				s.reasoningOrder = append(s.reasoningOrder[:i], s.reasoningOrder[i+1:]...)
				s.reasoningOrder = append(s.reasoningOrder, id)
				break
			}
		}
	}
	s.reasoningByTool[id] = reasoning
	for len(s.reasoningByTool) > maxReasoningEntries {
		oldest := s.reasoningOrder[0]
		s.reasoningOrder = s.reasoningOrder[1:]
		delete(s.reasoningByTool, oldest)
	}
}

func (s *Server) setReasoningLocked(id, reasoning string) {
	s.reasoningMu.Lock()
	defer s.reasoningMu.Unlock()
	s.setReasoning(id, reasoning)
}

func (s *Server) getReasoningLocked(id string) string {
	s.reasoningMu.Lock()
	defer s.reasoningMu.Unlock()
	return s.reasoningByTool[id]
}

func hasToolHistory(messages []openAIMessage) bool {
	for _, msg := range messages {
		if len(msg.ToolCalls) > 0 {
			return true
		}
	}
	return false
}
