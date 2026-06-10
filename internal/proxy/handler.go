package proxy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
	"github.com/ethan-blue/open-code-go-tools/internal/version"
)

// LocalToken returns the active auth token, whether configured or auto-generated.
// Used by the Wails frontend to authenticate API requests.
func (s *Server) LocalToken() string {
	s.configMu.RLock()
	token := s.config.LocalAuthToken
	s.configMu.RUnlock()
	if token != "" {
		return token
	}
	// autoAuthToken is written under autoAuthOnce which provides happens-before
	// for the write, but reads still need synchronization. Use configMu for safety.
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.autoAuthToken
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/ocgt/profile", s.profile)
	mux.HandleFunc("/v1/models", s.models)
	mux.HandleFunc("/v1/messages/count_tokens", s.countTokens)
	mux.HandleFunc("/v1/messages", s.messages)
	mux.HandleFunc("/claude-desktop/v1/models", s.models)
	mux.HandleFunc("/claude-desktop/v1/messages/count_tokens", s.countTokens)
	mux.HandleFunc("/claude-desktop/v1/messages", s.messages)

	// Web Dashboard API
	mux.HandleFunc("/ocgt/api/status", s.apiStatus)
	mux.HandleFunc("/ocgt/api/profiles", s.apiProfiles)
	mux.HandleFunc("/ocgt/api/profiles/active", s.apiSetActiveProfile)
	mux.HandleFunc("/ocgt/api/key", s.apiSetKey)
	mux.HandleFunc("/ocgt/api/history", s.apiHistory)
	mux.HandleFunc("/ocgt/api/syslog", s.apiSyslog)
	mux.HandleFunc("/ocgt/api/version", s.apiVersion)
	mux.HandleFunc("/ocgt/api/config/raw", s.apiRawConfig)
	mux.HandleFunc("/ocgt/api/quota", s.apiQuota)
	mux.HandleFunc("/ocgt/api/quota/refresh", s.apiRefreshQuota)
	s.registerStatsRoutes(mux)

	mux.HandleFunc("/", s.serveStatic)

	// Apply middlewares in order: rate limit -> auth -> logging
	handler := requestLogger(mux)

	// Enforce auth — use configured token, or auto-generated one from ListenAndServe
	token := s.config.LocalAuthToken
	if token == "" {
		token = s.autoAuthToken
	}
	if token != "" {
		handler = authMiddleware(token, handler)
	}
	// Apply rate limiting using config values (defaults: 100 req/s, burst 200)
	if s.rateLimiter == nil {
		s.rateLimiter = newRateLimiter(s.config.RateLimit())
	}
	if s.rpmLimiter == nil {
		s.rpmLimiter = newRpmLimiter(s.config.RateLimitPerMinute)
	}
	handler = rateLimitMiddleware(s.rateLimiter, handler)
	handler = rpmLimitMiddleware(s.rpmLimiter, handler)

	return handler
}

// ensurePortAvailable probes the configured listen address and auto-kills any
// process that is already holding the port. This handles the common case where
// the user upgrades ocgt without manually closing the old instance.
func (s *Server) ensurePortAvailable() {
	addr := s.config.Listen
	if addr == "" {
		addr = config.DefaultListen
	}
	ln, err := net.Listen("tcp", addr)
	if err == nil {
		ln.Close()
		return // port is free
	}
	// Port is in use — try to find and kill the offender
	log.Printf("ocgt: port %s is in use, attempting to release it...", addr)

	// Extract port for search
	_, port, parseErr := net.SplitHostPort(addr)
	if parseErr != nil {
		port = addr
	}
	pid := s.findPIDByPort(port)
	if pid == 0 {
		log.Printf("ocgt: could not find process holding port %s, giving up", addr)
		return
	}
	log.Printf("ocgt: killing PID %d holding port %s", pid, addr)
	killErr := s.killPID(pid)
	if killErr != nil {
		log.Printf("ocgt: failed to kill PID %d (attempt 1): %v", pid, killErr)
		time.Sleep(1 * time.Second)
		killErr = s.killPID(pid)
		if killErr != nil {
			log.Printf("ocgt: failed to kill PID %d (attempt 2): %v", pid, killErr)
			return
		}
	}
	// Give OS time to release the port
	time.Sleep(500 * time.Millisecond)

	// Verify the port is now free
	ln2, err2 := net.Listen("tcp", addr)
	if err2 != nil {
		log.Printf("ocgt: port %s still not available after killing PID %d: %v", addr, pid, err2)
		return
	}
	ln2.Close()
	log.Printf("ocgt: port %s released successfully", addr)
}

