package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ethan-blue/open-code-go-tools/internal/config"
	"github.com/ethan-blue/open-code-go-tools/internal/providers"
)

const maxProviderBodySize = 1 << 20 // 1 MiB

// ensureStore lazily initializes the provider store (thread-safe via sync.Once).
func (s *Server) ensureStore() *providers.Store {
	s.storeOnce.Do(func() {
		s.providerStore = providers.NewStore(s.configDir)
		if err := s.providerStore.Load(); err != nil {
			log.Printf("providers: load error: %v", err)
		}
		s.seedDefaultProviders()
	})
	return s.providerStore
}

func (s *Server) seedDefaultProviders() {
	if s.providerStore == nil {
		return
	}
	// Seed is decoupled from the (now optional) profile map. Take a read-locked
	// snapshot of the global config so we don't race config_watcher hot reloads.
	s.configMu.RLock()
	upstream := s.config.Upstream
	timeout := s.config.RequestTimeoutSeconds
	var claudeEnv map[string]string
	if len(s.config.ClaudeEnv) > 0 {
		claudeEnv = copyStringMap(s.config.ClaudeEnv)
	} else {
		claudeEnv = config.DefaultClaudeEnv(config.Profile{})
	}
	s.configMu.RUnlock()

	defaultProfile := config.Example().Profiles["opencode-go"]
	defaultModels := defaultProviderModels(defaultProfile)
	s.backfillDefaultProviderModels(defaultProfile, defaultModels)
	// Minimal, line-appropriate defaults. Users configure real credentials via
	// the Providers UI; the seed only guarantees both lines exist on cold start.
	defaults := []providers.Provider{
		{
			ID:                    "default-claude",
			Name:                  "OpenCode Go",
			BaseURL:               upstream,
			Models:                defaultModels,
			DefaultModel:          defaultProfile.DefaultModel,
			MessageModels:         append([]string(nil), defaultProfile.MessageModels...),
			FallbackChain:         append([]string(nil), defaultProfile.FallbackChain...),
			ModelAliases:          copyStringMap(defaultProfile.ModelAliases),
			Enabled:               true,
			Line:                  "claude",
			Protocol:              "openai-chat",
			RequestTimeoutSeconds: timeout,
			AuthMode:              config.DefaultAuthMode,
			Env:                   claudeEnv,
		},
		{
			ID:                    "default-codex",
			Name:                  "OpenCode Go",
			BaseURL:               upstream,
			Models:                defaultModels,
			DefaultModel:          defaultProfile.DefaultModel,
			MessageModels:         append([]string(nil), defaultProfile.MessageModels...),
			FallbackChain:         append([]string(nil), defaultProfile.FallbackChain...),
			ModelAliases:          copyStringMap(defaultProfile.ModelAliases),
			Enabled:               true,
			Line:                  "codex",
			Protocol:              "openai-responses",
			RequestTimeoutSeconds: timeout,
			AuthMode:              config.DefaultAuthMode,
		},
	}

	for _, p := range defaults {
		if s.providerStore.HasLine(p.Line) {
			continue
		}
		if err := s.providerStore.Create(p); err != nil {
			log.Printf("providers: seed default error: %v", err)
		}
	}
}

func (s *Server) backfillDefaultProviderModels(profile config.Profile, defaultModels []string) {
	for _, p := range s.providerStore.List() {
		if p.ID != "default-claude" && p.ID != "default-codex" {
			continue
		}
		changed := false
		if strings.TrimSpace(p.DefaultModel) == "" {
			p.DefaultModel = profile.DefaultModel
			changed = true
		}
		if len(p.Models) == 0 {
			p.Models = append([]string(nil), defaultModels...)
			changed = true
		}
		if len(p.MessageModels) == 0 {
			p.MessageModels = append([]string(nil), profile.MessageModels...)
			changed = true
		}
		if len(p.FallbackChain) == 0 {
			p.FallbackChain = append([]string(nil), profile.FallbackChain...)
			changed = true
		}
		if len(p.ModelAliases) == 0 {
			p.ModelAliases = copyStringMap(profile.ModelAliases)
			changed = true
		}
		if strings.TrimSpace(p.AuthMode) == "" {
			p.AuthMode = config.DefaultAuthMode
			changed = true
		}
		if p.ID == "default-codex" && p.Protocol != "openai-responses" {
			p.Protocol = "openai-responses"
			changed = true
		}
		if changed {
			if err := s.providerStore.Update(p.ID, p); err != nil {
				log.Printf("providers: default backfill error: %v", err)
			}
		}
	}
}

