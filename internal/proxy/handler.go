package proxy

import (
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
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/quota"
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
	mux.HandleFunc("/v1/chat/completions", s.chatCompletions)
	mux.HandleFunc("/v1/responses", s.responses)
	mux.HandleFunc("/claude-desktop/v1/models", s.models)
	mux.HandleFunc("/claude-desktop/v1/messages/count_tokens", s.countTokens)
	mux.HandleFunc("/claude-desktop/v1/messages", s.messages)

	// Web Dashboard API
	mux.HandleFunc("/ocgt/api/status", s.apiStatus)
	mux.HandleFunc("/ocgt/api/key", s.apiSetKey)
	mux.HandleFunc("/ocgt/api/history", s.apiHistory)
	mux.HandleFunc("/ocgt/api/syslog", s.apiSyslog)
	mux.HandleFunc("/ocgt/api/version", s.apiVersion)
	mux.HandleFunc("/ocgt/api/config/raw", s.apiRawConfig)
	mux.HandleFunc("/ocgt/api/config/export", s.apiConfigExport)
	mux.HandleFunc("/ocgt/api/config/import", s.apiConfigImport)
	mux.HandleFunc("/ocgt/api/quota", s.apiQuota)
	mux.HandleFunc("/ocgt/api/quota/refresh", s.apiRefreshQuota)
	mux.HandleFunc("/ocgt/api/sessions", s.apiSessions)
	mux.HandleFunc("/ocgt/api/hub/sync", s.apiHubSync)
	s.registerStatsRoutes(mux)

	// Providers API
	s.registerProvidersRoutes(mux)

	// Copilot API
	mux.HandleFunc("/ocgt/api/copilot/ask", s.apiCopilotAsk)
	mux.HandleFunc("/ocgt/api/copilot/insights", s.apiCopilotInsights)
	mux.HandleFunc("/ocgt/api/copilot/action/{id}", s.apiCopilotAction)

	// System info API (hardware detection for onboarding)
	mux.HandleFunc("/ocgt/api/system-info", s.apiSystemInfo)

	mux.HandleFunc("/", s.serveStatic)

	// Apply middlewares in order: security -> rate limit -> auth -> logging
	handler := requestLogger(mux)

	// Enforce auth — use configured token, or auto-generated one from ListenAndServe
	token := s.LocalToken()
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
	handler = securityHeadersMiddleware(handler)

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

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	target, err := s.runtimeTargetForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"active_profile": target.name, "upstream": target.upstream})
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	target, err := s.runtimeTargetForRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if isClaudeDesktopRoute(r) {
		writeJSON(w, http.StatusOK, configuredModels(target.profile))
		return
	}
	req, err := s.newUpstreamRequest(r.Context(), http.MethodGet, "/v1/models", nil, target)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	applyAnthropicAuth(req, target.profile)
	resp, err := s.doUpstream(req, target.timeoutSeconds)
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
	writeJSON(w, http.StatusOK, normalizeModels(body, target.profile))
}

// FetchUpstreamModels fetches the /v1/models list from the active upstream profile.
// It reuses the same auth + client logic as the /v1/models proxy route but does not
// require an http.Request, so it can be called from Wails bindings (no CORS issues)
// and automatically carries the configured API key for the active profile.
// Returns the normalized models map (same shape produced by normalizeModels).
func (s *Server) FetchUpstreamModels(ctx context.Context) (map[string]any, error) {
	target, err := s.runtimeTargetForRequest((&http.Request{URL: &url.URL{Path: "/v1/models"}}))
	if err != nil {
		return nil, err
	}
	req, err := s.newUpstreamRequest(ctx, http.MethodGet, "/v1/models", nil, target)
	if err != nil {
		return nil, err
	}
	applyAnthropicAuth(req, target.profile)
	resp, err := s.doUpstream(req, target.timeoutSeconds)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, string(body))
	}
	return normalizeModels(body, target.profile), nil
}