func (s *Server) findPIDByPort(port string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Use findstr to filter by port first, avoiding locale-dependent state parsing.
		// The trailing space after :PORT prevents partial matches (e.g., :8787 vs :87870).
		cmd = exec.CommandContext(ctx, "cmd", "/C", "netstat -ano | findstr \":"+port+" \"")
	default:
		// Unix: lsof -ti :PORT returns just the PID
		out, err := exec.CommandContext(ctx, "lsof", "-ti", ":"+port).Output()
		if err != nil {
			return 0
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(string(out)))
		return pid
	}
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	// Parse findstr output: locate the PID from the last whitespace-delimited field.
	// Netstat output structure (locale-independent for the numeric parts):
	//   Proto  Local Address    Foreign Address   State         PID
	//   TCP    127.0.0.1:8787   0.0.0.0:0         LISTENING     12345
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, ":"+port+" ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		// PID is always the last field, and is numeric
		pid, err := strconv.Atoi(fields[len(fields)-1])
		if err == nil && pid > 0 {
			return pid
		}
	}
	return 0
}

func (s *Server) killPID(pid int) error {
	cmd := exec.Command("taskkill", "/F", "/PID", strconv.Itoa(pid))
	// On Unix, use kill -9 as fallback if taskkill doesn't exist
	if runtime.GOOS != "windows" {
		cmd = exec.Command("kill", "-9", strconv.Itoa(pid))
	}
	return cmd.Run()
}

func (s *Server) ListenAndServe(ctx context.Context) error {
	// Probe port and auto-release if occupied by a stale process
	s.ensurePortAvailable()

	server := &http.Server{
		Addr:              s.config.Listen,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
	}

	// Ensure auth token is generated for production use
	if s.config.LocalAuthToken == "" && s.autoAuthToken == "" {
		s.autoAuthOnce.Do(func() {
			buf := make([]byte, 24)
			if _, err := rand.Read(buf); err != nil {
				log.Printf("ocgt: failed to generate auth token: %v", err)
				buf = []byte(fmt.Sprintf("%d", time.Now().UnixNano()))
			}
			s.autoAuthToken = hex.EncodeToString(buf)
			log.Printf("ocgt: auto-generated auth token (set local_auth_token in config to customize)")
		})
	}

	// Start configuration hot-reloading watcher
	go s.watchConfig(ctx)

	go func() {
		<-ctx.Done()
		log.Println("shutting down, stopping new connections...")

		// First, stop accepting new connections.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		log.Println("calling server.Shutdown...")
		_ = server.Shutdown(shutdownCtx)

		// Then, drain in-flight streaming requests.
		log.Println("waiting for in-flight streaming requests...")
		done := make(chan struct{})
		go func() {
			s.wg.Wait()
			close(done)
		}()
		select {
		case <-done:
			log.Println("all in-flight streaming requests completed")
		case <-time.After(30 * time.Second):
			log.Println("timed out waiting for in-flight streaming requests")
		}
	}()
	log.Printf("ocgt OpenCode Go proxy listening on http://%s -> %s", s.config.Listen, s.config.Upstream)
	err := server.ListenAndServe()
	if errors.Is(err, context.Canceled) || errors.Is(err, http.ErrServerClosed) {
		log.Println("server stopped")
		return nil
	}
	return err
}