func defaultProviderModels(profile config.Profile) []string {
	seen := map[string]bool{}
	models := make([]string, 0)
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		models = append(models, id)
	}
	add(profile.DefaultModel)
	for _, id := range profile.MessageModels {
		add(id)
	}
	for _, id := range profile.FallbackChain {
		add(id)
	}
	for _, id := range profile.ModelAliases {
		add(id)
	}
	return models
}

// apiProvidersList handles GET /ocgt/api/providers
func (s *Server) apiProvidersList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	store := s.ensureStore()

	// Mask secrets (legacy key, account keys, quota cookies) for response
	list := store.List()
	for i := range list {
		list[i] = providers.MaskProviderSecrets(list[i])
	}

	writeJSON(w, http.StatusOK, map[string]any{"providers": list})
}

// apiProvidersCreate handles POST /ocgt/api/providers
func (s *Server) apiProvidersCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var p providers.Provider
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProviderBodySize)).Decode(&p); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if p.Name == "" || p.BaseURL == "" {
		http.Error(w, "Name and baseUrl are required", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Create(p); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
}

// apiProvidersUpdate handles PUT /ocgt/api/providers/{id}
func (s *Server) apiProvidersUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
	if id == "" {
		http.Error(w, "Missing provider ID", http.StatusBadRequest)
		return
	}

	var p providers.Provider
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProviderBodySize)).Decode(&p); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Update(id, p); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// apiProvidersDelete handles DELETE /ocgt/api/providers/{id}
func (s *Server) apiProvidersDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
	if id == "" {
		http.Error(w, "Missing provider ID", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Delete(id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// apiProvidersToggle handles PATCH /ocgt/api/providers/{id}/toggle.
// Despite the name, this endpoint only ACTIVATES a provider (and disables its
// siblings on the same line) — it cannot turn a provider off. The route name is
// retained for client compatibility; activate-via-toggle semantics are the
// intended behavior for the single-active-per-line provider model.
func (s *Server) apiProvidersToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract ID from path: /ocgt/api/providers/{id}/toggle
	path := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
	path = strings.TrimSuffix(path, "/toggle")
	if path == "" {
		http.Error(w, "Missing provider ID", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.Activate(path); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"enabled": true})
}

// apiProvidersSort handles POST /ocgt/api/providers/sort
func (s *Server) apiProvidersSort(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProviderBodySize)).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	store := s.ensureStore()
	if err := store.SaveOrder(req.IDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) apiProviderModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	line := strings.TrimSpace(r.URL.Query().Get("line"))
	if line == "" {
		line = strings.TrimSpace(r.URL.Query().Get("ocgt_line"))
	}
	data, err := s.FetchRealUpstreamModels(r.Context(), line)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, data)
}

