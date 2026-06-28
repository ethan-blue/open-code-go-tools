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

func (s *Server) forwardChatCompletions(w http.ResponseWriter, r *http.Request, profile config.Profile, payload anthropicRequest) {
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
		// Sanitize image content for non-vision models
		if !supportsVisionInput(model) {
			sanitizeContentBlocksForNonVision(payload.Messages)
		}

		chatReq := anthropicToOpenAI(payload)
		chatReq.Model = model
		chatReq.Thinking, chatReq.ReasoningEffort = chatCompletionThinkingControls(model, payload.Thinking, s.thinkingBudgetTokens())
		if supportsReasoningContentReplay(model) {
			s.attachReasoningContent(chatReq.Messages)
		}
		body, err := json.Marshal(chatReq)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(body), profile)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if payload.Stream {
			prepareStreamingUpstreamRequest(req)
		}
		// Apply the profile's configured upstream auth scheme. For the default
		// "bearer" mode (opencode.ai/zen/go and other OpenAI-compatible gateways)
		// this is a no-op on Authorization; for "x-api-key"/"both" it adds/sets the
		// Anthropic-native headers. See applyAnthropicAuth.
		applyAnthropicAuth(req, profile)

		start := time.Now()
		resp, err := s.clientSnapshot().Do(req)
		duration := time.Since(start)

		if err != nil {
			s.recordModelFailure(model)
			lastErr = err
			lastStatus = proxyErrorStatus(err)
			log.Printf("[Retry] Request to model %q failed (attempt %d/%d): %v", model, attempt+1, maxRetries+1, err)

			if attempt < maxRetries {
				backoff := s.retryBackoffBase * time.Duration(1<<attempt)
				log.Printf("[Retry] Backoff %v then retry %d/%d for model %s", backoff, attempt+2, maxRetries+1, model)
				time.Sleep(backoff)
				continue
			}
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, duration, model, "chat/completions", tokenUsage{Client: client}, err.Error())
			break
		}

		log.Printf("upstream route=chat/completions model=%s status=%d", model, resp.StatusCode)

		if resp.StatusCode >= 400 {
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)

			s.recordModelFailure(model)

			// Client error (except 429) → return immediately, no retry
			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions", tokenUsage{Client: client}, errText)
				return
			}

			// 5xx or 429 → log and retry
			log.Printf("[Retry] Model %q returned %d (attempt %d/%d): %s", model, resp.StatusCode, attempt+1, maxRetries+1, errText)

			if attempt < maxRetries {
				backoff := s.retryBackoffBase * time.Duration(1<<attempt)
				log.Printf("[Retry] Backoff %v then retry %d/%d for model %s", backoff, attempt+2, maxRetries+1, model)
				time.Sleep(backoff)
				continue
			}

			// All retries exhausted
			lastErr = fmt.Errorf("upstream model %s returned status %d after %d retries: %s", model, resp.StatusCode, maxRetries+1, errText)
			lastStatus = resp.StatusCode
			lastBody = respBody
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, lastStatus, duration, model, "chat/completions", tokenUsage{Client: client}, errText)
			break
		}

		// Success!
		s.recordModelSuccess(model)
		if payload.Stream {
			outputTokens, inputTokens, cacheReadTokens, cacheCreateTokens := streamOpenAIAsAnthropic(w, resp.Body, model, estimateTokens(payload), s.setReasoningLocked)
			resp.Body.Close()
			s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions (stream)", tokenUsage{
				InputTokens:         inputTokens,
				OutputTokens:        outputTokens,
				CacheReadTokens:     cacheReadTokens,
				CacheCreationTokens: cacheCreateTokens,
				Client:              client,
			})
			return
		}

		var out openAIResponse
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			resp.Body.Close()
			writeError(w, http.StatusBadGateway, err)
			s.addHistoryEntryWithUsage(r.Method, r.URL.Path, http.StatusBadGateway, duration, model, "chat/completions", tokenUsage{Client: client})
			return
		}
		resp.Body.Close()
		s.cacheReasoningContent(out)
		message := openAIToAnthropic(out, model, estimateTokens(payload))
		writeJSON(w, http.StatusOK, message)
		usage := usageFromOpenAI(out.Usage, estimateTokens(payload))
		usage.Client = client
		s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions", usage)
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