// watchConfig polls the config file for changes every 3 seconds.
// TODO: Consider using fsnotify for event-driven watching instead of polling.
// This would reduce latency and CPU usage, but would add a dependency.
// Current implementation works correctly and is simpler to maintain.
func (s *Server) watchConfig(ctx context.Context) {
	if s.configPath == "" {
		return
	}

	var lastModTime time.Time
	if info, err := os.Stat(s.configPath); err == nil {
		lastModTime = info.ModTime()
	}

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(s.configPath)
			if err != nil {
				continue
			}
			if info.ModTime().After(lastModTime) {
				lastModTime = info.ModTime()
				cfg, err := config.Load(s.configPath)
				if err != nil {
					log.Printf("ocgt: config reload error: %v", err)
				} else {
					s.ApplyConfig(cfg)
					log.Printf("ocgt: config hot-reloaded from %s", s.configPath)
				}
			}
		}
	}
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	_, name, err := s.profileFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.configMu.RLock()
	upstream := s.config.Upstream
	s.configMu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]string{"active_profile": name, "upstream": upstream})
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	profile, _, err := s.profileFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if isClaudeDesktopRoute(r) {
		writeJSON(w, http.StatusOK, configuredModels(profile))
		return
	}
	req, err := s.newUpstreamRequest(r.Context(), http.MethodGet, "/v1/models", nil, profile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	resp, err := s.clientSnapshot().Do(req)
	if err != nil {
		writeProxyError(w, err)
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if resp.StatusCode >= 400 {
		writeUpstreamError(w, resp.StatusCode, body)
		return
	}
	writeJSON(w, http.StatusOK, normalizeModels(body, profile))
}

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

func (s *Server) buildCandidateModels(payloadModel string, profile config.Profile) []string {
	candidates := []string{payloadModel}
	for _, fallback := range profile.FallbackChain {
		resolved := profile.ResolveModel(fallback)
		if resolved != "" && resolved != payloadModel {
			duplicate := false
			for _, c := range candidates {
				if c == resolved {
					duplicate = true
					break
				}
			}
			if !duplicate {
				candidates = append(candidates, resolved)
			}
		}
	}
	return candidates
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
		usage                                     tokenUsage
		lineBuf                                   strings.Builder
		capturing , inEvent                       bool
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
				backoff := time.Duration(500*(1<<attempt)) * time.Millisecond
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

func (s *Server) thinkingBudgetTokens() int {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.config.ThinkingBudgetTokens()
}

func (s *Server) newUpstreamRequest(ctx context.Context, method, path string, body io.Reader, profile config.Profile) (*http.Request, error) {
	s.configMu.RLock()
	upstreamStr := s.upstream
	s.configMu.RUnlock()

	upstream, err := url.Parse(upstreamStr)
	if err != nil {
		return nil, err
	}
	target := *upstream
	target.Path = singleJoin(target.Path, path)
	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	req.Host = upstream.Host
	req.Header.Set("Accept", "application/json")
	for k, v := range profile.Headers {
		req.Header.Set(k, v)
	}
	if key := profile.APIKeyValue(); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	stripHopByHopHeaders(req.Header)
	return req, nil
}

func prepareStreamingUpstreamRequest(req *http.Request) {
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Accept-Encoding", "identity")
}

func applyAnthropicAuth(req *http.Request, profile config.Profile) {
	key := profile.APIKeyValue()
	if key == "" {
		return
	}
	req.Header.Del("Authorization")
	req.Header.Set("X-Api-Key", key)
	req.Header.Set("Anthropic-Version", "2023-06-01")
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

func isClaudeDesktopRoute(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/claude-desktop/")
}

func (s *Server) profileFromRequest(r *http.Request) (config.Profile, string, error) {
	name := strings.TrimSpace(r.Header.Get("X-Ocgt-Profile"))
	if before, _, found := strings.Cut(name, ","); found {
		name = strings.TrimSpace(before)
	}
	if name == "" {
		name = strings.TrimSpace(r.URL.Query().Get("ocgt_profile"))
	}
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.config.Profile(name)
}

func clientSourceFromRequest(r *http.Request) string {
	raw := strings.TrimSpace(r.Header.Get("X-Ocgt-Client"))
	if raw == "" {
		raw = clientFromCombinedProfileHeader(r.Header.Get("X-Ocgt-Profile"))
	}
	if raw == "" && isClaudeDesktopRoute(r) {
		raw = "claude-app"
	}

	// Advanced User-Agent inspection
	ua := strings.ToLower(r.Header.Get("User-Agent"))
	if strings.Contains(ua, "vscode") || strings.Contains(ua, "code/") {
		return "VS Code 插件 (VS Code Claude)"
	}
	if strings.Contains(ua, "node-fetch") {
		return "终端 CLI (Claude Code CLI)"
	}

	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "claude-code-cli", "cli", "claude cli":
		return "终端 CLI (Claude Code CLI)"
	case "vscode-claude-code", "vscode", "vs code", "vscode claude code":
		return "VS Code 插件 (VS Code Claude)"
	case "claude-app", "claude", "claude desktop", "desktop":
		return "桌面端 (Claude App)"
	case "":
		return "Unknown"
	default:
		clean := strings.Map(func(r rune) rune {
			if r < 32 || r == 127 {
				return -1
			}
			return r
		}, raw)
		clean = strings.TrimSpace(clean)
		if len(clean) > 64 {
			clean = clean[:64]
		}
		if clean == "" {
			return "Unknown"
		}
		return clean
	}
}

func clientFromCombinedProfileHeader(value string) string {
	for _, part := range strings.Split(value, ",") {
		name, val, ok := strings.Cut(strings.TrimSpace(part), ":")
		if !ok || !strings.EqualFold(strings.TrimSpace(name), "X-Ocgt-Client") {
			continue
		}
		return strings.TrimSpace(val)
	}
	return ""
}

func normalizeModels(data []byte, profile config.Profile) map[string]any {
	out := configuredModels(profile)
	models := out["data"].([]map[string]any)
	seen := map[string]bool{}
	for _, model := range models {
		id, _ := model["id"].(string)
		if id != "" {
			seen[id] = true
		}
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return out
	}
	list, ok := raw["data"].([]any)
	if !ok {
		return out
	}
	for _, item := range list {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := obj["id"].(string)
		if id == "" {
			id, _ = obj["name"].(string)
		}
		if id == "" {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, map[string]any{"id": id, "type": "model", "display_name": id})
	}
	return map[string]any{"data": models, "has_more": false}
}

func configuredModels(profile config.Profile) map[string]any {
	seen := map[string]bool{}
	var models []map[string]any
	add := func(id string, display string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		if display == "" {
			display = id
		}
		models = append(models, map[string]any{"id": id, "type": "model", "display_name": display})
	}
	add("claude-sonnet-4-5", "Claude Sonnet -> "+profile.ResolveModel("claude-sonnet-4-5"))
	add("claude-haiku-4-5", "Claude Haiku -> "+profile.ResolveModel("claude-haiku-4-5"))
	add("claude-opus-4-7", "Claude Opus -> "+profile.ResolveModel("claude-opus-4-7"))
	add(profile.DefaultModel, "Default -> "+profile.ResolveModel(""))
	for alias, target := range profile.ModelAliases {
		add(alias, alias+" -> "+target)
	}
	for _, id := range profile.MessageModels {
		add(id, "Messages -> "+id)
	}
	return map[string]any{"data": models, "has_more": false}
}

func (s *Server) addHistoryEntry(method, path string, status int, duration time.Duration, model, route string) {
	s.addHistoryEntryWithError(method, path, status, duration, model, route, "")
}

func (s *Server) addHistoryEntryWithError(method, path string, status int, duration time.Duration, model, route, errorText string) {
	s.addHistoryEntryWithUsageAndError(method, path, status, duration, model, route, tokenUsage{}, errorText)
}

type tokenUsage struct {
	InputTokens         int
	OutputTokens        int
	CacheCreationTokens int
	CacheReadTokens     int
	Client              string
}

func (s *Server) addHistoryEntryWithUsage(method, path string, status int, duration time.Duration, model, route string, usage tokenUsage) {
	s.addHistoryEntryWithUsageAndError(method, path, status, duration, model, route, usage, "")
}

func (s *Server) addHistoryEntryWithUsageAndError(method, path string, status int, duration time.Duration, model, route string, usage tokenUsage, errorText string) {
	s.historyMu.Lock()
	entry := requestLogEntry{
		ID:                  fmt.Sprintf("req_%d", time.Now().UnixNano()),
		Time:                time.Now(),
		Method:              method,
		Path:                path,
		Status:              status,
		Duration:            duration.Round(time.Millisecond).String(),
		Model:               model,
		Route:               route,
		Client:              usage.Client,
		InputTokens:         usage.InputTokens,
		OutputTokens:        usage.OutputTokens,
		CacheCreationTokens: usage.CacheCreationTokens,
		CacheReadTokens:     usage.CacheReadTokens,
		TotalTokens:         usage.InputTokens + usage.OutputTokens + usage.CacheCreationTokens,
		Error:               errorText,
	}
	s.history = append([]requestLogEntry{entry}, s.history...) // prepend so newest is first
	if len(s.history) > 100 {
		s.history = s.history[:100]
	}
	s.historyMu.Unlock()
	s.persistHistoryEntry(entry)
}

func (s *Server) apiStatus(w http.ResponseWriter, r *http.Request) {
	s.configMu.RLock()
	activeProfile := s.config.ActiveProfile
	profile, _, _ := s.config.Profile(activeProfile)
	listen := s.config.Listen
	upstream := s.config.Upstream
	timeoutSeconds := s.config.RequestTimeoutSeconds
	thinkingBudgetTokens := s.config.ThinkingBudgetTokens()
	rateLimitPerSecond, rateLimitBurst := s.config.RateLimit()
	rateLimitPerMinute := s.config.RateLimitPerMinute
	claudeEnv := map[string]string{}
	if len(s.config.ClaudeEnv) > 0 {
		for key, value := range s.config.ClaudeEnv {
			claudeEnv[key] = value
		}
	} else {
		claudeEnv = config.DefaultClaudeEnv(profile)
	}
	authEnabled := s.config.LocalAuthToken != ""
	configPath := s.configPath
	s.configMu.RUnlock()

	status := map[string]any{
		"status":                     "running",
		"listen":                     listen,
		"upstream":                   upstream,
		"request_timeout_seconds":    timeoutSeconds,
		"max_thinking_budget_tokens": thinkingBudgetTokens,
		"rate_limit_per_second":      rateLimitPerSecond,
		"rate_limit_burst":           rateLimitBurst,
		"rate_limit_per_minute":      rateLimitPerMinute,
		"claude_env":                 claudeEnv,
		"api_key_configured":         profile.APIKeyValue() != "",
		"config_path":                configPath,
		"active_profile":             activeProfile,
		"default_model":              profile.DefaultModel,
		"auth_enabled":               authEnabled,
	}
	writeJSON(w, http.StatusOK, status)
}

// maskAPIKey returns a masked version of the key showing only the first 4 and last 4 chars.
// If the key is empty or too short, returns an appropriate placeholder.
func maskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "..." + key[len(key)-4:]
}

func (s *Server) apiProfiles(w http.ResponseWriter, r *http.Request) {
	s.configMu.RLock()
	defer s.configMu.RUnlock()

	// Mask API keys before sending to frontend
	masked := make(map[string]any, len(s.config.Profiles))
	for name, p := range s.config.Profiles {
		masked[name] = map[string]any{
			"api_key_env":        p.APIKeyEnv,
			"api_key":            maskAPIKey(p.APIKey),
			"api_key_configured": p.APIKeyValue() != "",
			"default_model":      p.DefaultModel,
			"model_aliases":      p.ModelAliases,
			"message_models":     p.MessageModels,
			"fallback_chain":     p.FallbackChain,
			"headers":            p.Headers,
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"active_profile": s.config.ActiveProfile,
		"profiles":       masked,
	})
}

func (s *Server) apiSetActiveProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var req struct {
		Profile string `json:"profile"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxBodySize)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	// Validate profile exists with read lock
	s.configMu.RLock()
	_, _, err := s.config.Profile(req.Profile)
	s.configMu.RUnlock()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	// Update with write lock
	s.configMu.Lock()
	s.config.ActiveProfile = req.Profile
	err = s.config.Save(s.configPath)
	s.configMu.Unlock()

	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("failed to save config: %w", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "active_profile": req.Profile})
}

func (s *Server) apiSetKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var req struct {
		Profile                 string            `json:"profile"`
		APIKey                  string            `json:"api_key"`
		DefaultModel            string            `json:"default_model"`
		ModelAliases            map[string]string `json:"model_aliases"`
		RequestTimeoutSeconds   int               `json:"request_timeout_seconds"`
		MaxThinkingBudgetTokens int               `json:"max_thinking_budget_tokens"`
		Upstream                string            `json:"upstream"`
		Listen                  string            `json:"listen"`
		RateLimitPerSecond      int               `json:"rate_limit_per_second"`
		RateLimitBurst          int               `json:"rate_limit_burst"`
		RateLimitPerMinute      *int              `json:"rate_limit_per_minute"`
		ClaudeEnv               map[string]string `json:"claude_env"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxBodySize)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	s.configMu.Lock()
	defer s.configMu.Unlock()

	profileName := req.Profile
	if profileName == "" {
		profileName = s.config.ActiveProfile
	}

	p, ok := s.config.Profiles[profileName]
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Errorf("profile %q not found", profileName))
		return
	}
	if req.RequestTimeoutSeconds != 0 && (req.RequestTimeoutSeconds < 1 || req.RequestTimeoutSeconds > 3600) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("request_timeout_seconds must be between 1 and 3600, got %d", req.RequestTimeoutSeconds))
		return
	}
	if req.MaxThinkingBudgetTokens != 0 && (req.MaxThinkingBudgetTokens < -1 || req.MaxThinkingBudgetTokens > 8192) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("max_thinking_budget_tokens must be -1, 0, or between 1 and 8192, got %d", req.MaxThinkingBudgetTokens))
		return
	}
	if req.RateLimitPerSecond != 0 && (req.RateLimitPerSecond < 1 || req.RateLimitPerSecond > 10000) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rate_limit_per_second must be between 1 and 10000, got %d", req.RateLimitPerSecond))
		return
	}
	if req.RateLimitBurst != 0 && (req.RateLimitBurst < 1 || req.RateLimitBurst > 100000) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rate_limit_burst must be between 1 and 100000, got %d", req.RateLimitBurst))
		return
	}
	if req.RateLimitPerMinute != nil && (*req.RateLimitPerMinute < 0 || *req.RateLimitPerMinute > 100000) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("rate_limit_per_minute must be between 0 and 100000, got %d", *req.RateLimitPerMinute))
		return
	}
	if strings.TrimSpace(req.Listen) != "" {
		if err := config.ValidateListenAddress(req.Listen); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}

	// If the API key looks masked (contains "..." or is the short placeholder),
	// don't overwrite the existing key — the frontend sent back the masked value
	// because the user didn't change it.
	if strings.Contains(req.APIKey, "...") || req.APIKey == "****" {
		req.APIKey = p.APIKey
	}
	p.APIKey = req.APIKey
	if req.DefaultModel != "" {
		p.DefaultModel = req.DefaultModel
	}
	if len(req.ModelAliases) > 0 {
		if p.ModelAliases == nil {
			p.ModelAliases = map[string]string{}
		}
		for k, v := range req.ModelAliases {
			p.ModelAliases[k] = v
		}
	}
	s.config.Profiles[profileName] = p
	if req.RequestTimeoutSeconds != 0 {
		s.config.RequestTimeoutSeconds = req.RequestTimeoutSeconds
		// Replace client to avoid racing with concurrent readers.
		old := s.client
		s.client = &http.Client{
			Timeout:   s.config.RequestTimeout(),
			Transport: old.Transport,
		}
	}
	if req.MaxThinkingBudgetTokens != 0 {
		s.config.MaxThinkingBudgetTokens = req.MaxThinkingBudgetTokens
	}
	if strings.TrimSpace(req.Upstream) != "" {
		s.config.Upstream = strings.TrimSpace(req.Upstream)
		s.upstream = s.config.Upstream
	}
	if strings.TrimSpace(req.Listen) != "" {
		s.config.Listen = strings.TrimSpace(req.Listen)
	}
	if req.RateLimitPerSecond != 0 {
		s.config.RateLimitPerSecond = req.RateLimitPerSecond
	}
	if req.RateLimitBurst != 0 {
		s.config.RateLimitBurst = req.RateLimitBurst
	}
	if req.RateLimitPerMinute != nil {
		s.config.RateLimitPerMinute = *req.RateLimitPerMinute
		if s.rpmLimiter != nil {
			s.rpmLimiter.setLimit(*req.RateLimitPerMinute)
		}
	}
	if req.ClaudeEnv != nil {
		s.config.ClaudeEnv = req.ClaudeEnv
	}

	if err := s.config.Save(s.configPath); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("failed to save config: %w", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "profile": profileName})
}