// TestConnection fetches /v1/models from the given upstream URL using the
// provided API key.  This is a one-shot probe that does NOT modify the
// running server config — safe for testing draft (unsaved) credentials.
func (s *Server) TestConnection(ctx context.Context, upstream, apiKey string) (map[string]any, error) {
	if strings.TrimSpace(upstream) == "" {
		return nil, fmt.Errorf("upstream URL is required")
	}
	// Normalise: add scheme if missing
	u := strings.TrimSpace(upstream)
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		u = "https://" + u
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return nil, fmt.Errorf("invalid upstream URL: %w", err)
	}
	target := *parsed
	target.Path = singleJoin(target.Path, "/v1/models")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Host = parsed.Host
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Anthropic-Version", "2023-06-01")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("X-Api-Key", apiKey)
	}

	// Use the server's shared transport (keeps TLS settings etc.)
	client := s.clientSnapshot()
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("connection failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	// Build a minimal profile just for normalisation
	draftProfile := config.Profile{APIKey: apiKey}
	return normalizeModels(body, draftProfile), nil
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

func (s *Server) newUpstreamRequest(ctx context.Context, method, path string, body io.Reader, target requestTarget) (*http.Request, error) {
	upstream, err := url.Parse(target.upstream)
	if err != nil {
		return nil, err
	}
	upstreamTarget := *upstream
	upstreamTarget.Path = singleJoin(upstreamTarget.Path, path)
	req, err := http.NewRequestWithContext(ctx, method, upstreamTarget.String(), body)
	if err != nil {
		return nil, err
	}
	req.Host = upstream.Host
	req.Header.Set("Accept", "application/json")
	for k, v := range target.profile.Headers {
		req.Header.Set(k, v)
	}
	if key := target.profile.APIKeyValue(); key != "" {
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

// applyAnthropicAuth applies the profile's configured upstream auth scheme on
// top of the Authorization: Bearer header already set by newUpstreamRequest.
// The scheme is chosen via profile.AuthMode (default "bearer"):
//   - "bearer"   (default): keep Authorization: Bearer only. This is correct
//     for OpenAI-compatible gateways such as opencode.ai/zen/go. No changes.
//   - "x-api-key": drop Authorization and send X-Api-Key + Anthropic-Version,
//     matching the genuine Anthropic API and new-api style gateways.
//   - "both":      send both (compatibility fallback).
//
// This config-driven approach fixes the v2.0.4 regression where Bearer was
// unconditionally dropped: callers targeting a Bearer upstream simply leave
// auth_mode at its default and Bearer is preserved. See
// TestApplyAnthropicAuth* in proxy_test.go.
func applyAnthropicAuth(req *http.Request, profile config.Profile) {
	key := profile.APIKeyValue()
	if key == "" {
		return
	}
	switch profile.EffectiveAuthMode() {
	case config.AuthModeAPIKey:
		// Genuine Anthropic-native upstream: it expects X-Api-Key and treats a
		// stray Authorization as ambiguous. Drop Bearer, set X-Api-Key.
		req.Header.Del("Authorization")
		req.Header.Set("X-Api-Key", key)
		req.Header.Set("Anthropic-Version", "2023-06-01")
	case config.AuthModeBoth:
		// Compatibility fallback: satisfy either auth scheme. Carries the
		// auth-ambiguity risk LiteLLM warns about, so opt-in only.
		req.Header.Set("X-Api-Key", key)
		req.Header.Set("Anthropic-Version", "2023-06-01")
	default: // AuthModeBearer
		// OpenAI-compatible gateway: newUpstreamRequest already set
		// Authorization: Bearer; nothing to add. Anthropic-Version is harmless
		// and matches what Claude Code sends, so forward it for compatibility.
		req.Header.Set("Anthropic-Version", "2023-06-01")
	}
}

func isClaudeDesktopRoute(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/claude-desktop/")
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

	// 累加跨设备同步计数器
	if s.HubCounters != nil {
		s.HubCounters.Accumulate(entry.Model, entry.Route, usage.Client,
			int64(usage.InputTokens), int64(usage.OutputTokens),
			int64(usage.CacheReadTokens), int64(usage.CacheCreationTokens))
	}

	s.persistHistoryEntry(entry)
}

// SetQuotaData sets the cached quota data from an external caller (e.g. Wails frontend).
func (s *Server) SetQuotaData(data *quota.QuotaData) {
	s.quotaMu.Lock()
	defer s.quotaMu.Unlock()
	s.quotaData = data
}
