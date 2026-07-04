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
)

func (s *Server) forwardChatCompletions(w http.ResponseWriter, r *http.Request, target requestTarget, payload anthropicRequest) {
	// Track in-flight streaming requests for graceful shutdown.
	s.wg.Add(1)
	defer s.wg.Done()

	client := clientSourceFromRequest(r)
	model := payload.Model
	// Fallback chain (model-level failover): candidates[0] is the requested
	// model; with multiple candidates each model gets 2 attempts before
	// advancing to the next one.
	candidates := s.buildCandidateModels(payload.Model, target.profile)
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
		if len(candidates) > 1 {
			idx := attempt / 2
			if idx >= len(candidates) {
				idx = len(candidates) - 1
			}
			model = candidates[idx]
		}
		// Account failover: pick the healthiest account for this attempt.
		accountID := s.pickAccount(&target)
		// Sanitize image content for non-vision models
		if !supportsVisionInput(model) {
			sanitizeContentBlocksForNonVision(payload.Messages)
		}

		chatReq := anthropicToOpenAI(payload)
		chatReq.Model = model
		chatReq.Thinking, chatReq.ReasoningEffort = chatCompletionThinkingControls(model, payload.Thinking, target.thinkingBudget)
		if supportsReasoningContentReplay(model) {
			s.attachReasoningContent(chatReq.Messages)
		}
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
		if payload.Stream {
			prepareStreamingUpstreamRequest(req)
		}
		// Apply the profile's configured upstream auth scheme. For the default
		// "bearer" mode (opencode.ai/zen/go and other OpenAI-compatible gateways)
		// this is a no-op on Authorization; for "x-api-key"/"both" it adds/sets the
		// Anthropic-native headers. See applyAnthropicAuth.
		applyAnthropicAuth(req, target.profile)

		start := time.Now()
		resp, err := s.doUpstream(req, target.timeoutSeconds)
		duration := time.Since(start)

		if err != nil {
			s.recordModelFailure(model)
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
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
			retryAfter := retryAfterDuration(resp)
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))
			resp.Body.Close()
			errText := upstreamErrorSummary(resp.StatusCode, respBody)

			s.recordModelFailure(model)
			if isAccountLevelFailure(resp.StatusCode) {
				s.noteAccountFailure(target.name, accountID, resp.StatusCode, retryAfter, errText)
			}

			// Client error (except 429) → return immediately, no retry.
			// Exception: 401/403 with a multi-account pool fail over instead.
			if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) &&
					len(target.accounts) > 1 && attempt < maxRetries {
					log.Printf("[Failover] Account %q got %d, rotating to next account (attempt %d/%d)", accountID, resp.StatusCode, attempt+1, maxRetries+1)
					continue
				}
				writeUpstreamError(w, resp.StatusCode, respBody)
				s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions", tokenUsage{Client: client}, errText)
				return
			}

			// 5xx or 429 → log and retry
			log.Printf("[Retry] Model %q returned %d (attempt %d/%d): %s", model, resp.StatusCode, attempt+1, maxRetries+1, errText)

			if attempt < maxRetries {
				// 429 with a multi-account pool: fail over immediately.
				if resp.StatusCode == http.StatusTooManyRequests && len(target.accounts) > 1 {
					continue
				}
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
		s.noteAccountSuccess(target.name, accountID)
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
	model := target.profile.ResolveModel(payload.Model)
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

	// Retry with account failover before the first byte reaches the client.
	// This path previously had NO retry at all, unlike every other route.
	const maxRetries = 5
	var resp *http.Response
	for attempt := 0; ; attempt++ {
		accountID := s.pickAccount(&target)
		req, reqErr := s.newUpstreamRequest(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(body), target)
		if reqErr != nil {
			writeError(w, http.StatusInternalServerError, reqErr)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if payload.Stream {
			prepareStreamingUpstreamRequest(req)
		}

		resp, err = s.doUpstream(req, target.timeoutSeconds)
		if err != nil {
			s.noteAccountFailure(target.name, accountID, 0, 0, err.Error())
			if attempt < maxRetries {
				time.Sleep(s.retryBackoffBase * time.Duration(1<<attempt))
				continue
			}
			duration := time.Since(start)
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, http.StatusBadGateway, duration, model, "chat/completions", tokenUsage{Client: client}, err.Error())
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
			if retryable && attempt < maxRetries {
				// Rotating to another account needs no backoff; same-account
				// retries (single-key pools, 5xx) back off exponentially.
				if len(target.accounts) <= 1 || resp.StatusCode >= 500 {
					time.Sleep(s.retryBackoffBase * time.Duration(1<<attempt))
				}
				log.Printf("[Retry] chat/completions model %q returned %d (attempt %d/%d)", model, resp.StatusCode, attempt+1, maxRetries+1)
				continue
			}
			duration := time.Since(start)
			s.addHistoryEntryWithUsageAndError(r.Method, r.URL.Path, resp.StatusCode, duration, model, "chat/completions", tokenUsage{Client: client}, errText)
			writeUpstreamError(w, resp.StatusCode, respBody)
			return
		}
		s.noteAccountSuccess(target.name, accountID)
		break
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