// apiProviderTest sends a 1-token probe to a draft (or saved) provider's
// upstream to verify that a specific model actually completes inference. Unlike
// TestConnection (which only hits /v1/models), this exercises the real
// completion path so the user can confirm "this provider + this model works"
// before saving. The probe body is protocol-shaped to match the upstream:
//   - openai-chat / custom:    POST <base>/v1/chat/completions
//   - anthropic:               POST <base>/v1/messages
//   - openai-responses:        POST <base>/v1/responses
func (s *Server) apiProviderTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ProviderID     string            `json:"providerId"`
		BaseURL        string            `json:"baseUrl"`
		APIKey         string            `json:"apiKey"`
		Model          string            `json:"model"`
		Protocol       string            `json:"protocol"`
		ModelProtocols map[string]string `json:"modelProtocols"`
		AuthMode       string            `json:"authMode"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProviderBodySize)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if strings.TrimSpace(req.BaseURL) == "" || strings.TrimSpace(req.Model) == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("baseUrl and model are required"))
		return
	}

	saved := s.savedProviderForTest(req.ProviderID, req.BaseURL, req.Protocol, req.Model)
	apiKey := strings.TrimSpace(req.APIKey)
	if (apiKey == "" || providers.IsMaskedKey(apiKey)) && saved != nil {
		if accounts := saved.EnabledAccounts(); len(accounts) > 0 {
			apiKey = accounts[0].APIKey
		}
	}

	// Pick the upstream path + probe body by protocol (mirrors runtime routing).
	protocol := normalizeProviderProtocol(req.ModelProtocols[req.Model])
	if protocol == "" && saved != nil {
		protocol = normalizeProviderProtocol(saved.ModelProtocols[req.Model])
	}
	if protocol == "" {
		protocol = normalizeProviderProtocol(req.Protocol)
	}
	protocol = defaultProviderProtocol(protocol, req.BaseURL)
	if protocol == "" {
		protocol = "openai-chat"
	}
	var path, contentType string
	var body []byte
	switch protocol {
	case "anthropic":
		path = "/v1/messages"
		contentType = "application/json"
		body, _ = json.Marshal(map[string]any{
			"model":      req.Model,
			"max_tokens": 1,
			"messages":   []map[string]string{{"role": "user", "content": "ping"}},
		})
	case "openai-responses":
		path = "/v1/responses"
		contentType = "application/json"
		body, _ = json.Marshal(map[string]any{
			"model":             req.Model,
			"max_output_tokens": 1,
			"input":             "ping",
		})
	default: // openai-chat, custom, anything else → chat completions
		path = "/v1/chat/completions"
		contentType = "application/json"
		body, _ = json.Marshal(map[string]any{
			"model":      req.Model,
			"max_tokens": 1,
			"messages":   []map[string]string{{"role": "user", "content": "ping"}},
		})
	}

	// Build the upstream URL the same way newUpstreamRequest does.
	upstream := strings.TrimSpace(req.BaseURL)
	// Add a scheme if missing so url.Parse doesn't treat the host as a path.
	if !strings.HasPrefix(upstream, "http://") && !strings.HasPrefix(upstream, "https://") {
		upstream = "https://" + upstream
	}
	parsed, err := url.Parse(upstream)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": "invalid baseUrl: " + err.Error()})
		return
	}
	target := *parsed
	target.Path = singleJoin(target.Path, path)

	// 30s deadline — long enough for cold-start models, short enough for UX.
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error()})
		return
	}
	upReq.Header.Set("Content-Type", contentType)
	upReq.Header.Set("Accept", "application/json")
	if apiKey != "" {
		upReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	// Apply auth the same way the live request path does, honouring AuthMode.
	applyAnthropicAuth(upReq, config.Profile{
		APIKey:   apiKey,
		AuthMode: req.AuthMode,
	})

	client := s.clientSnapshot()
	start := time.Now()
	resp, err := client.Do(upReq)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error(), "latencyMs": latency})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxBodySize))

	if resp.StatusCode >= 400 {
		writeJSON(w, http.StatusOK, map[string]any{
			"success":   false,
			"status":    resp.StatusCode,
			"latencyMs": latency,
			"error":     fmt.Sprintf("HTTP %d: %s", resp.StatusCode, upstreamErrorSummary(resp.StatusCode, respBody)),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"status":    resp.StatusCode,
		"latencyMs": latency,
	})
}

func (s *Server) savedProviderForTest(providerID, baseURL, protocol, model string) *providers.Provider {
	store := s.ensureStore()
	if strings.TrimSpace(providerID) != "" {
		if p, err := store.Get(strings.TrimSpace(providerID)); err == nil {
			return p
		}
	}
	wantBase := canonicalProviderBaseURL(baseURL)
	if wantBase == "" {
		return nil
	}
	wantProtocol := normalizeProviderProtocol(protocol)
	var best *providers.Provider
	bestScore := -1
	for _, provider := range store.List() {
		provider := provider
		if canonicalProviderBaseURL(provider.BaseURL) != wantBase {
			continue
		}
		score := 0
		if provider.Enabled {
			score += 4
		}
		if normalizeProviderProtocol(provider.Protocol) == wantProtocol || wantProtocol == "" {
			score += 2
		}
		if normalizeProviderProtocol(provider.ModelProtocols[model]) != "" {
			score++
		}
		if score > bestScore {
			bestScore = score
			best = &provider
		}
	}
	return best
}

func canonicalProviderBaseURL(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if !strings.HasPrefix(text, "http://") && !strings.HasPrefix(text, "https://") {
		text = "https://" + text
	}
	parsed, err := url.Parse(text)
	if err != nil {
		return strings.TrimRight(strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(text), "https://"), "http://"), "/")
	}
	parsed.Host = strings.ToLower(parsed.Host)
	return strings.TrimRight(parsed.Host+parsed.Path, "/")
}

// registerProvidersRoutes registers all provider API routes.
func (s *Server) registerProvidersRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ocgt/api/providers/sort", s.apiProvidersSort)
	mux.HandleFunc("/ocgt/api/providers/models", s.apiProviderModels)
	// Registered BEFORE the /ocgt/api/providers/ catch-all so Go's longest-prefix
	// ServeMux matching resolves /test exactly here.
	mux.HandleFunc("/ocgt/api/providers/test", s.apiProviderTest)
	mux.HandleFunc("/ocgt/api/providers", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.apiProvidersList(w, r)
		case http.MethodPost:
			s.apiProvidersCreate(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/ocgt/api/providers/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/ocgt/api/providers/")
		if strings.HasSuffix(path, "/toggle") {
			s.apiProvidersToggle(w, r)
			return
		}
		switch r.Method {
		case http.MethodPut:
			s.apiProvidersUpdate(w, r)
		case http.MethodDelete:
			s.apiProvidersDelete(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
}