func (s *Server) apiHistory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		days := parseIntParam(r, "days", 0)
		// 先读内存历史（当前会话）
		s.historyMu.RLock()
		memHist := s.history
		s.historyMu.RUnlock()

		// 再从 JSONL 文件读取（历史持久化）
		fileEntries := s.readJSONLLogs(days)

		// 合并两份数据：文件条目（已按时间倒序）+ 内存中新增的（文件可能没来得及写入的）
		seen := make(map[string]bool, len(fileEntries))
		for _, e := range fileEntries {
			seen[e.ID] = true
		}
		for _, e := range memHist {
			if !seen[e.ID] {
				fileEntries = append(fileEntries, e)
			}
		}

		// 按时间倒序排列（最新在前）
		sort.Slice(fileEntries, func(i, j int) bool {
			return fileEntries[i].Time.After(fileEntries[j].Time)
		})

		writeJSON(w, http.StatusOK, fileEntries)
	case http.MethodDelete:
		s.historyMu.Lock()
		s.history = nil
		s.historyMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
	}
}

func (s *Server) apiSyslog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
		return
	}
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(home, ".ocgt", "proxy.log")

	content, err := os.ReadFile(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, map[string]string{"log": "Proxy log file not found or hasn't been created yet."})
			return
		}
		writeError(w, http.StatusInternalServerError, fmt.Errorf("failed to read log: %w", err))
		return
	}

	// Keep last 1000 lines approx (around 100KB)
	const maxLen = 100 * 1024
	if len(content) > maxLen {
		content = content[len(content)-maxLen:]
	}
	writeJSON(w, http.StatusOK, map[string]string{"log": string(content)})
}

