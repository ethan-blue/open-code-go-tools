package proxy

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

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
	thinking := s.config.MaxThinkingBudgetTokens
	var claudeEnv map[string]string
	if len(s.config.ClaudeEnv) > 0 {
		claudeEnv = copyStringMap(s.config.ClaudeEnv)
	} else {
		claudeEnv = config.DefaultClaudeEnv(config.Profile{})
	}
	s.configMu.RUnlock()

	// Minimal, line-appropriate defaults. Users configure real credentials via
	// the Providers UI; the seed only guarantees both lines exist on cold start.
	defaults := []providers.Provider{
		{
			ID:                    "default-claude",
			Name:                  "OpenCode Go",
			BaseURL:               upstream,
			Models:                []string{},
			Priority:              0,
			Enabled:               true,
			Health:                "unknown",
			Line:                  "claude",
			Protocol:              "openai-chat",
			RequestTimeoutSeconds: timeout,
			ThinkingBudgetTokens:  thinking,
			AuthMode:              config.DefaultAuthMode,
			Env:                   claudeEnv,
		},
		{
			ID:                    "default-codex",
			Name:                  "OpenCode Go",
			BaseURL:               upstream,
			Models:                []string{},
			Priority:              0,
			Enabled:               true,
			Health:                "unknown",
			Line:                  "codex",
			Protocol:              "openai-responses",
			RequestTimeoutSeconds: timeout,
			ThinkingBudgetTokens:  thinking,
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

// apiProvidersList handles GET /ocgt/api/providers
func (s *Server) apiProvidersList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	store := s.ensureStore()

	// Mask API keys for response
	list := store.List()
	for i := range list {
		list[i].APIKey = providers.MaskAPIKey(list[i].APIKey)
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

// registerProvidersRoutes registers all provider API routes.
func (s *Server) registerProvidersRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ocgt/api/providers/sort", s.apiProvidersSort)
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