// chatCompletions handles OpenAI-compatible /v1/chat/completions requests (for Codex).
// pipeOpenAIStream tees the upstream OpenAI SSE response, streams it to the
// client, and parses usage from chunks that contain a usage field.
func pipeOpenAIStream(w http.ResponseWriter, body io.Reader) tokenUsage {
	var usage tokenUsage
	flusher, _ := w.(http.Flusher)

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		// Write line to client
		_, _ = fmt.Fprintln(w, line)
		if flusher != nil {
			flusher.Flush()
		}

		// Parse usage from data lines
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "data: ") {
			payload := strings.TrimPrefix(trimmed, "data: ")
			if payload == "[DONE]" {
				continue
			}
			var chunk openAIChunk
			if json.Unmarshal([]byte(payload), &chunk) == nil {
				if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 {
					usage.InputTokens = chunk.Usage.PromptTokens
					usage.OutputTokens = chunk.Usage.CompletionTokens
					if chunk.Usage.PromptTokensDetails != nil {
						usage.CacheReadTokens = chunk.Usage.PromptTokensDetails.CachedTokens
					}
					if chunk.Usage.CacheReadInputTokens > 0 {
						usage.CacheReadTokens = chunk.Usage.CacheReadInputTokens
					}
					if chunk.Usage.CacheCreationInputTokens > 0 {
						usage.CacheCreationTokens = chunk.Usage.CacheCreationInputTokens
					}
				}
			}
		}
	}
	return usage
}

func (s *Server) chatCompletions(w http.ResponseWriter, r *http.Request) {
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
	var payload openAIRequest
	if err := json.Unmarshal(data, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(payload.Model) == "" {
		writeError(w, http.StatusBadRequest, errors.New("model is required"))
		return
	}
	if len(payload.Messages) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("messages must contain at least one message"))
		return
	}

	// Forward the original request body verbatim so that ALL OpenAI parameters
	// (tools, tool_choice, temperature, top_p, max_tokens, stop, etc.) are
	// preserved end-to-end. Reconstructing from the openAIRequest struct would
	// silently drop any field not declared on it. We only override the model
	// with the resolved value and, for streaming requests, ensure
	// stream_options.include_usage is enabled so token usage is returned.
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	model := profile.ResolveModel(payload.Model)
	raw["model"] = model
	if payload.Stream {
		streamOpts, _ := raw["stream_options"].(map[string]any)
		if streamOpts == nil {
			streamOpts = map[string]any{}
		}
		streamOpts["include_usage"] = true
		raw["stream_options"] = streamOpts
	}

	start := time.Now()
	client := clientSourceFromRequest(r)

	// Build upstream request from the forwarded map
	body, err := json.Marshal(raw)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	req, err := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(body), profile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	resp, err := s.clientSnapshot().Do(req)
	if err != nil {
		duration := time.Since(start)
		s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, http.StatusBadGateway, duration, model, "chat/completions", tokenUsage{Client: client}, err.Error())
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()

	if payload.Stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(resp.StatusCode)
		streamUsage := pipeOpenAIStream(w, resp.Body)
		streamUsage.Client = client
		duration := time.Since(start)
		s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions (stream)", streamUsage)
	} else {
		duration := time.Since(start)
		var result openAIResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions", tokenUsage{Client: client}, err.Error())
			writeError(w, http.StatusBadGateway, err)
			return
		}
		usage := tokenUsage{
			Client:       client,
			InputTokens:  result.Usage.PromptTokens,
			OutputTokens: result.Usage.CompletionTokens,
		}
		s.addHistoryEntryWithUsage(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions", usage)
		writeJSON(w, resp.StatusCode, result)
	}
}