func (s *Server) apiRawConfig(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".claude", "settings.json")

	if r.Method == http.MethodGet {
		data, err := os.ReadFile(configPath)
		if err != nil {
			if os.IsNotExist(err) {
				writeJSON(w, http.StatusOK, map[string]any{})
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
		return
	}

	if r.Method == http.MethodPost {
		data, err := io.ReadAll(io.LimitReader(r.Body, MaxBodySize+1))
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if int64(len(data)) > MaxBodySize {
			writeError(w, http.StatusRequestEntityTooLarge, fmt.Errorf("request body too large (max %d bytes)", MaxBodySize))
			return
		}
		var js map[string]interface{}
		if err := json.Unmarshal(data, &js); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("Invalid JSON: %w", err))
			return
		}
		// Formatting and saving
		formatted, _ := json.MarshalIndent(js, "", "  ")
		if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if err := os.WriteFile(configPath, formatted, 0644); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("Method not allowed"))
}

func (s *Server) apiVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method %s not supported", r.Method))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"version": version.Version})
}

// SetQuotaData sets the cached quota data from an external caller (e.g. Wails frontend).
func (s *Server) SetQuotaData(data *quota.QuotaData) {
	s.quotaMu.Lock()
	defer s.quotaMu.Unlock()
	s.quotaData = data
}

// apiQuota returns the cached quota data (GET only).
// Use /ocgt/api/quota/refresh to fetch fresh data first.
func (s *Server) apiQuota(w http.ResponseWriter, r *http.Request) {
	s.quotaMu.RLock()
	data := s.quotaData
	s.quotaMu.RUnlock()

	result := quota.QuotaResult{
		Success:      data != nil,
		ProviderName: "opencode-go",
		Data:         data,
	}
	if data == nil {
		result.Error = "no quota data available — call POST /ocgt/api/quota/refresh first"
	}
	writeJSON(w, http.StatusOK, result)
}

// apiRefreshQuota fetches fresh quota data from OpenCode Go (POST only).
// Credentials are resolved in this order: profile config → env vars.
func (s *Server) apiRefreshQuota(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("POST required"))
		return
	}

	cookie, workspaceID := s.resolveQuotaCredentials()
	data, err := quota.FetchOpenCodeGoQuota(cookie, workspaceID)
	if err != nil {
		writeJSON(w, http.StatusOK, quota.QuotaResult{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	s.quotaMu.Lock()
	s.quotaData = data
	s.quotaMu.Unlock()

	writeJSON(w, http.StatusOK, quota.QuotaResult{
		Success: true,
		Data:    data,
	})
}

// resolveQuotaCredentials resolves from profile config, falling back to env vars.
func (s *Server) resolveQuotaCredentials() (cookie, workspaceID string) {
	cookie = os.Getenv("OPENCODE_GO_AUTH_COOKIE")
	workspaceID = os.Getenv("OPENCODE_GO_WORKSPACE_ID")
	if cookie != "" && workspaceID != "" {
		return
	}

	s.configMu.RLock()
	defer s.configMu.RUnlock()
	profile, _, err := s.config.Profile("")
	if err != nil {
		return
	}
	if cookie == "" && profile.QuotaCookie != "" {
		cookie = profile.QuotaCookie
	}
	if workspaceID == "" && profile.QuotaWorkspaceID != "" {
		workspaceID = profile.QuotaWorkspaceID
	}
	return
}
